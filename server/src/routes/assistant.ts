import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/user.js';
import { loadRequisitionDetail, loadRequisitions } from '../demo/service.js';
import { computeAnalytics } from '../demo/analytics.js';
import type { RequisitionDetailView, RequisitionSummary } from '../demo/model.js';

/**
 * Mocked AI assistant.
 *
 * Responses are composed from the same data the rest of the application reads,
 * so what the assistant says is actually true of the requisition on screen --
 * a canned paragraph would fall apart the moment someone cross-checked it
 * against the record. No model is called; this demonstrates the interaction
 * pattern and the shape of the contract a real model would fill.
 */

const askBody = z.object({
  prompt: z.string().min(1).max(500),
  intent: z
    .enum([
      'summarize',
      'why-waiting',
      'similar',
      'suggest-vendor',
      'unusual-spend',
      'approval-summary',
      'freeform',
    ])
    .default('freeform'),
  company: z.string().optional(),
  requisitionNumber: z.string().optional(),
});

export interface AssistantReply {
  intent: string;
  headline: string;
  body: string[];
  /** Short labelled facts rendered as chips beneath the answer. */
  facts: { label: string; value: string }[];
  /** Follow-up prompts offered to the user. */
  suggestions: string[];
  /** What the answer was derived from, so nothing looks like invention. */
  groundedOn: string[];
}

const money = (value: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);

function summarize(detail: RequisitionDetailView): AssistantReply {
  const { summary, lines } = detail;
  const topLine = [...lines].sort((a, b) => b.lineAmount - a.lineAmount)[0];

  return {
    intent: 'summarize',
    headline: `${summary.requisitionNumber} — ${money(summary.totalAmount, summary.currency)} for ${summary.department}`,
    body: [
      `${summary.requester.name} (${summary.requester.title}) raised this requisition ${summary.ageDays} days ago covering ${lines.length} line${lines.length === 1 ? '' : 's'} in the ${summary.category} category.`,
      topLine
        ? `The largest line is "${topLine.description}" at ${money(topLine.lineAmount, topLine.currency)} — ${topLine.quantity} ${topLine.unit} at ${money(topLine.unitPrice, topLine.currency)} each.`
        : 'No lines have been added yet.',
      `It is currently at the ${summary.approvalStage} stage and the Dynamics 365 lifecycle shows ${summary.d365Stage}.`,
    ],
    facts: [
      { label: 'Total', value: money(summary.totalAmount, summary.currency) },
      { label: 'Vendor', value: summary.vendor },
      { label: 'Priority', value: summary.priority },
      { label: 'Lines', value: String(lines.length) },
    ],
    suggestions: [
      'Why is this requisition waiting for approval?',
      'Find similar historical requisitions',
      'Generate an approval summary',
    ],
    groundedOn: [`Requisition ${summary.requisitionNumber}`, `${lines.length} line items`],
  };
}

function whyWaiting(detail: RequisitionDetailView): AssistantReply {
  const { summary, approvalTimeline } = detail;
  const current = approvalTimeline.find((e) => e.state === 'current');
  const completed = approvalTimeline.filter((e) => e.state === 'complete');

  const slow = summary.ageDays > 14;

  return {
    intent: 'why-waiting',
    headline: current
      ? `Waiting at ${current.stage}${current.actor ? ` with ${current.actor}` : ''}`
      : 'This requisition is not waiting on an approval',
    body: [
      completed.length > 0
        ? `${completed.length} stage${completed.length === 1 ? '' : 's'} completed: ${completed.map((e) => e.stage).join(' → ')}.`
        : 'No approval stages have been completed yet.',
      slow
        ? `At ${summary.ageDays} days, this is above the typical approval time. Requisitions over ${money(60_000)} routinely need a second sign-off, and this one totals ${money(summary.totalAmount, summary.currency)}.`
        : `At ${summary.ageDays} days, this is tracking within the normal range for ${summary.department}.`,
      summary.syncState === 'error'
        ? `There is also an integration issue: ${summary.syncMessage}`
        : `The Dynamics 365 lifecycle is at ${summary.d365Stage}.`,
    ],
    facts: [
      { label: 'Age', value: `${summary.ageDays} days` },
      { label: 'Stage', value: summary.approvalStage },
      { label: 'Approver', value: current?.actor ?? '—' },
      { label: 'Priority', value: summary.priority },
    ],
    suggestions: ['Generate an approval summary', 'Summarize this requisition'],
    groundedOn: ['Approval timeline', 'Requisition age and value'],
  };
}

function similar(detail: RequisitionDetailView, all: RequisitionSummary[]): AssistantReply {
  const { summary } = detail;
  const matches = all
    .filter(
      (r) =>
        r.requisitionNumber !== summary.requisitionNumber &&
        (r.category === summary.category || r.vendor === summary.vendor),
    )
    .sort(
      (a, b) =>
        Math.abs(a.totalAmount - summary.totalAmount) -
        Math.abs(b.totalAmount - summary.totalAmount),
    )
    .slice(0, 4);

  return {
    intent: 'similar',
    headline: `${matches.length} comparable requisition${matches.length === 1 ? '' : 's'} found`,
    body: [
      matches.length > 0
        ? `Closest matches by category and vendor, ranked by how near their value is to ${money(summary.totalAmount, summary.currency)}:`
        : 'No comparable requisitions were found in the current data set.',
      ...matches.map(
        (m) =>
          `${m.requisitionNumber} — ${money(m.totalAmount, m.currency)}, ${m.vendor}, ${m.department}, ${m.status}.`,
      ),
    ],
    facts: matches.slice(0, 4).map((m) => ({
      label: m.requisitionNumber,
      value: money(m.totalAmount, m.currency),
    })),
    suggestions: ['Suggest a vendor', 'Identify unusual spend'],
    groundedOn: [`${all.length} requisitions in scope`, `Category ${summary.category}`],
  };
}

function suggestVendor(detail: RequisitionDetailView, all: RequisitionSummary[]): AssistantReply {
  const { summary } = detail;
  const sameCategory = all.filter((r) => r.category === summary.category);

  const byVendor = new Map<string, { count: number; total: number }>();
  for (const r of sameCategory) {
    const current = byVendor.get(r.vendor) ?? { count: 0, total: 0 };
    current.count += 1;
    current.total += r.totalAmount;
    byVendor.set(r.vendor, current);
  }

  const ranked = [...byVendor.entries()]
    .map(([vendor, stats]) => ({
      vendor,
      count: stats.count,
      average: stats.total / stats.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const best = ranked[0];

  return {
    intent: 'suggest-vendor',
    headline: best
      ? `${best.vendor} is the most used supplier for ${summary.category}`
      : `No vendor history for ${summary.category}`,
    body: [
      best
        ? `${best.vendor} appears on ${best.count} ${summary.category} requisitions with an average value of ${money(best.average)}.`
        : 'There is no comparable purchasing history to draw on.',
      ranked.length > 1
        ? `Alternatives worth pricing: ${ranked.slice(1).map((r) => `${r.vendor} (${r.count})`).join(', ')}.`
        : 'No alternative suppliers appear in this category.',
      'A production version would weigh contracted pricing, lead time and supplier performance from Dynamics 365 rather than volume alone.',
    ],
    facts: ranked.map((r) => ({ label: r.vendor, value: `${r.count} reqs` })),
    suggestions: ['Find similar historical requisitions', 'Summarize this requisition'],
    groundedOn: [`${sameCategory.length} ${summary.category} requisitions`],
  };
}

function unusualSpend(all: RequisitionSummary[]): AssistantReply {
  const analytics = computeAnalytics(all);
  const { anomalies, bottlenecks } = analytics;

  return {
    intent: 'unusual-spend',
    headline:
      anomalies.length > 0
        ? `${anomalies.length} requisition${anomalies.length === 1 ? '' : 's'} stand out against category norms`
        : 'Nothing unusual detected in current spend',
    body: [
      ...anomalies.map(
        (a) =>
          `${a.requisitionNumber} — ${money(a.amount)} from ${a.vendor} for ${a.department}. ${a.reason}.`,
      ),
      bottlenecks.length > 0
        ? `Separately, the ${bottlenecks[0]!.stage} stage is holding ${bottlenecks[0]!.count} requisitions for an average of ${bottlenecks[0]!.averageAgeDays} days.`
        : 'No approval stage is showing an unusual backlog.',
    ],
    facts: anomalies.slice(0, 4).map((a) => ({
      label: a.requisitionNumber,
      value: money(a.amount),
    })),
    suggestions: ['Generate an approval summary', 'Find similar historical requisitions'],
    groundedOn: [`${all.length} requisitions`, 'Median value per category'],
  };
}

function approvalSummary(detail: RequisitionDetailView): AssistantReply {
  const { summary, lines, financialDimensions } = detail;
  const dims = financialDimensions.map((d) => `${d.label} ${d.value}`).join(', ');

  return {
    intent: 'approval-summary',
    headline: `Approval brief for ${summary.requisitionNumber}`,
    body: [
      `Request: ${summary.name}. ${money(summary.totalAmount, summary.currency)} across ${lines.length} line${lines.length === 1 ? '' : 's'}, supplied by ${summary.vendor}.`,
      `Requested by ${summary.requester.name} (${summary.requester.title}, ${summary.department}) with ${summary.priority.toLowerCase()} priority.`,
      `Coding: ${dims}.`,
      summary.ageDays > 14
        ? `This has been open ${summary.ageDays} days and is past the usual turnaround — worth prioritising.`
        : `Open ${summary.ageDays} days, within normal turnaround.`,
      `Recommendation: approve if budget remains in ${summary.department} for this period; the value and supplier are consistent with prior ${summary.category} purchases.`,
    ],
    facts: [
      { label: 'Value', value: money(summary.totalAmount, summary.currency) },
      { label: 'Requester', value: summary.requester.name },
      { label: 'Department', value: summary.department },
      { label: 'D365', value: summary.d365Stage },
    ],
    suggestions: ['Why is this requisition waiting for approval?', 'Identify unusual spend'],
    groundedOn: ['Requisition header', 'Line items', 'Financial dimensions'],
  };
}

function freeform(prompt: string, all: RequisitionSummary[]): AssistantReply {
  const analytics = computeAnalytics(all);
  return {
    intent: 'freeform',
    headline: 'Assistant preview',
    body: [
      `This panel demonstrates how a language model would sit over live procurement data. It is not calling a model yet — the answers are composed from the same records shown on screen.`,
      `In scope right now: ${all.length} requisitions worth ${money(analytics.totals.totalRequestedSpend)}, of which ${analytics.totals.pendingApproval} are awaiting approval.`,
      `You asked: "${prompt}". A production build would route this to Claude with the requisition, its lines and the approval history as context, and return grounded answers with citations back to the source records.`,
    ],
    facts: [
      { label: 'In scope', value: `${all.length} reqs` },
      { label: 'Pending', value: String(analytics.totals.pendingApproval) },
      { label: 'Value', value: money(analytics.totals.totalRequestedSpend) },
    ],
    suggestions: [
      'Summarize this requisition',
      'Identify unusual spend',
      'Suggest a vendor',
    ],
    groundedOn: ['Current requisition population'],
  };
}

export default async function assistantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.post('/assistant/ask', async (request, reply) => {
    const { prompt, intent, company, requisitionNumber } = askBody.parse(request.body);

    const all = (await loadRequisitions()).data;

    const needsRecord =
      intent === 'summarize' ||
      intent === 'why-waiting' ||
      intent === 'similar' ||
      intent === 'suggest-vendor' ||
      intent === 'approval-summary';

    let detail: RequisitionDetailView | null = null;
    if (needsRecord && requisitionNumber) {
      const result = await loadRequisitionDetail(company ?? 'usmf', requisitionNumber);
      detail = result?.data ?? null;
    }

    if (needsRecord && !detail) {
      return reply.send({
        intent,
        headline: 'Open a requisition first',
        body: [
          'This question is about a specific requisition. Open one from the workspace and ask again, and the assistant will answer against that record.',
        ],
        facts: [],
        suggestions: ['Identify unusual spend'],
        groundedOn: [],
      } satisfies AssistantReply);
    }

    switch (intent) {
      case 'summarize':
        return summarize(detail!);
      case 'why-waiting':
        return whyWaiting(detail!);
      case 'similar':
        return similar(detail!, all);
      case 'suggest-vendor':
        return suggestVendor(detail!, all);
      case 'approval-summary':
        return approvalSummary(detail!);
      case 'unusual-spend':
        return unusualSpend(all);
      default:
        return freeform(prompt, all);
    }
  });
}
