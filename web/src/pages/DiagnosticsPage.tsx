import { useState } from 'react';
import { IconAlert, IconCheckCircle, IconSearch, IconSync } from '../components/Icons';
import { Badge, ErrorBanner, Skeleton, Spinner } from '../components/primitives';
import { api } from '../lib/api';
import { useApp } from '../lib/AppContext';
import { useAsync, useDebounced } from '../lib/hooks';
import type { PropertyInfo } from '../lib/types';

/**
 * Diagnostics and metadata explorer.
 *
 * The connection check separates a token problem from a permission problem
 * from a wrong entity name -- the three failures that look identical from the
 * requisition screens.
 */
export function DiagnosticsPage() {
  const { config } = useApp();

  const [entityQuery, setEntityQuery] = useState('requisition');
  const search = useDebounced(entityQuery, 350);
  const [selected, setSelected] = useState<string | null>(config.headerEntitySet);

  const connection = useAsync(() => api.checkD365(), []);
  const lookups = useAsync(() => api.lookups(), []);
  const entities = useAsync(() => api.searchEntities(search), [search]);
  const described = useAsync(
    () => (selected ? api.describeEntity(selected) : Promise.resolve(null)),
    [selected],
  );

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <div className="page__eyebrow">System</div>
          <h1>Diagnostics</h1>
          <p className="page__sub">
            Verify the Dynamics 365 connection and confirm entity and field names against this
            environment.
          </p>
        </div>
        <Badge tone="info">{config.headerEntitySet}</Badge>
      </div>

      <div className="grid grid--2">
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">
              <IconSync size={15} />
              Connection
            </h2>
            <button type="button" className="btn btn--ghost btn--sm" onClick={connection.reload}>
              Re-check
            </button>
          </div>

          {connection.loading && <Spinner label="Checking Dynamics 365…" />}
          {connection.error ? (
            <ErrorBanner error={connection.error} onRetry={connection.reload} />
          ) : null}
          {connection.data && (
            <div className="banner banner--success">
              <IconCheckCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div className="banner__title">Connected</div>
                <p>
                  <code>{connection.data.environment}</code> responded in{' '}
                  {connection.data.elapsedMs}ms.
                </p>
                {connection.data.credential && (
                  <p style={{ marginTop: '0.35rem' }}>
                    Credential: {connection.data.credential.mode}
                    {connection.data.credential.clientId && (
                      <>
                        {' '}
                        · client <code>{connection.data.credential.clientId}</code>
                      </>
                    )}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Create-form lookups</h2>
            <button type="button" className="btn btn--ghost btn--sm" onClick={lookups.reload}>
              Re-check
            </button>
          </div>

          {lookups.loading && <Spinner label="Reading reference entities…" />}
          {lookups.error ? <ErrorBanner error={lookups.error} /> : null}
          {lookups.data && (
            <>
              <div className="stack stack--sm">
                {Object.values(lookups.data).map((lookup) => (
                  <div className="row row--between" key={lookup.kind}>
                    <span className="small" style={{ fontWeight: 550, textTransform: 'capitalize' }}>
                      {lookup.kind}
                    </span>
                    <div className="row" style={{ gap: '0.4rem' }}>
                      <span className="tiny dim">{lookup.options.length} options</span>
                      <Badge
                        tone={
                          lookup.source === 'entity'
                            ? 'success'
                            : lookup.source === 'observed'
                              ? 'warning'
                              : 'danger'
                        }
                      >
                        {lookup.source === 'entity'
                          ? lookup.entity
                          : lookup.source === 'observed'
                            ? 'from existing lines'
                            : 'unavailable'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>

              <p className="field__hint" style={{ marginTop: '0.7rem' }}>
                A list showing <strong>from existing lines</strong> means its reference entity could
                not be read, so the options are the distinct values already present on requisition
                lines. Correct the entity with the matching <code>D365_*_ENTITY</code> variable.
              </p>

              {Object.values(lookups.data)
                .filter((l) => l.error)
                .map((l) => (
                  <p className="tiny dim" key={l.kind} style={{ marginTop: '0.4rem' }}>
                    <strong>{l.kind}:</strong> {l.error}
                  </p>
                ))}
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="card__head">
          <h2 className="card__title">Entity explorer</h2>
          <span className="card__hint">
            Field names come from <code>server/src/d365/entities.ts</code>
          </span>
        </div>

        <div className="toolbar__search" style={{ maxWidth: 360, marginBottom: '0.9rem' }}>
          <IconSearch size={15} />
          <input
            className="field__input"
            type="search"
            value={entityQuery}
            onChange={(e) => setEntityQuery(e.target.value)}
            placeholder="Search entity sets"
            aria-label="Search entity sets"
          />
        </div>

        {entities.loading && <Spinner label="Reading $metadata…" />}
        {entities.error ? <ErrorBanner error={entities.error} onRetry={entities.reload} /> : null}
        {entities.data && (
          <>
            <p className="card__hint" style={{ marginBottom: '0.6rem' }}>
              {entities.data.count} matching entity set{entities.data.count === 1 ? '' : 's'}
              {entities.data.truncated ? ' (showing the first 100)' : ''}
            </p>
            <div className="row" style={{ gap: '0.4rem' }}>
              {entities.data.value.map((entity) => (
                <button
                  key={entity.name}
                  type="button"
                  className={`chip${selected === entity.name ? ' chip--active' : ''}`}
                  onClick={() => setSelected(entity.name)}
                >
                  {entity.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {selected && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="card__head">
            <h2 className="card__title">
              Fields on <code>{selected}</code>
            </h2>
          </div>
          {described.loading && <Skeleton variant="row" count={5} />}
          {described.error ? <ErrorBanner error={described.error} onRetry={described.reload} /> : null}
          {described.data && <PropertyTable properties={described.data.properties} />}
        </div>
      )}
    </div>
  );
}

function PropertyTable({ properties }: { properties: PropertyInfo[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Property</th>
            <th scope="col">Type</th>
            <th scope="col">Key</th>
            <th scope="col">Required</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((property) => (
            <tr key={property.name}>
              <td>
                <code>{property.name}</code>
              </td>
              <td className="dim">{property.type.replace(/^Edm\./, '')}</td>
              <td>{property.isKey ? <Badge tone="info">Key</Badge> : <span className="dim">—</span>}</td>
              <td>{property.nullable ? <span className="dim">—</span> : 'Yes'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
