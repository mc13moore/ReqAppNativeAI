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
  const preparer = useAsync(() => api.preparer(), []);
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
            <h2 className="card__title">Preparer mapping</h2>
            <button type="button" className="btn btn--ghost btn--sm" onClick={preparer.reload}>
              Re-check
            </button>
          </div>

          {preparer.loading && <Spinner label="Resolving…" />}
          {preparer.error ? <ErrorBanner error={preparer.error} /> : null}
          {preparer.data && (
            <>
              <p className="small">
                Signed in as <strong>{preparer.data.signedInAs ?? 'unknown'}</strong>
              </p>
              <div className="row" style={{ marginTop: '0.6rem' }}>
                {preparer.data.personnelNumber ? (
                  <Badge tone="success">
                    Personnel #{preparer.data.personnelNumber} · via {preparer.data.source}
                  </Badge>
                ) : (
                  <Badge tone="danger">
                    <IconAlert size={11} />
                    No personnel number resolved
                  </Badge>
                )}
              </div>
              {preparer.data.error && (
                <p className="tiny dim" style={{ marginTop: '0.5rem' }}>
                  {preparer.data.error}
                </p>
              )}
              <p className="field__hint" style={{ marginTop: '0.6rem' }}>
                Creating a requisition needs this mapping. Adjust with{' '}
                <code>D365_PREPARER_ENTITY</code>, <code>D365_PREPARER_EMAIL_FIELD</code> and{' '}
                <code>D365_PREPARER_NUMBER_FIELD</code>.
              </p>
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
