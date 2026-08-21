import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconAlert, IconCheckCircle, IconClock, IconMoney } from '../components/Icons';
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
import { count, money, moneyShort } from '../lib/format';
import { useAsync } from '../lib/hooks';
import type { RequisitionSummary } from '../lib/types';

type Decision = 'approved' | 'rejected';

export function ApprovalsPage() {
  const navigate = useNavigate();
  const state = useAsync(() => api.approvals(), []);

  /**
   * Decisions are recorded locally only.
   *
   * Approving through OData would need a workflow action that this application
   * does not implement yet, and silently doing nothing would be worse than
   * being explicit. The card shows the outcome and says it is a preview.
   */
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const decide = (requisitionNumber: string, decision: Decision) =>
    setDecisions((prev) => ({ ...prev, [requisitionNumber]: decision }));

  if (state.loading) {
    return (
      <div className="page">
        <Skeleton variant="title" />
        <div className="grid grid--kpi">
          <Skeleton variant="kpi" count={3} />
        </div>
        <div className="grid grid--3" style={{ marginTop: '1rem' }}>
          <Skeleton variant="chart" count={3} />
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

  const queue = state.data.value;
  const urgent = queue.filter((r) => r.priority === 'Critical' || r.ageDays > 20);
  const oldest = queue[0]?.ageDays ?? 0;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <div className="page__eyebrow">Workflow</div>
          <h1>Approval queue</h1>
          <p className="page__sub">
            Requisitions awaiting a decision, oldest first. Decisions here are a preview and are not
            written back to Dynamics 365.
          </p>
        </div>
      </div>

      <div className="grid grid--kpi">
        <KpiCard
          label="Awaiting decision"
          value={state.data.count}
          format={count}
          icon={<IconCheckCircle size={16} />}
        />
        <KpiCard
          label="Value in queue"
          value={state.data.totalValue}
          format={(n) => moneyShort(n)}
          icon={<IconMoney size={16} />}
          accent="var(--series-2)"
          soft="var(--teal-soft)"
        />
        <KpiCard
          label="Oldest waiting"
          value={oldest}
          format={(n) => `${Math.round(n)}d`}
          icon={<IconClock size={16} />}
          accent={oldest > 20 ? 'var(--danger)' : 'var(--warning)'}
          soft={oldest > 20 ? 'var(--danger-soft)' : 'var(--warning-soft)'}
        />
        <KpiCard
          label="Needs attention"
          value={urgent.length}
          format={count}
          icon={<IconAlert size={16} />}
          accent="var(--danger)"
          soft="var(--danger-soft)"
          footer={<span className="tiny">critical or over 20 days</span>}
        />
      </div>

      {queue.length === 0 ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <EmptyState title="Queue is clear" hint="Nothing is waiting on an approval decision." />
        </div>
      ) : (
        <div className="grid grid--3" style={{ marginTop: '1rem' }}>
          {queue.map((req) => (
            <ApprovalCard
              key={req.requisitionNumber}
              req={req}
              decision={decisions[req.requisitionNumber]}
              onDecide={(d) => decide(req.requisitionNumber, d)}
              onOpen={() =>
                navigate(`/requisitions/${req.company.toLowerCase()}/${req.requisitionNumber}`)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  req,
  decision,
  onDecide,
  onOpen,
}: {
  req: RequisitionSummary;
  decision?: Decision;
  onDecide: (decision: Decision) => void;
  onOpen: () => void;
}) {
  const urgency =
    req.priority === 'Critical' ? ' approval--critical' : req.priority === 'High' ? ' approval--high' : '';

  return (
    <article className={`approval${urgency}`}>
      <div className="row row--between" style={{ alignItems: 'flex-start' }}>
        <div>
          <button
            type="button"
            onClick={onOpen}
            className="mono"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              font: 'inherit',
              fontWeight: 650,
              color: 'var(--accent)',
              cursor: 'pointer',
            }}
          >
            {req.requisitionNumber}
          </button>
          <div className="tiny dim">{req.department}</div>
        </div>
        <Badge tone={priorityTone(req.priority)}>{req.priority}</Badge>
      </div>

      <div className="approval__amount">{money(req.totalAmount, req.currency)}</div>

      <div className="row" style={{ gap: '0.5rem' }}>
        <Avatar name={req.requester.name} initials={req.requester.initials} size="sm" />
        <div style={{ minWidth: 0 }}>
          <div className="small" style={{ fontWeight: 550 }}>
            {req.requester.name}
          </div>
          <div className="tiny dim">{req.vendor}</div>
        </div>
      </div>

      <div className="row" style={{ gap: '0.4rem' }}>
        <Badge tone={req.ageDays > 20 ? 'danger' : req.ageDays > 10 ? 'warning' : 'neutral'}>
          <IconClock size={11} />
          {req.ageDays}d waiting
        </Badge>
        <Badge tone={syncTone(req.syncState)} dot>
          {SYNC_LABEL[req.syncState] ?? req.syncState}
        </Badge>
      </div>

      <div className="small dim" style={{ lineHeight: 1.4 }}>
        {req.lineCount} line{req.lineCount === 1 ? '' : 's'} · {req.category} · stage{' '}
        {req.approvalStage}
      </div>

      {decision ? (
        <div
          className={`callout ${decision === 'approved' ? '' : 'callout--danger'}`}
          style={
            decision === 'approved'
              ? { background: 'var(--success-soft)', color: 'var(--success)', borderColor: 'transparent' }
              : undefined
          }
        >
          <IconCheckCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <div className="tiny">
            <strong>{decision === 'approved' ? 'Approved' : 'Rejected'} in preview.</strong> Writing
            decisions back to Dynamics 365 requires the workflow action, which is not implemented.
          </div>
        </div>
      ) : (
        <div className="approval__actions">
          <button
            type="button"
            className="btn btn--success btn--sm"
            style={{ flex: 1 }}
            onClick={() => onDecide('approved')}
          >
            Approve
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ flex: 1 }}
            onClick={() => onDecide('rejected')}
          >
            Reject
          </button>
        </div>
      )}
    </article>
  );
}
