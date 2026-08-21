import { ColumnChart, DonutChart, HorizontalBars, StageFunnel } from '../components/Charts';
import { IconAlert, IconClock, IconTrendUp } from '../components/Icons';
import { Badge, ErrorBanner, Skeleton } from '../components/primitives';
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

  const { analytics: a } = state.data;
  const currency = a.totals.currency;
  const fmt = (n: number) => moneyShort(n, currency);

  const avgPerReq =
    a.byDepartment.reduce((s, d) => s + (d.count ?? 0), 0) > 0
      ? a.totals.totalRequestedSpend / a.byDepartment.reduce((s, d) => s + (d.count ?? 0), 0)
      : 0;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <div className="page__eyebrow">Insight</div>
          <h1>Spend analytics</h1>
          <p className="page__sub">
            Requested spend across vendors, categories, departments and time.
          </p>
        </div>
        <div className="row">
          <Badge tone="info">{money(avgPerReq, currency)} average requisition</Badge>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card__head">
          <h2 className="card__title">Spend over time</h2>
          <span className="card__hint">Requested value by month created</span>
        </div>
        <ColumnChart data={a.byMonth} format={fmt} height={230} />
      </div>

      <div className="grid grid--2">
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Spend by vendor</h2>
            <span className="card__hint">Top {Math.min(8, a.byVendor.length)}</span>
          </div>
          <HorizontalBars data={a.byVendor} format={fmt} />
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Spend by department</h2>
          </div>
          <HorizontalBars data={a.byDepartment} format={fmt} />
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Spend by category</h2>
          </div>
          <DonutChart
            data={a.byCategory}
            format={fmt}
            centerValue={fmt(a.totals.totalRequestedSpend)}
            centerLabel="total"
          />
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Approval pipeline</h2>
            <span className="card__hint">Volume and value held at each stage</span>
          </div>
          <StageFunnel data={a.byStage} format={fmt} />
        </div>
      </div>

      <div className="grid grid--2" style={{ marginTop: '1rem' }}>
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">
              <IconClock size={15} />
              Approval bottlenecks
            </h2>
          </div>
          {a.bottlenecks.length === 0 ? (
            <p className="small dim">No stage is holding work materially longer than the others.</p>
          ) : (
            <div className="stack stack--sm">
              {a.bottlenecks.map((b) => (
                <div className="callout callout--warning" key={b.stage}>
                  <IconClock size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <strong>{b.stage}</strong>
                    <div className="tiny" style={{ marginTop: '0.1rem' }}>
                      {b.count} requisition{b.count === 1 ? '' : 's'} waiting an average of{' '}
                      {b.averageAgeDays} days
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">
              <IconTrendUp size={15} />
              Spend anomalies
            </h2>
            <span className="card__hint">Against the median for each category</span>
          </div>
          {a.anomalies.length === 0 ? (
            <p className="small dim">Nothing sits far outside its category norm.</p>
          ) : (
            <div className="stack stack--sm">
              {a.anomalies.map((anomaly) => (
                <div className="callout callout--danger" key={anomaly.requisitionNumber}>
                  <IconAlert size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row row--between">
                      <strong className="mono">{anomaly.requisitionNumber}</strong>
                      <strong className="numeric">{money(anomaly.amount, currency)}</strong>
                    </div>
                    <div className="tiny" style={{ marginTop: '0.1rem' }}>
                      {anomaly.reason} · {anomaly.vendor} · {anomaly.department}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
