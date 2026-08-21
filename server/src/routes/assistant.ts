import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/user.js';
import { computeAnalytics } from '../workspace/aggregate.js';
import { loadRequisitionDetail, loadRequisitions } from '../workspace/service.js';
import type { RequisitionDetailView, RequisitionSummary } from '../workspace/model.js';

/**
 * Assistant preview.
 *
 * No model is called. Every answer is composed from the same Dynamics 365
 * records the rest of the application reads, so nothing it says can contradict
 * the record on screen. That constraint is deliberate: a canned paragraph would
 * fall apart the moment somebody cross-checked it, and this is meant to show
 * the interaction pattern honestly rather than simulate intelligence.
 */

const askBody = z.object({
  prompt: z.string().min(1).max(500),
  intent: z
    .enum(['summarize', 'similar', 'spend-profile', 'outliers', 'freeform'])
    .default('freeform'),
  company: z.string().optional(),
  requisitionNumber: z.string().optional(),
});

export interface AssistantReply {
  intent: string;
  headline: string;
  body: string[];
  facts: { label: string; value: string }[];
  suggestions: string[];
  groundedOn: string[];
}

const money = (value: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 0,
  }).format(value);

function summarize(detail: RequisitionDetailView): AssistantReply {
  const { summary, lines } = detail;
  const largest = [...lines].sort((a, b) => b.lineAmount - a.lineAmount)[0];

  const body = [
    `${summary.requisitionNumber}${summary.name ? ` — ${summary.name}` : ''} is at status ${summary.status || 'unknown'} in legal entity ${summary.company || 'unspecified'}.`,
  ];

  if (lines.length > 0) {
    body.push(
      `It carries ${lines.length} line${lines.length === 1 ? '' : 's'} totalling ${money(summary.totalAmount, summary.currency)}${
        summary.categories.length > 0 ? ` across ${summary.categories.join(', ')}` : ''
      }.`,
    );
    if (largest) {
      body.push(
        `The largest line is "${largest.description || largest.itemNumber || 'unnamed'}" at ${money(largest.lineAmount, largest.currency)} — ${largest.quantity} ${largest.unit} at ${money(largest.unitPrice, largest.currency)} each.`,
      );
    }
  } else {
    body.push('No lines were returned for this requisition, so it has no value to report.');
  }

  if (summary.onHold) {
    body.push(
      `It is flagged on hold in Dynamics 365${summary.onHoldExplanation ? `: ${summary.onHoldExplanation}` : '.'}`,
    );
  }

  const facts = [
    { label: 'Status', value: summary.status || '—' },
    { label: 'Lines', value: String(lines.length) },
  ];
  if (summary.hasLineData) {
    facts.push({ label: 'Total', value: money(summary.totalAmount, summary.currency) });
  }
  if (summary.vendors.length > 0) {
    facts.push({ label: 'Vendor', value: summary.vendors.join(', ') });
  }

  return {
    intent: 'summarize',
    headline: `${summary.requisitionNumber} summary`,
    body,
    facts,
    suggestions: ['Find similar requisitions', 'Show the spend profile'],
    groundedOn: [`Requisition ${summary.requisitionNumber}`, `${lines.length} line records`],
  };
}

function similar(detail: RequisitionDetailView, all: RequisitionSummary[]): AssistantReply {
  const { summary } = detail;

  const matches = all
    .filter(
      (r) =>
        r.requisitionNumber !== summary.requisitionNumber &&
        (r.categories.some((c) => summary.categories.includes(c)) ||
          r.vendors.some((v) => summary.vendors.includes(v))),
    )
    .sort(
      (a, b) =>
        Math.abs(a.totalAmount - summary.totalAmount) -
        Math.abs(b.totalAmount - summary.totalAmount),
    )
    .slice(0, 5);

  return {
    intent: 'similar',
    headline:
      matches.length > 0
        ? `${matches.length} requisition${matches.length === 1 ? '' : 's'} share a category or vendor`
        : 'No comparable requisitions found',
    body:
      matches.length > 0
        ? [
            `Matched on category or vendor, ranked by how close their value is to ${money(summary.totalAmount, summary.currency)}:`,
            ...matches.map(
              (m) =>
                `${m.requisitionNumber} — ${money(m.totalAmount, m.currency)}, status ${m.status || 'unknown'}${m.vendors.length ? `, vendor ${m.vendors.join('/')}` : ''}.`,
            ),
          ]
        : [
            'Nothing in the requisitions read from Dynamics 365 shares a category or vendor with this one.',
          ],
    facts: matches
      .slice(0, 4)
      .map((m) => ({ label: m.requisitionNumber, value: money(m.totalAmount, m.currency) })),
    suggestions: ['Show the spend profile', 'Highlight unusual spend'],
    groundedOn: [`${all.length} requisitions read from D365`],
  };
}

function spendProfile(all: RequisitionSummary[]): AssistantReply {
  const analytics = computeAnalytics(all);
  const { totals, byCategory, byVendor } = analytics;

  const body = [
    `${totals.requisitions} requisitions were read from Dynamics 365, ${totals.openRequisitions} of them still open, carrying ${totals.lineCount} lines in total.`,
    totals.totalRequestedSpend > 0
      ? `Combined value is ${money(totals.totalRequestedSpend, totals.currency)}, averaging ${money(totals.averageValue, totals.currency)} per requisition that has lines.`
      : 'No line values were available, so no spend total can be reported.',
  ];

  if (byCategory[0]) {
    body.push(
      `Largest category is ${byCategory[0].label} at ${money(byCategory[0].value, totals.currency)}${
        byVendor[0] ? `; largest vendor is ${byVendor[0].label} at ${money(byVendor[0].value, totals.currency)}` : ''
      }.`,
    );
  }

  if (totals.withoutLineData > 0) {
    body.push(
      `${totals.withoutLineData} requisition${totals.withoutLineData === 1 ? ' has' : 's have'} no line data in the current read, so ${totals.withoutLineData === 1 ? 'its value is' : 'their values are'} shown as zero rather than estimated.`,
    );
  }

  return {
    intent: 'spend-profile',
    headline: 'Spend profile across current requisitions',
    body,
    facts: [
      { label: 'Requisitions', value: String(totals.requisitions) },
      { label: 'Open', value: String(totals.openRequisitions) },
      { label: 'Total', value: money(totals.totalRequestedSpend, totals.currency) },
      { label: 'Lines', value: String(totals.lineCount) },
    ],
    suggestions: ['Highlight unusual spend'],
    groundedOn: ['Requisition headers and lines read from D365'],
  };
}

function outliers(all: RequisitionSummary[]): AssistantReply {
  const analytics = computeAnalytics(all);
  const found = analytics.outliers;

  return {
    intent: 'outliers',
    headline:
      found.length > 0
        ? `${found.length} requisition${found.length === 1 ? '' : 's'} sit well above their category median`
        : 'Nothing stands out against category medians',
    body:
      found.length > 0
        ? found.map(
            (o) =>
              `${o.requisitionNumber} — ${money(o.amount, analytics.totals.currency)} against a ${o.category} median of ${money(o.medianAmount, analytics.totals.currency)}, ${o.multiple}x higher.`,
          )
        : [
            'No category currently holds enough requisitions for a median comparison to be meaningful, or nothing exceeds it by a wide enough margin.',
            'This comparison needs at least six requisitions in a single category before it will report anything.',
          ],
    facts: found.slice(0, 4).map((o) => ({
      label: o.requisitionNumber,
      value: money(o.amount, analytics.totals.currency),
    })),
    suggestions: ['Show the spend profile'],
    groundedOn: ['Median value per procurement category'],
  };
}

function freeform(prompt: string, all: RequisitionSummary[]): AssistantReply {
  const analytics = computeAnalytics(all);

  return {
    intent: 'freeform',
    headline: 'Assistant preview',
    body: [
      'This panel shows how a language model would sit over live Dynamics 365 procurement data. It is not calling a model — every answer here is composed from the same records shown on screen.',
      `In scope: ${analytics.totals.requisitions} requisitions and ${analytics.totals.lineCount} lines read from Dynamics 365${
        analytics.totals.totalRequestedSpend > 0
          ? `, worth ${money(analytics.totals.totalRequestedSpend, analytics.totals.currency)}`
          : ''
      }.`,
      `You asked: "${prompt}". A production build would send the requisition, its lines and your question to Claude, and return an answer citing the source records.`,
    ],
    facts: [
      { label: 'Requisitions', value: String(analytics.totals.requisitions) },
      { label: 'Lines', value: String(analytics.totals.lineCount) },
    ],
    suggestions: ['Show the spend profile', 'Highlight unusual spend'],
    groundedOn: ['Current requisition population'],
  };
}

export default async function assistantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.post('/assistant/ask', async (request, reply) => {
    const { prompt, intent, company, requisitionNumber } = askBody.parse(request.body);

    const all = (await loadRequisitions()).data;
    const needsRecord = intent === 'summarize' || intent === 'similar';

    let detail: RequisitionDetailView | null = null;
    if (needsRecord && requisitionNumber) {
      try {
        detail = await loadRequisitionDetail(company ?? 'usmf', requisitionNumber);
      } catch {
        detail = null;
      }
    }

    if (needsRecord && !detail) {
      return reply.send({
        intent,
        headline: 'Open a requisition first',
        body: [
          'This question is about a specific requisition. Open one from the workspace and ask again, and the assistant will answer against that record.',
        ],
        facts: [],
        suggestions: ['Show the spend profile', 'Highlight unusual spend'],
        groundedOn: [],
      } satisfies AssistantReply);
    }

    switch (intent) {
      case 'summarize':
        return summarize(detail!);
      case 'similar':
        return similar(detail!, all);
      case 'spend-profile':
        return spendProfile(all);
      case 'outliers':
        return outliers(all);
      default:
        return freeform(prompt, all);
    }
  });
}
