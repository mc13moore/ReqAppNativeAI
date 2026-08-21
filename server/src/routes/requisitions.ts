import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/user.js';
import { headerEntity, lineEntity } from '../d365/entities.js';
import { ValidationError } from '../d365/requisitions.js';
import {
  createHeader,
  createLine,
  getHeader,
  listHeaders,
  listLines,
  normaliseCompany,
} from '../d365/requisitions.js';
import { loadAllLookups, loadLookup } from '../d365/lookups.js';

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

const withLinesSchema = z.object({
  company: z.string().optional(),
  header: z.record(z.unknown()),
  lines: z.array(z.record(z.unknown())).max(100).default([]),
});

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

    const created = await createHeader({ company }, body);

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

  /** Reference data backing the create form's dropdowns. */
  app.get('/lookups', async (request) => {
    const refresh = (request.query as Record<string, unknown>)?.['refresh'] === 'true';
    return loadAllLookups(refresh);
  });

  app.get('/lookups/:kind', async (request) => {
    const { kind } = request.params as { kind: string };
    return loadLookup(kind);
  });

  /**
   * Creates a requisition and its lines in one call.
   *
   * D365 has no batch endpoint here, so this is still a header POST followed by
   * one POST per line. Doing it server-side keeps the sequence off the network
   * round-trip-per-line path and, more importantly, lets a partial failure be
   * reported precisely: the header exists, these lines landed, this one did
   * not. Rolling the header back would be worse -- the requisition number is
   * already assigned and the record is visible in D365.
   */
  app.post('/requisitions/with-lines', async (request, reply) => {
    const body = withLinesSchema.parse(request.body);
    const company = normaliseCompany(body.company);

    const header = await createHeader({ company }, body.header);
    const requisitionNumber = String(header['RequisitionNumber'] ?? '').trim();

    if (!requisitionNumber) {
      return reply.code(502).send({
        error: 'missing_requisition_number',
        message:
          'Dynamics 365 created the requisition but did not return its number, so lines could not be attached.',
      });
    }

    const created: Record<string, unknown>[] = [];
    const failures: { index: number; message: string; errors?: string[] }[] = [];

    for (const [index, line] of body.lines.entries()) {
      try {
        created.push(await createLine(company, requisitionNumber, line));
      } catch (err) {
        failures.push({
          index,
          message: err instanceof Error ? err.message : String(err),
          errors: err instanceof ValidationError ? err.errors : undefined,
        });
      }
    }

    request.log.info(
      {
        user: request.user?.name,
        company,
        requisition: requisitionNumber,
        lines: created.length,
        failed: failures.length,
      },
      'created requisition with lines',
    );

    return reply.code(failures.length > 0 ? 207 : 201).send({
      header,
      requisitionNumber,
      company,
      linesCreated: created.length,
      linesRequested: body.lines.length,
      failures,
    });
  });
}
