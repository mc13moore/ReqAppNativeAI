import { ColumnChart, DonutChart, HorizontalBars } from '../components/Charts';
import { IconAlert, IconTrendUp } from '../components/Icons';
import { Badge, EmptyState, ErrorBanner, Skeleton } from '../components/primitives';
import { api } from '../lib/api';
import { money, moneyShort } from '../lib/format';
import { useAsync } from '../lib/hooks';

export function AnalyticsPage() {
  const state = useAsync(() => api.analytics(), []);

  if (state.loading) {
    return (
      <div className="page">
        <Skeleton variant="title" />
        <div className="grid grid--2">
          <Skeleton variant="chart" count={4} />
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

  const { analytics: a, headerCount, lineCount } = state.data;
  const currency = a.totals.currency;
  const fmt = (n: number) => moneyShort(n, currency);

  const hasSpendData = a.totals.totalRequestedSpend > 0;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <div className="page__eyebrow">Insight</div>
          <h1>Spend analytics</h1>
          <p className="page__sub">
            Aggregated from {headerCount} requisition{headerCount === 1 ? '' : 's'} and {lineCount}{' '}
            line{lineCount === 1 ? '' : 's'} read from Dynamics 365.
          </p>
        </div>
        {hasSpendData && (
          <Badge tone="info">{money(a.totals.averageValue, currency)} average requisition</Badge>
        )}
      </div>

      {!hasSpendData ? (
        <div className="card">
          <EmptyState
            title="No spend data available"
            hint="Requisition lines carry the amounts. None were returned for this environment, so there is nothing to aggregate."
          />
        </div>
      ) : (
        <>
          {a.byMonth.length > 1 && (
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="card__head">
                <h2 className="card__title">Spend over time</h2>
                <span className="card__hint">By requested date on the requisition</span>
              </div>
              <ColumnChart data={a.byMonth} format={fmt} height={230} />
            </div>
          )}

          <div className="grid grid--2">
            {a.byVendor.length > 0 && (
              <div className="card">
                <div className="card__head">
                  <h2 className="card__title">Spend by vendor</h2>
                  <span className="card__hint">Vendor account number on lines</span>
                </div>
                <HorizontalBars data={a.byVendor} format={fmt} />
              </div>
            )}

            {a.byCategory.length > 0 && (
              <div className="card">
                <div className="card__head">
                  <h2 className="card__title">Spend by category</h2>
                  <span className="card__hint">Procurement category on lines</span>
                </div>
                <HorizontalBars data={a.byCategory} format={fmt} />
              </div>
            )}

            {a.byStatus.length > 0 && (
              <div className="card">
                <div className="card__head">
                  <h2 className="card__title">Value by status</h2>
                </div>
                <DonutChart
                  data={a.byStatus}
                  format={fmt}
                  centerValue={fmt(a.totals.totalRequestedSpend)}
                  centerLabel="total"
                />
              </div>
            )}

            {a.byPreparer.length > 0 && (
              <div className="card">
                <div className="card__head">
                  <h2 className="card__title">Spend by preparer</h2>
                  <span className="card__hint">Personnel number on the requisition header</span>
                </div>
                <HorizontalBars data={a.byPreparer} format={fmt} />
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <div className="card__head">
              <h2 className="card__title">
                <IconTrendUp size={15} />
                Above category median
              </h2>
              <span className="card__hint">
                Requisitions more than 2.5× their category median
              </span>
            </div>

            {a.outliers.length === 0 ? (
              <p className="small dim">
                Nothing exceeds its category median by a wide margin, or no category yet holds the
                six requisitions needed for the comparison to mean anything.
              </p>
            ) : (
              <div className="stack stack--sm">
                {a.outliers.map((o) => (
                  <div className="callout callout--warning" key={o.requisitionNumber}>
                    <IconAlert size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row row--between">
                        <strong className="mono">{o.requisitionNumber}</strong>
                        <strong className="numeric">{money(o.amount, currency)}</strong>
                      </div>
                      <div className="tiny" style={{ marginTop: '0.1rem' }}>
                        {o.multiple}× the {o.category} median of {money(o.medianAmount, currency)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
