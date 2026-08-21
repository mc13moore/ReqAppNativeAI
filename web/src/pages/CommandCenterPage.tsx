import { Link, useNavigate } from 'react-router-dom';
import { ColumnChart, DonutChart, HorizontalBars, StageFunnel } from '../components/Charts';
import {
  IconAlert,
  IconCheckCircle,
  IconChevronRight,
  IconClock,
  IconInbox,
  IconMoney,
  IconSync,
  IconTrendUp,
} from '../components/Icons';
import {
  Avatar,
  Badge,
  EmptyState,
  ErrorBanner,
  KpiCard,
  Skeleton,
  priorityTone,
  syncTone,
  SYNC_LABEL,
} from '../components/primitives';
import { api } from '../lib/api';
import { count, formatRelative, money, moneyShort } from '../lib/format';
import { useAsync } from '../lib/hooks';

export function CommandCenterPage() {
  const navigate = useNavigate();

  const analytics = useAsync(() => api.analytics(), []);
  const activity = useAsync(() => api.activity(), []);
  const approvals = useAsync(() => api.approvals(), []);

  if (analytics.loading) {
    return (
      <div className="page">
        <Skeleton variant="title" />
        <div className="grid grid--kpi" style={{ marginTop: '1.25rem' }}>
          <Skeleton variant="kpi" count={5} />
        </div>
        <div className="grid grid--2" style={{ marginTop: '1rem' }}>
          <Skeleton variant="chart" />
          <Skeleton variant="chart" />
        </div>
      </div>
    );
  }

  if (analytics.error || !analytics.data) {
    return (
      <div className="page">
        <ErrorBanner error={analytics.error} onRetry={analytics.reload} />
      </div>
    );
  }

  const { analytics: a, source, liveCount, demoCount } = analytics.data;
  const t = a.totals;

  const syncTotal = t.syncedCount + t.pendingSyncCount + t.errorSyncCount;
  const syncHealth = syncTotal > 0 ? Math.round((t.syncedCount / syncTotal) * 100) : 100;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <div className="page__eyebrow">Procurement</div>
          <h1>Command Center</h1>
          <p className="page__sub">
            Live view of requisition volume, spend and Dynamics 365 integration health.
          </p>
        </div>
        <div className="row">
          <Badge tone={source === 'demo' ? 'warning' : 'success'} dot>
            {source === 'd365'
              ? `${liveCount} live from D365`
              : source === 'blended'
                ? `${liveCount} live + ${demoCount} sample`
                : `${demoCount} sample records`}
          </Badge>
          <button type="button" className="btn btn--ghost btn--sm" onClick={analytics.reload}>
            <IconSync size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* --- KPI row ------------------------------------------------------- */}
      <div className="grid grid--kpi">
        <KpiCard
          label="Open Requisitions"
          value={t.openRequisitions}
          format={count}
          icon={<IconInbox size={16} />}
          delta={12}
          deltaLabel="vs last month"
        />
        <KpiCard
          label="Pending Approval"
          value={t.pendingApproval}
          format={count}
          icon={<IconClock size={16} />}
          accent="var(--warning)"
          soft="var(--warning-soft)"
          footer={
            approvals.data ? (
              <span className="tiny">{moneyShort(approvals.data.totalValue)} in queue</span>
            ) : undefined
          }
        />
        <KpiCard
          label="Total Requested Spend"
          value={t.totalRequestedSpend}
          format={(n) => moneyShort(n, t.currency)}
          icon={<IconMoney size={16} />}
          accent="var(--series-2)"
          soft="var(--teal-soft)"
          delta={8}
          deltaLabel="vs last quarter"
        />
        <KpiCard
          label="Avg Approval Time"
          value={t.averageApprovalDays}
          format={(n) => `${n.toFixed(1)}d`}
          icon={<IconTrendUp size={16} />}
          accent="var(--series-3)"
          soft="var(--purple-soft)"
          delta={-6}
          deltaLabel="faster than last month"
        />
        <KpiCard
          label="D365 Sync Health"
          value={syncHealth}
          format={(n) => `${Math.round(n)}%`}
          icon={<IconSync size={16} />}
          accent={t.errorSyncCount > 0 ? 'var(--danger)' : 'var(--success)'}
          soft={t.errorSyncCount > 0 ? 'var(--danger-soft)' : 'var(--success-soft)'}
          footer={
            <span className="tiny">
              {t.syncedCount} synced · {t.pendingSyncCount} pending · {t.errorSyncCount} failed
            </span>
          }
        />
      </div>

      {/* --- Alerts -------------------------------------------------------- */}
      {(a.bottlenecks.length > 0 || a.anomalies.length > 0 || t.errorSyncCount > 0) && (
        <div className="grid grid--3" style={{ marginTop: '1rem' }}>
          {t.errorSyncCount > 0 && (
            <div className="callout callout--danger">
              <IconAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>{t.errorSyncCount} integration failures</strong>
                <div className="tiny" style={{ marginTop: '0.15rem' }}>
                  Requisitions approved but not transferred to Dynamics 365.
                </div>
                <Link
                  to="/requisitions?sync=error"
                  className="tiny"
                  style={{ display: 'inline-block', marginTop: '0.3rem', fontWeight: 650 }}
                >
                  Review failures →
                </Link>
              </div>
            </div>
          )}

          {a.bottlenecks[0] && (
            <div className="callout callout--warning">
              <IconClock size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>Approval bottleneck</strong>
                <div className="tiny" style={{ marginTop: '0.15rem' }}>
                  {a.bottlenecks[0].count} requisitions held at {a.bottlenecks[0].stage} for an
                  average of {a.bottlenecks[0].averageAgeDays} days.
                </div>
              </div>
            </div>
          )}

          {a.anomalies[0] && (
            <div className="callout callout--warning">
              <IconTrendUp size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>Spend anomaly detected</strong>
                <div className="tiny" style={{ marginTop: '0.15rem' }}>
                  {a.anomalies[0].requisitionNumber} — {money(a.anomalies[0].amount)} is{' '}
                  {a.anomalies[0].reason}.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- Charts -------------------------------------------------------- */}
      <div className="grid grid--sidebar" style={{ marginTop: '1rem' }}>
        <div className="stack">
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Requested spend by month</h2>
              <span className="card__hint">Rolling {a.byMonth.length} months</span>
            </div>
            <ColumnChart data={a.byMonth} format={(n) => moneyShort(n, t.currency)} />
          </div>

          <div className="grid grid--2">
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Spend by department</h2>
              </div>
              <HorizontalBars
                data={a.byDepartment.slice(0, 6)}
                format={(n) => moneyShort(n, t.currency)}
              />
            </div>

            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Top vendors</h2>
              </div>
              <HorizontalBars
                data={a.byVendor.slice(0, 6)}
                format={(n) => moneyShort(n, t.currency)}
              />
            </div>
          </div>

          <div className="grid grid--2">
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Approval pipeline</h2>
                <span className="card__hint">Count and value by stage</span>
              </div>
              <StageFunnel data={a.byStage} format={(n) => moneyShort(n, t.currency)} />
            </div>

            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Spend by category</h2>
              </div>
              <DonutChart
                data={a.byCategory.slice(0, 6)}
                format={(n) => moneyShort(n, t.currency)}
                centerValue={moneyShort(t.totalRequestedSpend, t.currency)}
                centerLabel="total"
              />
            </div>
          </div>
        </div>

        {/* --- Right rail ------------------------------------------------- */}
        <div className="stack">
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">
                <IconCheckCircle size={15} />
                Needs your approval
              </h2>
              <Link to="/approvals" className="tiny" style={{ fontWeight: 650 }}>
                View all
              </Link>
            </div>

            {approvals.loading && <Skeleton variant="row" count={3} />}
            {approvals.data && approvals.data.value.length === 0 && (
              <EmptyState title="Queue is clear" hint="No requisitions are waiting on a decision." />
            )}
            {approvals.data?.value.slice(0, 4).map((req) => (
              <button
                key={req.requisitionNumber}
                type="button"
                onClick={() =>
                  navigate(`/requisitions/${req.company.toLowerCase()}/${req.requisitionNumber}`)
                }
                style={{
                  display: 'flex',
                  gap: '0.6rem',
                  alignItems: 'center',
                  width: '100%',
                  padding: '0.6rem 0',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                  color: 'inherit',
                }}
              >
                <Avatar name={req.requester.name} initials={req.requester.initials} size="sm" />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="small" style={{ fontWeight: 600, display: 'block' }}>
                    {money(req.totalAmount, req.currency)}
                  </span>
                  <span className="tiny dim">
                    {req.requisitionNumber} · {req.department} · {req.ageDays}d
                  </span>
                </span>
                <Badge tone={priorityTone(req.priority)}>{req.priority}</Badge>
                <IconChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />
              </button>
            ))}
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">
                <IconSync size={15} />
                Recently synced to Dynamics
              </h2>
            </div>

            {activity.loading && <Skeleton variant="row" count={4} />}
            {activity.data && (
              <div className="feed">
                {activity.data.value.slice(0, 8).map((event) => (
                  <div className="feed__item" key={event.id}>
                    <Avatar name={event.actor} initials={event.initials} size="sm" />
                    <div className="feed__body">
                      <div className="feed__text">
                        <strong>{event.actor}</strong> {event.message}
                      </div>
                      <div className="feed__time">{formatRelative(event.timestamp)}</div>
                    </div>
                    {event.kind === 'sync-failed' && (
                      <Badge tone={syncTone('error')}>{SYNC_LABEL['error']}</Badge>
                    )}
                    {event.kind === 'synced' && (
                      <Badge tone={syncTone('synced')}>Synced</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
