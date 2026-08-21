import { Link } from 'react-router-dom';
import { ColumnChart, DonutChart, HorizontalBars } from '../components/Charts';
import {
  IconAlert,
  IconChart,
  IconDoc,
  IconInbox,
  IconMoney,
  IconSync,
  IconTrendUp,
} from '../components/Icons';
import { Badge, EmptyState, ErrorBanner, KpiCard, Skeleton } from '../components/primitives';
import { api } from '../lib/api';
import { count, money, moneyShort } from '../lib/format';
import { useAsync } from '../lib/hooks';

export function CommandCenterPage() {
  const state = useAsync(() => api.analytics(), []);

  if (state.loading) {
    return (
      <div className="page">
        <Skeleton variant="title" />
        <div className="grid grid--kpi" style={{ marginTop: '1.25rem' }}>
          <Skeleton variant="kpi" count={5} />
        </div>
        <div className="grid grid--2" style={{ marginTop: '1rem' }}>
          <Skeleton variant="chart" count={2} />
        </div>
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="page">
        <ErrorBanner error={state.error} onRetry={state.reload} />
      </div>
    );
  }

  const { analytics: a, headerCount, lineCount, lineError } = state.data;
  const t = a.totals;

  if (headerCount === 0) {
    return (
      <div className="page">
        <div className="page__head">
          <div>
            <div className="page__eyebrow">Procurement</div>
            <h1>Command Center</h1>
          </div>
        </div>
        <div className="card">
          <EmptyState
            title="No requisitions returned from Dynamics 365"
            hint="The connection succeeded but the requisition entity returned no rows for this environment."
            action={
              <Link to="/diagnostics" className="btn btn--ghost btn--sm">
                Open diagnostics
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <div className="page__eyebrow">Procurement</div>
          <h1>Command Center</h1>
          <p className="page__sub">
            Every figure below is read directly from Dynamics 365 Finance &amp; Operations.
          </p>
        </div>
        <div className="row">
          <Badge tone="success" dot>
            {headerCount} requisitions · {lineCount} lines
          </Badge>
          <button type="button" className="btn btn--ghost btn--sm" onClick={state.reload}>
            <IconSync size={14} />
            Refresh
          </button>
        </div>
      </div>

      {lineError && (
        <div className="banner banner--warning" style={{ marginBottom: '1rem' }}>
          <IconAlert size={17} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div className="banner__title">Line data could not be read</div>
            <p>
              Requisition headers loaded, but the line entity failed. Totals are shown as zero
              rather than estimated. {lineError}
            </p>
          </div>
        </div>
      )}

      {/* --- KPIs: all derived from real header and line records ---------- */}
      <div className="grid grid--kpi">
        <KpiCard
          label="Requisitions"
          value={t.requisitions}
          format={count}
          icon={<IconDoc size={16} />}
          footer={<span className="tiny">read from D365</span>}
        />
        <KpiCard
          label="Open"
          value={t.openRequisitions}
          format={count}
          icon={<IconInbox size={16} />}
          accent="var(--warning)"
          soft="var(--warning-soft)"
          footer={<span className="tiny">not closed or cancelled</span>}
        />
        <KpiCard
          label="Total Requested Spend"
          value={t.totalRequestedSpend}
          format={(n) => moneyShort(n, t.currency)}
          icon={<IconMoney size={16} />}
          accent="var(--series-2)"
          soft="var(--teal-soft)"
          footer={<span className="tiny">sum of line amounts</span>}
        />
        <KpiCard
          label="Average Value"
          value={t.averageValue}
          format={(n) => moneyShort(n, t.currency)}
          icon={<IconTrendUp size={16} />}
          accent="var(--series-3)"
          soft="var(--purple-soft)"
          footer={<span className="tiny">per requisition with lines</span>}
        />
        <KpiCard
          label="Line Items"
          value={t.lineCount}
          format={count}
          icon={<IconChart size={16} />}
          accent="var(--series-4)"
          soft="var(--warning-soft)"
          footer={
            t.onHold > 0 ? (
              <span className="tiny">{t.onHold} requisition{t.onHold === 1 ? '' : 's'} on hold</span>
            ) : (
              <span className="tiny">none on hold</span>
            )
          }
        />
      </div>

      {t.withoutLineData > 0 && (
        <div className="callout" style={{ marginTop: '1rem' }}>
          <IconAlert size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--text-tertiary)' }} />
          <div className="tiny">
            <strong>{t.withoutLineData}</strong> of {t.requisitions} requisitions have no line data
            in the current read, so their value counts as zero rather than being estimated.
          </div>
        </div>
      )}

      <div className="grid grid--sidebar" style={{ marginTop: '1rem' }}>
        <div className="stack">
          {a.byMonth.length > 1 && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Requested spend by month</h2>
                <span className="card__hint">By requested date on the requisition</span>
              </div>
              <ColumnChart data={a.byMonth} format={(n) => moneyShort(n, t.currency)} />
            </div>
          )}

          <div className="grid grid--2">
            {a.byCategory.length > 0 && (
              <div className="card">
                <div className="card__head">
                  <h2 className="card__title">Spend by category</h2>
                  <span className="card__hint">Procurement category on lines</span>
                </div>
                <HorizontalBars
                  data={a.byCategory.slice(0, 7)}
                  format={(n) => moneyShort(n, t.currency)}
                />
              </div>
            )}

            {a.byVendor.length > 0 && (
              <div className="card">
                <div className="card__head">
                  <h2 className="card__title">Spend by vendor</h2>
                  <span className="card__hint">Vendor account on lines</span>
                </div>
                <HorizontalBars
                  data={a.byVendor.slice(0, 7)}
                  format={(n) => moneyShort(n, t.currency)}
                />
              </div>
            )}
          </div>
        </div>

        <div className="stack">
          {a.byStatus.length > 0 && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">By status</h2>
              </div>
              <DonutChart
                data={a.byStatus}
                format={(n) => moneyShort(n, t.currency)}
                centerValue={String(t.requisitions)}
                centerLabel="requisitions"
              />
            </div>
          )}

          {a.byLegalEntity.length > 0 && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">By legal entity</h2>
              </div>
              <HorizontalBars
                data={a.byLegalEntity}
                format={(n) => moneyShort(n, t.currency)}
              />
            </div>
          )}

          {a.outliers.length > 0 && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">
                  <IconTrendUp size={15} />
                  Above category median
                </h2>
              </div>
              <div className="stack stack--sm">
                {a.outliers.slice(0, 3).map((o) => (
                  <div className="callout callout--warning" key={o.requisitionNumber}>
                    <IconAlert size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row row--between">
                        <strong className="mono">{o.requisitionNumber}</strong>
                        <strong className="numeric">{money(o.amount, t.currency)}</strong>
                      </div>
                      <div className="tiny" style={{ marginTop: '0.1rem' }}>
                        {o.multiple}× the {o.category} median of {money(o.medianAmount, t.currency)}
                      </div>
                    </div>
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
