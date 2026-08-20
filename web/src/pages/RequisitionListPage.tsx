import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { ErrorBanner, Spinner } from '../components/Feedback';
import { api } from '../lib/api';
import { useApp } from '../lib/AppContext';
import { useAsync, useDebounced } from '../lib/hooks';
import type { Record365 } from '../lib/types';

const PAGE_SIZE = 25;

export function RequisitionListPage() {
  const { config, schema } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const company = params.get('company') ?? config.defaultCompany;
  const page = Math.max(0, Number(params.get('page') ?? 0));

  const [searchInput, setSearchInput] = useState(params.get('search') ?? '');
  const search = useDebounced(searchInput);

  const state = useAsync(
    () =>
      api.listRequisitions({
        company,
        search: search || undefined,
        top: PAGE_SIZE,
        skip: page * PAGE_SIZE,
      }),
    [company, search, page],
  );

  const columns = schema.header.fields.filter((f) => f.inList);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Any change to the filters invalidates the current page offset.
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const openRequisition = (row: Record365) => {
    const number = String(row['RequisitionNumber'] ?? '');
    const rowCompany = String(row['dataAreaId'] ?? company);
    if (number) navigate(`/requisitions/${encodeURIComponent(rowCompany)}/${encodeURIComponent(number)}`);
  };

  const total = state.data?.count ?? 0;
  const shown = state.data?.value.length ?? 0;
  const hasNext = shown === PAGE_SIZE && (page + 1) * PAGE_SIZE < total;

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Purchase requisitions</h1>
          <p className="page-head__sub">
            Reading <code>{config.headerEntitySet}</code> from Dynamics 365.
          </p>
        </div>
        <Link className="btn btn--primary" to="/requisitions/new">
          New requisition
        </Link>
      </header>

      <div className="toolbar">
        <label className="toolbar__field">
          <span className="toolbar__label">Company</span>
          <input
            className="field__input"
            value={company}
            onChange={(e) => updateParam('company', e.target.value.trim())}
            placeholder="usmf"
            aria-label="Legal entity"
          />
        </label>

        <label className="toolbar__field toolbar__field--grow">
          <span className="toolbar__label">Search</span>
          <input
            className="field__input"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              updateParam('search', e.target.value.trim());
            }}
            placeholder="Requisition number or name"
            type="search"
          />
        </label>

        <button type="button" className="btn btn--ghost" onClick={state.reload}>
          Refresh
        </button>
      </div>

      {state.loading && <Spinner label="Loading requisitions…" />}
      {state.error ? <ErrorBanner error={state.error} onRetry={state.reload} /> : null}

      {state.data && !state.loading && (
        <>
          <DataTable
            fields={columns}
            rows={state.data.value}
            onRowActivate={openRequisition}
            emptyTitle="No requisitions found"
            emptyHint={
              search
                ? 'No requisition matches that search in this company.'
                : `Company "${company}" has no requisitions, or the service account cannot see them.`
            }
          />

          <div className="pager">
            <span className="pager__status">
              {total > 0
                ? `Showing ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + shown} of ${total}`
                : 'No results'}
            </span>
            <div className="pager__buttons">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={page === 0}
                onClick={() => updateParam('page', String(page - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={!hasNext}
                onClick={() => updateParam('page', String(page + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
