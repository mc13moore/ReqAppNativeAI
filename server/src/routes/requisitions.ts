import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/user.js';
import { headerEntity, lineEntity } from '../d365/entities.js';
import {
  createHeader,
  createLine,
  getHeader,
  listHeaders,
  listLines,
  normaliseCompany,
} from '../d365/requisitions.js';

const listQuerySchema = z.object({
  company: z.string().optional(),
  search: z.string().optional(),
  status: z.string().optional(),
  top: z.coerce.number().int().min(1).max(500).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

const paramsSchema = z.object({
  company: z.string().min(1),
  requisitionNumber: z.string().min(1),
});

const bodySchema = z.record(z.unknown());

export default async function requisitionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  /** Field descriptors that drive the UI tables and forms. */
  app.get('/schema', async () => ({
    header: headerEntity,
    line: lineEntity,
  }));

  app.get('/requisitions', async (request) => {
    const query = listQuerySchema.parse(request.query);
    const result = await listHeaders(query);
    return {
      value: result.value,
      count: result.count ?? result.value.length,
      company: result.company,
      top: query.top,
      skip: query.skip,
    };
  });

  app.get('/requisitions/:company/:requisitionNumber', async (request) => {
    const { company, requisitionNumber } = paramsSchema.parse(request.params);
    // Header and lines are independent reads, so overlap them.
    const [header, lines] = await Promise.all([
      getHeader(company, requisitionNumber),
      listLines(company, requisitionNumber),
    ]);
    return { header, lines: lines.value };
  });

  app.get('/requisitions/:company/:requisitionNumber/lines', async (request) => {
    const { company, requisitionNumber } = paramsSchema.parse(request.params);
    const lines = await listLines(company, requisitionNumber);
    return { value: lines.value, count: lines.count ?? lines.value.length };
  });

  app.post('/requisitions', async (request, reply) => {
    const body = bodySchema.parse(request.body);
    const company = normaliseCompany(
      typeof body['dataAreaId'] === 'string' ? body['dataAreaId'] : undefined,
    );

    const created = await createHeader(
      { company, userEmail: request.user?.name },
      body,
    );

    request.log.info(
      { user: request.user?.name, company, requisition: created['RequisitionNumber'] },
      'created requisition header',
    );

    return reply.code(201).send(created);
  });

  app.post('/requisitions/:company/:requisitionNumber/lines', async (request, reply) => {
    const { company, requisitionNumber } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);

    const created = await createLine(company, requisitionNumber, body);

    request.log.info(
      {
        user: request.user?.name,
        company,
        requisition: requisitionNumber,
        line: created['LineNumber'],
      },
      'created requisition line',
    );

    return reply.code(201).send(created);
  });
}
