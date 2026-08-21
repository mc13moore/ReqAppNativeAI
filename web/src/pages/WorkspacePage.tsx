import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DataGrid, type Column } from '../components/DataGrid';
import { IconFilter, IconSearch, IconSync } from '../components/Icons';
import {
  Badge,
  ErrorBanner,
  Person,
  Skeleton,
  priorityTone,
  statusTone,
  syncTone,
  SYNC_LABEL,
} from '../components/primitives';
import { api } from '../lib/api';
import { formatRelative, money } from '../lib/format';
import { useAsync, useDebounced } from '../lib/hooks';
import type { RequisitionSummary } from '../lib/types';

const PAGE_SIZE = 25;

export function WorkspacePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [searchInput, setSearchInput] = useState(params.get('search') ?? '');
  const search = useDebounced(searchInput, 300);

  const stage = params.get('stage') ?? '';
  const department = params.get('department') ?? '';
  const vendor = params.get('vendor') ?? '';
  const sync = params.get('sync') ?? '';
  const page = Math.max(0, Number(params.get('page') ?? 0));

  const state = useAsync(
    () =>
      api.requisitions({
        search: search || undefined,
        stage: stage || undefined,
        department: department || undefined,
        vendor: vendor || undefined,
        sync: sync || undefined,
        top: PAGE_SIZE,
        skip: page * PAGE_SIZE,
      }),
    [search, stage, department, vendor, sync, page],
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Any filter change invalidates the current offset.
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const open = (row: RequisitionSummary) =>
    navigate(`/requisitions/${row.company.toLowerCase()}/${row.requisitionNumber}`);

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
          <div className="tiny dim" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.name}
          </div>
        </div>
      ),
    },
    {
      key: 'requester',
      header: 'Requester',
      sortValue: (r) => r.requester.name,
      render: (r) => (
        <Person
          name={r.requester.name}
          initials={r.requester.initials}
          meta={r.department}
          size="sm"
        />
      ),
    },
    {
      key: 'vendor',
      header: 'Vendor',
      sortValue: (r) => r.vendor,
      render: (r) => (
        <div>
          <div className="small">{r.vendor}</div>
          <div className="tiny dim">{r.category}</div>
        </div>
      ),
    },
    {
      key: 'totalAmount',
      header: 'Amount',
      align: 'right',
      sortValue: (r) => r.totalAmount,
      render: (r) => (
        <div>
          <div style={{ fontWeight: 650 }}>{money(r.totalAmount, r.currency)}</div>
          <div className="tiny dim">
            {r.lineCount} line{r.lineCount === 1 ? '' : 's'}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
    },
    {
      key: 'approvalStage',
      header: 'Stage',
      sortValue: (r) => r.approvalStage,
      render: (r) => <span className="small">{r.approvalStage}</span>,
    },
    {
      key: 'priority',
      header: 'Priority',
      sortValue: (r) => r.priority,
      render: (r) => <Badge tone={priorityTone(r.priority)}>{r.priority}</Badge>,
    },
    {
      key: 'syncState',
      header: 'D365',
      sortValue: (r) => r.syncState,
      render: (r) => (
        <Badge tone={syncTone(r.syncState)} dot>
          {SYNC_LABEL[r.syncState] ?? r.syncState}
        </Badge>
      ),
    },
    {
      key: 'ageDays',
      header: 'Age',
      align: 'right',
      sortValue: (r) => r.ageDays,
      render: (r) => (
        <span className={r.ageDays > 20 ? 'small' : 'small dim'} style={r.ageDays > 20 ? { color: 'var(--warning)', fontWeight: 650 } : undefined}>
          {r.ageDays}d
        </span>
      ),
    },
  ];

  const facets = state.data?.facets;
  const total = state.data?.count ?? 0;
  const shown = state.data?.value.length ?? 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;
  const activeFilters = [stage, department, vendor, sync].filter(Boolean).length;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <div className="page__eyebrow">Workspace</div>
          <h1>Requisitions</h1>
          <p className="page__sub">
            {state.data
              ? `${total} requisition${total === 1 ? '' : 's'} matching your filters`
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
            placeholder="Search number, name, vendor, requester…"
            aria-label="Search requisitions"
          />
        </div>

        <select
          className="select"
          value={stage}
          onChange={(e) => setParam('stage', e.target.value)}
          aria-label="Filter by approval stage"
        >
          <option value="">All stages</option>
          {facets?.stages.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={department}
          onChange={(e) => setParam('department', e.target.value)}
          aria-label="Filter by department"
        >
          <option value="">All departments</option>
          {facets?.departments.map((d) => (
            <option key={d} value={d}>
              {d}
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

        <select
          className="select"
          value={sync}
          onChange={(e) => setParam('sync', e.target.value)}
          aria-label="Filter by D365 sync state"
        >
          <option value="">Any sync state</option>
          <option value="synced">Synced to D365</option>
          <option value="pending">Sync pending</option>
          <option value="error">Sync failed</option>
          <option value="local">Not yet sent</option>
        </select>

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

      {state.loading ? (
        <div className="card card--flush" style={{ padding: '1rem' }}>
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
              defaultSort="totalAmount"
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
