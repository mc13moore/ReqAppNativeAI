import { useState } from 'react';
import { ErrorBanner, Spinner, SuccessBanner } from '../components/Feedback';
import { api } from '../lib/api';
import { useApp } from '../lib/AppContext';
import { useAsync, useDebounced } from '../lib/hooks';
import type { PropertyInfo } from '../lib/types';

/**
 * Diagnostics and metadata explorer.
 *
 * The connection check separates "the managed identity cannot get a token"
 * from "the identity is not registered in D365", which are the two failures
 * that look identical from the requisition screens.
 */
export function DiagnosticsPage() {
  const { config } = useApp();

  const [entityQuery, setEntityQuery] = useState('requisition');
  const search = useDebounced(entityQuery);
  const [selected, setSelected] = useState<string | null>(config.headerEntitySet);

  const connection = useAsync(() => api.checkD365(), []);
  const entities = useAsync(() => api.searchEntities(search), [search]);
  const described = useAsync(
    () => (selected ? api.describeEntity(selected) : Promise.resolve(null)),
    [selected],
  );

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Diagnostics</h1>
          <p className="page-head__sub">
            Verify the connection and confirm entity and field names against this environment.
          </p>
        </div>
      </header>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Connection</h2>
          <button type="button" className="btn btn--ghost" onClick={connection.reload}>
            Re-check
          </button>
        </div>

        {connection.loading && <Spinner label="Checking Dynamics 365…" />}
        {connection.error ? (
          <ErrorBanner error={connection.error} onRetry={connection.reload} />
        ) : null}
        {connection.data && (
          <SuccessBanner>
            Connected to <code>{connection.data.environment}</code> in {connection.data.elapsedMs}ms.
            The managed identity acquired a token and read from{' '}
            <code>{config.headerEntitySet}</code>.
          </SuccessBanner>
        )}
      </div>

      <div className="card">
        <h2 className="card__title">Entity explorer</h2>
        <p className="card__hint">
          Field names in the app come from <code>server/src/d365/entities.ts</code>. Use this to
          check them against the live <code>$metadata</code> document and correct that file.
        </p>

        <div className="field field--standalone">
          <label className="field__label" htmlFor="entity-search">
            Search entity sets
          </label>
          <input
            id="entity-search"
            className="field__input"
            type="search"
            value={entityQuery}
            onChange={(e) => setEntityQuery(e.target.value)}
            placeholder="requisition"
          />
        </div>

        {entities.loading && <Spinner label="Reading $metadata…" />}
        {entities.error ? <ErrorBanner error={entities.error} onRetry={entities.reload} /> : null}
        {entities.data && (
          <>
            <p className="card__hint">
              {entities.data.count} matching entity set{entities.data.count === 1 ? '' : 's'}
              {entities.data.truncated ? ' (showing the first 100)' : ''}.
            </p>
            <div className="chips">
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
        <div className="card">
          <h2 className="card__title">
            Fields on <code>{selected}</code>
          </h2>
          {described.loading && <Spinner label="Loading fields…" />}
          {described.error ? (
            <ErrorBanner error={described.error} onRetry={described.reload} />
          ) : null}
          {described.data && <PropertyTable properties={described.data.properties} />}
        </div>
      )}
    </section>
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
              <td data-label="Property">
                <code>{property.name}</code>
              </td>
              <td data-label="Type">{property.type.replace(/^Edm\./, '')}</td>
              <td data-label="Key">{property.isKey ? 'Yes' : '—'}</td>
              <td data-label="Required">{property.nullable ? '—' : 'Yes'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
