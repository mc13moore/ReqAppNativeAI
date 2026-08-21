import { formatRelative } from '../lib/format';
import type { TimelineEvent } from '../lib/types';
import { IconAlert, IconCheckCircle, IconClock, IconSync } from './Icons';

function StepIcon({ state }: { state: TimelineEvent['state'] }) {
  if (state === 'complete') return <IconCheckCircle size={14} />;
  if (state === 'blocked') return <IconAlert size={13} />;
  if (state === 'current') return <IconClock size={13} />;
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />;
}

/** Vertical approval timeline: who has acted, who is holding it, what remains. */
export function ApprovalTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="timeline" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {events.map((event) => (
        <li className={`tl-step tl-step--${event.state}`} key={event.stage}>
          <span className="tl-dot">
            <StepIcon state={event.state} />
          </span>
          <div className="tl-body">
            <div className="tl-stage">{event.stage}</div>
            <div className="tl-meta">
              {event.actor && <span>{event.actor}</span>}
              {event.actor && event.timestamp && <span> · </span>}
              {event.timestamp && <span>{formatRelative(event.timestamp)}</span>}
              {!event.timestamp && event.state === 'pending' && <span>Not started</span>}
            </div>
            {event.note && <div className="tl-note">{event.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Horizontal Dynamics 365 integration lifecycle.
 *
 * This is the visual that makes the point to a Dynamics audience: the app is a
 * different front end over the same business process, not a parallel system.
 * Each step corresponds to a real state of the record in F&O.
 */
export function D365Lifecycle({ events }: { events: TimelineEvent[] }) {
  const blocked = events.find((e) => e.state === 'blocked');

  return (
    <div>
      <div className="lifecycle">
        {events.map((event) => (
          <div className={`lc-step lc-step--${event.state}`} key={event.stage}>
            <span className="lc-dot">
              {event.state === 'complete' ? (
                <IconCheckCircle size={14} />
              ) : event.state === 'blocked' ? (
                <IconAlert size={13} />
              ) : event.state === 'current' ? (
                <IconSync size={13} />
              ) : (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
              )}
            </span>
            <span className="lc-label">{event.stage}</span>
            {event.timestamp && (
              <span className="tiny dim" style={{ marginTop: '-0.25rem' }}>
                {formatRelative(event.timestamp)}
              </span>
            )}
          </div>
        ))}
      </div>

      {blocked?.note && (
        <div className="callout callout--danger" style={{ marginTop: '0.9rem' }}>
          <IconAlert size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>Integration issue</strong>
            <div className="tiny" style={{ marginTop: '0.15rem' }}>{blocked.note}</div>
          </div>
        </div>
      )}
    </div>
  );
}
