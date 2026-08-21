import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DataGrid, type Column } from '../components/DataGrid';
import { IconAlert, IconFilter, IconSearch, IconSync } from '../components/Icons';
import { Badge, ErrorBanner, Skeleton, statusTone } from '../components/primitives';
import { api } from '../lib/api';
import { formatDate, money } from '../lib/format';
import { useAsync, useDebounced } from '../lib/hooks';
import type { RequisitionSummary } from '../lib/types';

const PAGE_SIZE = 25;

export function WorkspacePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [searchInput, setSearchInput] = useState(params.get('search') ?? '');
  const search = useDebounced(searchInput, 300);

  const status = params.get('status') ?? '';
  const company = params.get('company') ?? '';
  const vendor = params.get('vendor') ?? '';
  const category = params.get('category') ?? '';
  const page = Math.max(0, Number(params.get('page') ?? 0));

  const state = useAsync(
    () =>
      api.requisitions({
        search: search || undefined,
        status: status || undefined,
        company: company || undefined,
        vendor: vendor || undefined,
        category: category || undefined,
        top: PAGE_SIZE,
        skip: page * PAGE_SIZE,
      }),
    [search, status, company, vendor, category, page],
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const open = (row: RequisitionSummary) =>
    navigate(
      `/requisitions/${(row.company || 'usmf').toLowerCase()}/${encodeURIComponent(row.requisitionNumber)}`,
    );

  const columns: Column<RequisitionSummary>[] = [
    {
      key: 'requisitionNumber',
      header: 'Requisition',
      sortValue: (r) => r.requisitionNumber,
      render: (r) => (
        <div>
          <div className="mono" style={{ fontWeight: 650 }}>
            {r.requisitionNumber}
          </div>
          {r.name && (
            <div
              className="tiny dim"
              style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {r.name}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      render: (r) =>
        r.status ? (
          <Badge tone={statusTone(r.status)}>{r.status}</Badge>
        ) : (
          <span className="dim">—</span>
        ),
    },
    {
      key: 'company',
      header: 'Legal entity',
      sortValue: (r) => r.company,
      render: (r) => <span className="small">{r.company || <span className="dim">—</span>}</span>,
    },
    {
      key: 'preparer',
      header: 'Preparer',
      sortValue: (r) => r.preparerPersonnelNumber,
      render: (r) => (
        <span className="mono small">
          {r.preparerPersonnelNumber || <span className="dim">—</span>}
        </span>
      ),
    },
    {
      key: 'vendors',
      header: 'Vendor',
      sortValue: (r) => r.vendors.join(','),
      render: (r) =>
        r.vendors.length > 0 ? (
          <div>
            <div className="mono small">{r.vendors[0]}</div>
            {r.vendors.length > 1 && <div className="tiny dim">+{r.vendors.length - 1} more</div>}
          </div>
        ) : (
          <span className="dim">—</span>
        ),
    },
    {
      key: 'categories',
      header: 'Category',
      sortValue: (r) => r.categories.join(','),
      render: (r) =>
        r.categories.length > 0 ? (
          <div>
            <div className="small">{r.categories[0]}</div>
            {r.categories.length > 1 && (
              <div className="tiny dim">+{r.categories.length - 1} more</div>
            )}
          </div>
        ) : (
          <span className="dim">—</span>
        ),
    },
    {
      key: 'totalAmount',
      header: 'Amount',
      align: 'right',
      sortValue: (r) => r.totalAmount,
      render: (r) =>
        r.hasLineData ? (
          <div>
            <div style={{ fontWeight: 650 }}>{money(r.totalAmount, r.currency || 'USD')}</div>
            <div className="tiny dim">
              {r.lineCount} line{r.lineCount === 1 ? '' : 's'}
            </div>
          </div>
        ) : (
          // A zero here would read as "this requisition is worth nothing"
          // rather than "no lines were returned for it".
          <span className="dim tiny">no line data</span>
        ),
    },
    {
      key: 'requestedDate',
      header: 'Requested',
      align: 'right',
      sortValue: (r) => r.requestedDate,
      render: (r) => <span className="small dim">{formatDate(r.requestedDate)}</span>,
    },
    {
      key: 'onHold',
      header: 'Hold',
      sortValue: (r) => (r.onHold ? 1 : 0),
      render: (r) =>
        r.onHold ? (
          <Badge tone="warning" dot>
            On hold
          </Badge>
        ) : (
          <span className="dim">—</span>
        ),
    },
  ];

  const facets = state.data?.facets;
  const total = state.data?.count ?? 0;
  const shown = state.data?.value.length ?? 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;
  const activeFilters = [status, company, vendor, category].filter(Boolean).length;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <div className="page__eyebrow">Workspace</div>
          <h1>Requisitions</h1>
          <p className="page__sub">
            {state.data
              ? `${total} of ${state.data.total} requisitions read from Dynamics 365`
              : 'Loading requisitions…'}
          </p>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={state.reload}>
          <IconSync size={14} />
          Refresh
        </button>
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <IconSearch size={15} />
          <input
            className="field__input"
            type="search"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setParam('search', e.target.value.trim());
            }}
            placeholder="Search number, name, vendor, category…"
            aria-label="Search requisitions"
          />
        </div>

        <select
          className="select"
          value={status}
          onChange={(e) => setParam('status', e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {facets?.statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={category}
          onChange={(e) => setParam('category', e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {facets?.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={vendor}
          onChange={(e) => setParam('vendor', e.target.value)}
          aria-label="Filter by vendor"
        >
          <option value="">All vendors</option>
          {facets?.vendors.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>

        {(facets?.companies.length ?? 0) > 1 && (
          <select
            className="select"
            value={company}
            onChange={(e) => setParam('company', e.target.value)}
            aria-label="Filter by legal entity"
          >
            <option value="">All legal entities</option>
            {facets?.companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

        {activeFilters > 0 && (
          <button
            type="button"
            className="chip chip--active"
            onClick={() => {
              const next = new URLSearchParams();
              if (searchInput) next.set('search', searchInput);
              setParams(next, { replace: true });
            }}
          >
            <IconFilter size={12} />
            Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {state.error ? <ErrorBanner error={state.error} onRetry={state.reload} /> : null}

      {state.data?.lineError && (
        <div className="banner banner--warning" style={{ marginBottom: '1rem' }}>
          <IconAlert size={17} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div className="banner__title">Amounts unavailable</div>
            <p>Requisition lines could not be read, so no totals are shown.</p>
          </div>
        </div>
      )}

      {state.loading ? (
        <div className="card" style={{ padding: '1rem' }}>
          <Skeleton variant="row" count={8} />
        </div>
      ) : (
        state.data && (
          <>
            <DataGrid
              columns={columns}
              rows={state.data.value}
              rowKey={(r) => r.requisitionNumber}
              onRowActivate={open}
              defaultSort="requisitionNumber"
              emptyTitle="No requisitions match"
              emptyHint="Try clearing a filter or widening your search."
            />

            <div className="pager">
              <span>
                {total > 0
                  ? `Showing ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + shown} of ${total}`
                  : 'No results'}
              </span>
              <div className="row">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={page === 0}
                  onClick={() => setParam('page', String(page - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!hasNext}
                  onClick={() => setParam('page', String(page + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}
