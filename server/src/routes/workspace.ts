import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/user.js';
import { computeAnalytics } from '../workspace/aggregate.js';
import { loadRequisitionDetail, loadRequisitions } from '../workspace/service.js';
import type { RequisitionSummary } from '../workspace/model.js';

const listQuery = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  company: z.string().optional(),
  vendor: z.string().optional(),
  category: z.string().optional(),
  top: z.coerce.number().int().min(1).max(500).default(100),
  skip: z.coerce.number().int().min(0).default(0),
});

const detailParams = z.object({
  company: z.string().min(1),
  requisitionNumber: z.string().min(1),
});

function matchesSearch(item: RequisitionSummary, term: string): boolean {
  return [
    item.requisitionNumber,
    item.name,
    item.status,
    item.company,
    item.preparerPersonnelNumber,
    item.projectId,
    ...item.vendors,
    ...item.categories,
  ]
    .join(' ')
    .toLowerCase()
    .includes(term);
}

/**
 * Read projections over the D365 requisition entities.
 *
 * Separate from /api/requisitions, which stays the direct pass-through used
 * for writes. Nothing here writes, and nothing here invents a value: every
 * field traces to a header or line record.
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
    if (query.company) items = items.filter((i) => i.company === query.company);
    if (query.vendor) items = items.filter((i) => i.vendors.includes(query.vendor!));
    if (query.category) items = items.filter((i) => i.categories.includes(query.category!));

    return {
      value: items.slice(query.skip, query.skip + query.top),
      count: items.length,
      total: result.data.length,
      headerCount: result.headerCount,
      lineCount: result.lineCount,
      lineError: result.lineError,
      facets: {
        statuses: [...new Set(result.data.map((i) => i.status).filter(Boolean))].sort(),
        companies: [...new Set(result.data.map((i) => i.company).filter(Boolean))].sort(),
        vendors: [...new Set(result.data.flatMap((i) => i.vendors))].sort(),
        categories: [...new Set(result.data.flatMap((i) => i.categories))].sort(),
      },
    };
  });

  app.get('/workspace/analytics', async () => {
    const result = await loadRequisitions();
    return {
      analytics: computeAnalytics(result.data),
      headerCount: result.headerCount,
      lineCount: result.lineCount,
      lineError: result.lineError,
    };
  });

  app.get('/workspace/requisitions/:company/:requisitionNumber', async (request) => {
    const { company, requisitionNumber } = detailParams.parse(request.params);
    return loadRequisitionDetail(company, requisitionNumber);
  });
}
