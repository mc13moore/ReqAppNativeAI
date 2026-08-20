import { XMLParser } from 'fast-xml-parser';
import { config } from '../config.js';
import { metadataXml } from './client.js';

export interface PropertyInfo {
  name: string;
  type: string;
  nullable: boolean;
  isKey: boolean;
}

export interface EntityTypeInfo {
  name: string;
  properties: PropertyInfo[];
}

export interface EntitySetInfo {
  name: string;
  entityType: string;
}

export interface MetadataIndex {
  entitySets: EntitySetInfo[];
  entityTypes: Map<string, EntityTypeInfo>;
  fetchedAt: number;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Element names are namespaced (edmx:Edmx, Schema, ...); stripping the
  // prefix keeps the traversal below readable.
  removeNSPrefix: true,
  isArray: (name) => ['Schema', 'EntityType', 'EntitySet', 'Property', 'PropertyRef'].includes(name),
});

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Strips the namespace from a qualified type name such as Microsoft.Dynamics.DataEntities.Foo. */
const shortName = (qualified: string): string =>
  qualified.slice(qualified.lastIndexOf('.') + 1);

function parseMetadata(xml: string): MetadataIndex {
  const doc = parser.parse(xml) as Record<string, any>;
  const schemas = asArray(doc?.['Edmx']?.['DataServices']?.['Schema']);

  const entityTypes = new Map<string, EntityTypeInfo>();
  const entitySets: EntitySetInfo[] = [];

  for (const schema of schemas) {
    for (const type of asArray(schema?.['EntityType'])) {
      const name = type?.['@_Name'];
      if (!name) continue;

      const keyNames = new Set(
        asArray(type?.['Key']?.['PropertyRef'])
          .map((ref: any) => ref?.['@_Name'])
          .filter(Boolean),
      );

      const properties: PropertyInfo[] = asArray(type?.['Property'])
        .map((prop: any) => ({
          name: prop?.['@_Name'] as string,
          type: (prop?.['@_Type'] as string) ?? 'Edm.String',
          nullable: prop?.['@_Nullable'] !== 'false',
          isKey: keyNames.has(prop?.['@_Name']),
        }))
        .filter((p) => Boolean(p.name));

      entityTypes.set(name, { name, properties });
    }

    const containers = asArray(schema?.['EntityContainer']);
    for (const container of containers) {
      for (const set of asArray(container?.['EntitySet'])) {
        const name = set?.['@_Name'];
        const entityType = set?.['@_EntityType'];
        if (name && entityType) {
          entitySets.push({ name, entityType: shortName(entityType) });
        }
      }
    }
  }

  entitySets.sort((a, b) => a.name.localeCompare(b.name));

  return { entitySets, entityTypes, fetchedAt: Date.now() };
}

let cached: MetadataIndex | null = null;
let inFlight: Promise<MetadataIndex> | null = null;

/**
 * Returns the parsed $metadata document.
 *
 * The F&O metadata document lists every public data entity and runs to tens of
 * megabytes, so both the fetch and the parse are expensive. It is cached for
 * D365_METADATA_TTL_SECONDS and concurrent callers share one fetch.
 */
export async function getMetadata(forceRefresh = false): Promise<MetadataIndex> {
  const ttlMs = config.D365_METADATA_TTL_SECONDS * 1000;
  const stale = !cached || Date.now() - cached.fetchedAt > ttlMs;

  if (cached && !stale && !forceRefresh) return cached;

  inFlight ??= metadataXml()
    .then((xml) => {
      cached = parseMetadata(xml);
      return cached;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export async function findEntitySets(search?: string): Promise<EntitySetInfo[]> {
  const { entitySets } = await getMetadata();
  if (!search?.trim()) return entitySets;
  const term = search.trim().toLowerCase();
  return entitySets.filter((s) => s.name.toLowerCase().includes(term));
}

export async function describeEntitySet(
  name: string,
): Promise<{ entitySet: string; entityType: string; properties: PropertyInfo[] } | null> {
  const { entitySets, entityTypes } = await getMetadata();

  const set =
    entitySets.find((s) => s.name === name) ??
    entitySets.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!set) return null;

  const type = entityTypes.get(set.entityType);
  return {
    entitySet: set.name,
    entityType: set.entityType,
    properties: type?.properties ?? [],
  };
}
