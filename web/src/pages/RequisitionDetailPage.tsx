import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DataGrid, type Column } from '../components/DataGrid';
import {
  IconChevronLeft,
  IconDoc,
  IconSparkles,
  IconSync,
} from '../components/Icons';
import {
  Avatar,
  Badge,
  Expander,
  ErrorBanner,
  Skeleton,
  priorityTone,
  statusTone,
  syncTone,
  SYNC_LABEL,
} from '../components/primitives';
import { ApprovalTimeline, D365Lifecycle } from '../components/Timeline';
import { api } from '../lib/api';
import { formatDate, formatRelative, money } from '../lib/format';
import { useCopilot } from '../lib/CopilotContext';
import { useAsync } from '../lib/hooks';
import type { RequisitionLineView } from '../lib/types';

export function RequisitionDetailPage() {
  const { company = '', requisitionNumber = '' } = useParams();
  const { setContext, openPanel } = useCopilot();

  const state = useAsync(
    () => api.requisitionDetail(company, requisitionNumber),
    [company, requisitionNumber],
  );

  // Point the assistant at whichever requisition is on screen, so its answers
  // are about this record rather than the population as a whole.
  useEffect(() => {
    setContext({ company, requisitionNumber, label: requisitionNumber });
    return () => setContext({});
  }, [company, requisitionNumber, setContext]);

  if (state.loading) {
    return (
      <div className="page">
        <Skeleton variant="title" />
        <Skeleton variant="chart" />
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="page">
        <Link to="/requisitions" className="small">
          ← All requisitions
        </Link>
        <div style={{ marginTop: '1rem' }}>
          <ErrorBanner error={state.error} onRetry={state.reload} />
        </div>
      </div>
    );
  }

  const { summary, lines, approvalTimeline, d365Timeline, financialDimensions, attachments, source } =
    state.data;

  const subtotal = lines.reduce((sum, l) => sum + l.lineAmount, 0);
  const tax = subtotal * 0.0825;

  const lineColumns: Column<RequisitionLineView>[] = [
    {
      key: 'lineNumber',
      header: '#',
      width: '48px',
      sortValue: (l) => l.lineNumber,
      render: (l) => <span className="mono dim">{l.lineNumber}</span>,
    },
    {
      key: 'description',
      header: 'Description',
      sortValue: (l) => l.description,
      render: (l) => (
        <div>
          <div style={{ fontWeight: 550 }}>{l.description}</div>
          <div className="tiny dim">
            {l.itemNumber && <span className="mono">{l.itemNumber}</span>}
            {l.itemNumber && l.category && ' · '}
            {l.category}
          </div>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Qty',
      align: 'right',
      sortValue: (l) => l.quantity,
      render: (l) => (
        <span className="numeric">
          {l.quantity} <span className="dim">{l.unit}</span>
        </span>
      ),
    },
    {
      key: 'unitPrice',
      header: 'Unit price',
      align: 'right',
      sortValue: (l) => l.unitPrice,
      render: (l) => <span className="numeric">{money(l.unitPrice, l.currency)}</span>,
    },
    {
      key: 'lineAmount',
      header: 'Amount',
      align: 'right',
      sortValue: (l) => l.lineAmount,
      render: (l) => (
        <span className="numeric" style={{ fontWeight: 650 }}>
          {money(l.lineAmount, l.currency)}
        </span>
      ),
    },
    {
      key: 'requestedDate',
      header: 'Needed by',
      align: 'right',
      sortValue: (l) => l.requestedDate,
      render: (l) => <span className="small dim">{formatDate(l.requestedDate)}</span>,
    },
  ];

  return (
    <div className="page">
      <Link to="/requisitions" className="small row" style={{ gap: '0.25rem', marginBottom: '0.75rem' }}>
        <IconChevronLeft size={14} />
        All requisitions
      </Link>

      <div className="page__head">
        <div>
          <div className="row" style={{ gap: '0.6rem' }}>
            <h1 className="mono">{summary.requisitionNumber}</h1>
            <Badge tone={statusTone(summary.status)}>{summary.status}</Badge>
            <Badge tone={priorityTone(summary.priority)}>{summary.priority}</Badge>
            <Badge tone={syncTone(summary.syncState)} dot>
              {SYNC_LABEL[summary.syncState] ?? summary.syncState}
            </Badge>
            {!summary.live && <Badge tone="neutral">Sample record</Badge>}
          </div>
          <p className="page__sub">{summary.name}</p>
        </div>

        <div className="row">
          <button type="button" className="btn btn--ghost" onClick={openPanel}>
            <IconSparkles size={15} />
            Ask AI about this
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={state.reload}>
            <IconSync size={14} />
          </button>
        </div>
      </div>

      {/* --- D365 integration lifecycle: the headline visual -------------- */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card__head">
          <h2 className="card__title">
            <IconSync size={15} />
            Dynamics 365 integration lifecycle
          </h2>
          <span className="card__hint">
            {source === 'd365' ? 'Read live from D365' : 'Sample record'}
          </span>
        </div>
        <D365Lifecycle events={d365Timeline} />
      </div>

      <div className="grid grid--detail">
        <div className="stack">
          {/* --- Header facts ------------------------------------------- */}
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Requisition details</h2>
            </div>

            <div className="row" style={{ gap: '0.75rem', marginBottom: '1rem' }}>
              <Avatar name={summary.requester.name} initials={summary.requester.initials} size="lg" />
              <div>
                <div style={{ fontWeight: 650 }}>{summary.requester.name}</div>
                <div className="small dim">
                  {summary.requester.title} · {summary.department}
                </div>
                <div className="tiny dim mono">Personnel #{summary.requester.personnelNumber}</div>
              </div>
            </div>

            <dl className="detail-grid">
              <div>
                <dt>Vendor</dt>
                <dd>{summary.vendor}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{summary.category}</dd>
              </div>
              <div>
                <dt>Purpose</dt>
                <dd>{summary.purpose}</dd>
              </div>
              <div>
                <dt>Legal entity</dt>
                <dd>{summary.company}</dd>
              </div>
              <div>
                <dt>Requested date</dt>
                <dd>{formatDate(summary.requestedDate)}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDate(summary.createdDate)}</dd>
              </div>
              <div>
                <dt>Age</dt>
                <dd>{summary.ageDays} days</dd>
              </div>
              <div>
                <dt>Approval stage</dt>
                <dd>{summary.approvalStage}</dd>
              </div>
            </dl>
          </div>

          {/* --- Lines --------------------------------------------------- */}
          <div className="card card--flush">
            <div className="card__head" style={{ padding: '1.15rem 1.15rem 0' }}>
              <h2 className="card__title">Line items ({lines.length})</h2>
            </div>
            <div style={{ padding: '0.9rem 1.15rem 1.15rem' }}>
              <DataGrid
                columns={lineColumns}
                rows={lines}
                rowKey={(l) => String(l.lineNumber)}
                defaultSort="lineNumber"
                defaultDirection="asc"
                emptyTitle="No lines on this requisition"
              />

              <div style={{ marginTop: '1rem', marginLeft: 'auto', maxWidth: 320 }}>
                <div className="total-row">
                  <span className="muted">Subtotal</span>
                  <span className="numeric">{money(subtotal, summary.currency)}</span>
                </div>
                <div className="total-row">
                  <span className="muted">Estimated tax (8.25%)</span>
                  <span className="numeric">{money(tax, summary.currency)}</span>
                </div>
                <div className="total-row total-row--grand">
                  <span>Total</span>
                  <span className="numeric">{money(subtotal + tax, summary.currency)}</span>
                </div>
              </div>
            </div>
          </div>

          <Expander title="Financial dimensions">
            <dl className="detail-grid">
              {financialDimensions.map((dim) => (
                <div key={dim.label}>
                  <dt>{dim.label}</dt>
                  <dd className="mono">{dim.value}</dd>
                </div>
              ))}
            </dl>
          </Expander>

          {state.data.raw && (
            <Expander title="Raw Dynamics 365 record">
              <pre
                style={{
                  margin: 0,
                  fontSize: '0.7rem',
                  fontFamily: 'var(--mono)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '20rem',
                  overflowY: 'auto',
                }}
              >
                {JSON.stringify(state.data.raw, null, 2)}
              </pre>
            </Expander>
          )}
        </div>

        {/* --- Right rail --------------------------------------------- */}
        <div className="stack">
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Total requested</h2>
            </div>
            <div style={{ fontSize: '1.9rem', fontWeight: 670, letterSpacing: '-0.03em' }} className="numeric">
              {money(summary.totalAmount, summary.currency)}
            </div>
            <div className="small dim" style={{ marginTop: '0.2rem' }}>
              across {summary.lineCount} line{summary.lineCount === 1 ? '' : 's'}
            </div>

            {summary.syncMessage && (
              <div
                className={`callout ${summary.syncState === 'error' ? 'callout--danger' : 'callout--warning'}`}
                style={{ marginTop: '0.9rem' }}
              >
                <IconSync size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                <div className="tiny">{summary.syncMessage}</div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Approval workflow</h2>
            </div>
            <ApprovalTimeline events={approvalTimeline} />

            {summary.approvalStage !== 'Approved' && (
              <div className="row" style={{ marginTop: '1rem', gap: '0.5rem' }}>
                <button type="button" className="btn btn--success btn--sm" style={{ flex: 1 }}>
                  Approve
                </button>
                <button type="button" className="btn btn--ghost btn--sm" style={{ flex: 1 }}>
                  Request info
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">
                <IconDoc size={15} />
                Attachments ({attachments.length})
              </h2>
            </div>
            {attachments.length === 0 ? (
              <p className="small dim">No documents attached.</p>
            ) : (
              attachments.map((file) => (
                <div className="attachment" key={file.name}>
                  <IconDoc size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {file.name}
                    </div>
                    <div className="tiny dim">
                      {file.sizeKb} KB · {formatRelative(file.uploadedOn)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
