import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DataGrid, type Column } from '../components/DataGrid';
import { IconAlert, IconChevronLeft, IconSparkles, IconSync } from '../components/Icons';
import {
  Badge,
  EmptyState,
  ErrorBanner,
  Expander,
  Skeleton,
  statusTone,
} from '../components/primitives';
import { api } from '../lib/api';
import { useCopilot } from '../lib/CopilotContext';
import { formatDate, money } from '../lib/format';
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
        <Link to="/requisitions" className="small row" style={{ gap: '0.25rem' }}>
          <IconChevronLeft size={14} />
          All requisitions
        </Link>
        <div style={{ marginTop: '1rem' }}>
          <ErrorBanner error={state.error} onRetry={state.reload} />
        </div>
      </div>
    );
  }

  const { summary, lines, attributes, raw } = state.data;

  const subtotal = lines.reduce((sum, l) => sum + l.lineAmount, 0);
  const discount = lines.reduce((sum, l) => sum + 0, 0);
  const currency = summary.currency || 'USD';

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
          <div style={{ fontWeight: 550 }}>{l.description || <span className="dim">—</span>}</div>
          <div className="tiny dim">
            {l.itemNumber && <span className="mono">{l.itemNumber}</span>}
            {l.itemNumber && l.category && ' · '}
            {l.category}
          </div>
        </div>
      ),
    },
    {
      key: 'vendor',
      header: 'Vendor',
      sortValue: (l) => l.vendor,
      render: (l) => <span className="mono small">{l.vendor || <span className="dim">—</span>}</span>,
    },
    {
      key: 'quantity',
      header: 'Qty',
      align: 'right',
      sortValue: (l) => l.quantity,
      render: (l) => (
        <span className="numeric">
          {l.quantity} {l.unit && <span className="dim">{l.unit}</span>}
        </span>
      ),
    },
    {
      key: 'unitPrice',
      header: 'Unit price',
      align: 'right',
      sortValue: (l) => l.unitPrice,
      render: (l) => <span className="numeric">{money(l.unitPrice, l.currency || currency)}</span>,
    },
    {
      key: 'lineAmount',
      header: 'Amount',
      align: 'right',
      sortValue: (l) => l.lineAmount,
      render: (l) => (
        <span className="numeric" style={{ fontWeight: 650 }}>
          {money(l.lineAmount, l.currency || currency)}
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
    {
      key: 'status',
      header: 'Line status',
      sortValue: (l) => l.lineType,
      render: (l) => <span className="small dim">{l.lineType || '—'}</span>,
    },
  ];

  return (
    <div className="page">
      <Link
        to="/requisitions"
        className="small row"
        style={{ gap: '0.25rem', marginBottom: '0.75rem' }}
      >
        <IconChevronLeft size={14} />
        All requisitions
      </Link>

      <div className="page__head">
        <div>
          <div className="row" style={{ gap: '0.6rem' }}>
            <h1 className="mono">{summary.requisitionNumber}</h1>
            {summary.status && <Badge tone={statusTone(summary.status)}>{summary.status}</Badge>}
            {summary.onHold && (
              <Badge tone="warning" dot>
                On hold
              </Badge>
            )}
          </div>
          {summary.name && <p className="page__sub">{summary.name}</p>}
        </div>

        <div className="row">
          <button type="button" className="btn btn--ghost" onClick={openPanel}>
            <IconSparkles size={15} />
            Ask AI about this
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={state.reload}
            aria-label="Refresh"
          >
            <IconSync size={14} />
          </button>
        </div>
      </div>

      {summary.onHold && summary.onHoldExplanation && (
        <div className="callout callout--warning" style={{ marginBottom: '1rem' }}>
          <IconAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>On hold in Dynamics 365</strong>
            <div className="tiny" style={{ marginTop: '0.15rem' }}>
              {summary.onHoldExplanation}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid--detail">
        <div className="stack">
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Requisition details</h2>
              <span className="card__hint">Read live from Dynamics 365</span>
            </div>

            <dl className="detail-grid">
              {attributes.map((attribute) => (
                <div key={attribute.label}>
                  <dt>{attribute.label}</dt>
                  <dd>{attribute.value}</dd>
                </div>
              ))}
              {summary.requestedDate && (
                <div>
                  <dt>Requested date</dt>
                  <dd>{formatDate(summary.requestedDate)}</dd>
                </div>
              )}
              {summary.accountingDate && (
                <div>
                  <dt>Accounting date</dt>
                  <dd>{formatDate(summary.accountingDate)}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Line items ({lines.length})</h2>
              {summary.categories.length > 0 && (
                <span className="card__hint">{summary.categories.join(' · ')}</span>
              )}
            </div>

            {lines.length === 0 ? (
              <EmptyState
                title="No lines on this requisition"
                hint="Dynamics 365 returned no line records for this requisition number."
              />
            ) : (
              <>
                <DataGrid
                  columns={lineColumns}
                  rows={lines}
                  rowKey={(l) => String(l.lineNumber)}
                  defaultSort="lineNumber"
                  defaultDirection="asc"
                />

                <div style={{ marginTop: '1rem', marginLeft: 'auto', maxWidth: 300 }}>
                  <div className="total-row total-row--grand">
                    <span>Total</span>
                    <span className="numeric">{money(subtotal, currency)}</span>
                  </div>
                  <p className="tiny dim" style={{ marginTop: '0.3rem' }}>
                    Sum of line amounts as held in Dynamics 365. Taxes and charges are not
                    calculated here.
                  </p>
                </div>
              </>
            )}
          </div>

          {raw && (
            <Expander title="Raw Dynamics 365 record">
              <pre
                style={{
                  margin: 0,
                  fontSize: '0.7rem',
                  fontFamily: 'var(--mono)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '22rem',
                  overflowY: 'auto',
                }}
              >
                {JSON.stringify(raw, null, 2)}
              </pre>
            </Expander>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Total</h2>
            </div>
            <div
              className="numeric"
              style={{ fontSize: '1.9rem', fontWeight: 670, letterSpacing: '-0.03em' }}
            >
              {summary.hasLineData ? money(summary.totalAmount, currency) : '—'}
            </div>
            <div className="small dim" style={{ marginTop: '0.2rem' }}>
              {summary.hasLineData
                ? `across ${summary.lineCount} line${summary.lineCount === 1 ? '' : 's'}`
                : 'no line data returned'}
            </div>
          </div>

          {summary.vendors.length > 0 && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Vendors</h2>
              </div>
              <div className="stack stack--sm">
                {summary.vendors.map((vendor) => (
                  <div className="row row--between" key={vendor}>
                    <span className="mono small">{vendor}</span>
                    <span className="tiny dim">
                      {lines.filter((l) => l.vendor === vendor).length} line
                      {lines.filter((l) => l.vendor === vendor).length === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {lines.some((l) => l.justificationDetails) && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Business justification</h2>
              </div>
              <div className="stack stack--sm">
                {lines
                  .filter((l) => l.justificationDetails)
                  .map((l) => (
                    <div key={l.lineNumber}>
                      <div className="tiny dim">Line {l.lineNumber}</div>
                      <div className="small">{l.justificationDetails}</div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
