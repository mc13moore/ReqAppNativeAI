import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/user.js';
import { describeEntitySet, findEntitySets, getMetadata } from '../d365/metadata.js';

const searchSchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  // Not z.coerce.boolean(): Boolean('false') is true, so ?refresh=false would
  // force a refresh. Compare the string instead.
  refresh: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const nameSchema = z.object({ name: z.string().min(1) });

/**
 * Read-only explorer over the live $metadata document.
 *
 * This exists so the entity and field names in d365/entities.ts can be checked
 * and corrected against the real instance without guesswork.
 */
export default async function metadataRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/metadata/entities', async (request) => {
    const { search, limit, refresh } = searchSchema.parse(request.query);
    if (refresh) await getMetadata(true);

    const matches = await findEntitySets(search);
    return {
      count: matches.length,
      truncated: matches.length > limit,
      value: matches.slice(0, limit),
    };
  });

  app.get('/metadata/entities/:name', async (request, reply) => {
    const { name } = nameSchema.parse(request.params);
    const described = await describeEntitySet(name);

    if (!described) {
      return reply.code(404).send({
        error: 'entity_not_found',
        message: `No entity set named "${name}" exists in this environment. Search /api/metadata/entities to find the right name.`,
      });
    }

    return described;
  });
}
