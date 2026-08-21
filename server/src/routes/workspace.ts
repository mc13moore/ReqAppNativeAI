import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/user.js';
import {
  loadActivity,
  loadAnalytics,
  loadRequisitionDetail,
  loadRequisitions,
} from '../demo/service.js';
import type { RequisitionSummary } from '../demo/model.js';

const listQuery = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  stage: z.string().optional(),
  department: z.string().optional(),
  vendor: z.string().optional(),
  sync: z.string().optional(),
  priority: z.string().optional(),
  sort: z.string().default('createdDate'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  top: z.coerce.number().int().min(1).max(500).default(100),
  skip: z.coerce.number().int().min(0).default(0),
});

const detailParams = z.object({
  company: z.string().min(1),
  requisitionNumber: z.string().min(1),
});

/** Case-insensitive match across the fields a user would plausibly search. */
function matchesSearch(item: RequisitionSummary, term: string): boolean {
  const haystack = [
    item.requisitionNumber,
    item.name,
    item.vendor,
    item.department,
    item.category,
    item.requester.name,
    item.status,
    item.approvalStage,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(term);
}

function compare(a: RequisitionSummary, b: RequisitionSummary, field: string): number {
  switch (field) {
    case 'totalAmount':
      return a.totalAmount - b.totalAmount;
    case 'ageDays':
      return a.ageDays - b.ageDays;
    case 'requisitionNumber':
      return a.requisitionNumber.localeCompare(b.requisitionNumber);
    case 'vendor':
      return a.vendor.localeCompare(b.vendor);
    case 'department':
      return a.department.localeCompare(b.department);
    case 'requester':
      return a.requester.name.localeCompare(b.requester.name);
    case 'approvalStage':
      return a.approvalStage.localeCompare(b.approvalStage);
    case 'status':
      return a.status.localeCompare(b.status);
    default:
      return a.createdDate.localeCompare(b.createdDate);
  }
}

/**
 * Read-only projections that drive the redesigned experience.
 *
 * Kept separate from /api/requisitions, which remains the direct D365
 * pass-through used for creating records. Nothing here writes.
 */
export default async function workspaceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/workspace/requisitions', async (request) => {
    const query = listQuery.parse(request.query);
    const result = await loadRequisitions();

    let items = result.data;
    const term = query.search?.trim().toLowerCase();
    if (term) items = items.filter((item) => matchesSearch(item, term));
    if (query.status) items = items.filter((i) => i.status === query.status);
    if (query.stage) items = items.filter((i) => i.approvalStage === query.stage);
    if (query.department) items = items.filter((i) => i.department === query.department);
    if (query.vendor) items = items.filter((i) => i.vendor === query.vendor);
    if (query.sync) items = items.filter((i) => i.syncState === query.sync);
    if (query.priority) items = items.filter((i) => i.priority === query.priority);

    const sorted = [...items].sort((a, b) => {
      const order = compare(a, b, query.sort);
      return query.direction === 'asc' ? order : -order;
    });

    return {
      value: sorted.slice(query.skip, query.skip + query.top),
      count: sorted.length,
      total: result.data.length,
      source: result.source,
      liveCount: result.liveCount,
      demoCount: result.demoCount,
      liveError: result.liveError,
      facets: {
        departments: [...new Set(result.data.map((i) => i.department))].sort(),
        vendors: [...new Set(result.data.map((i) => i.vendor))].sort(),
        statuses: [...new Set(result.data.map((i) => i.status))].sort(),
        stages: [...new Set(result.data.map((i) => i.approvalStage))],
      },
    };
  });

  app.get('/workspace/analytics', async () => {
    const result = await loadAnalytics();
    return {
      analytics: result.data,
      source: result.source,
      liveCount: result.liveCount,
      demoCount: result.demoCount,
      liveError: result.liveError,
    };
  });

  app.get('/workspace/activity', async () => {
    const result = await loadActivity();
    return { value: result.data, source: result.source };
  });

  /** Requisitions awaiting a decision, newest bottlenecks first. */
  app.get('/workspace/approvals', async () => {
    const result = await loadRequisitions();
    const queue = result.data
      .filter(
        (i) => i.approvalStage === 'Manager Approval' || i.approvalStage === 'Purchasing',
      )
      // Oldest first: an approval queue exists to surface what is waiting
      // longest, not what arrived most recently.
      .sort((a, b) => b.ageDays - a.ageDays);

    return {
      value: queue,
      count: queue.length,
      totalValue: Math.round(queue.reduce((sum, i) => sum + i.totalAmount, 0)),
      source: result.source,
    };
  });

  app.get('/workspace/requisitions/:company/:requisitionNumber', async (request, reply) => {
    const { company, requisitionNumber } = detailParams.parse(request.params);
    const result = await loadRequisitionDetail(company, requisitionNumber);

    if (!result) {
      return reply.code(404).send({
        error: 'not_found',
        message: `Requisition ${requisitionNumber} was not found in ${company}.`,
      });
    }

    return {
      ...result.data,
      source: result.source,
      liveError: result.liveError,
    };
  });
}
