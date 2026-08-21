import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { IconAlert, IconArrowDown, IconArrowUp, IconInbox } from './Icons';

/* ---------------------------------------------------------------------------
   Status vocabulary
   --------------------------------------------------------------------------- */

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple' | 'teal';

/**
 * Maps the D365 RequisitionStatus value onto a badge tone.
 *
 * Matched loosely because the status vocabulary differs between F&O versions;
 * an unrecognised value falls through to neutral rather than being guessed at.
 */
export function statusTone(status: string): Tone {
  const value = status.toLowerCase();
  if (value.includes('approv') && !value.includes('pend')) return 'success';
  if (value.includes('reject') || value.includes('cancel')) return 'danger';
  if (value.includes('review') || value.includes('pend') || value.includes('submit')) return 'warning';
  if (value.includes('draft')) return 'neutral';
  if (value.includes('closed')) return 'info';
  return 'neutral';
}

export function Badge({
  tone = 'neutral',
  dot,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="badge__dot" />}
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Avatars
   --------------------------------------------------------------------------- */

const AVATAR_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
];

/** Stable colour per person so the same face keeps the same swatch. */
function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

export function Avatar({
  name,
  initials,
  size = 'md',
}: {
  name: string;
  initials?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const text =
    initials ??
    name
      .split(' ')
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

  return (
    <span
      className={`avatar${size === 'sm' ? ' avatar--sm' : size === 'lg' ? ' avatar--lg' : ''}`}
      style={{ background: avatarColor(name) }}
      title={name}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}

export function Person({
  name,
  initials,
  meta,
  size = 'md',
}: {
  name: string;
  initials?: string;
  meta?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className="person">
      <Avatar name={name} initials={initials} size={size} />
      <span style={{ minWidth: 0 }}>
        <span className="person__name">{name}</span>
        {meta && <span className="person__meta" style={{ display: 'block' }}>{meta}</span>}
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Animated counter
   --------------------------------------------------------------------------- */

/**
 * Counts up to a value on mount.
 *
 * Respects prefers-reduced-motion by jumping straight to the final number --
 * an animated figure is decoration, and decoration should never be the reason
 * someone cannot read a KPI.
 */
export function AnimatedNumber({
  value,
  format,
  durationMs = 900,
}: {
  value: number;
  format: (n: number) => string;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(0);
  const frame = useRef<number>();

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reduced || durationMs <= 0) {
      setDisplay(value);
      return;
    }

    const start = performance.now();
    const from = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // Ease-out cubic: fast at first, settling gently on the final value.
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (value - from) * eased);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [value, durationMs]);

  return <>{format(display)}</>;
}

/* ---------------------------------------------------------------------------
   KPI card
   --------------------------------------------------------------------------- */

export function KpiCard({
  label,
  value,
  format,
  icon,
  accent = 'var(--accent)',
  soft = 'var(--accent-soft)',
  delta,
  deltaLabel,
  footer,
  animate = true,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  icon: ReactNode;
  accent?: string;
  soft?: string;
  delta?: number;
  deltaLabel?: string;
  footer?: ReactNode;
  animate?: boolean;
}) {
  const direction = delta === undefined ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

  return (
    <div
      className="kpi"
      style={{ ['--kpi-accent' as string]: accent, ['--kpi-soft' as string]: soft }}
    >
      <div className="kpi__head">
        <span className="kpi__icon">{icon}</span>
        <span className="kpi__label">{label}</span>
      </div>
      <div className="kpi__value">
        {animate ? <AnimatedNumber value={value} format={format} /> : format(value)}
      </div>
      {(delta !== undefined || footer) && (
        <div className="kpi__meta">
          {delta !== undefined && (
            <span className={`kpi__delta kpi__delta--${direction}`}>
              {direction === 'up' ? <IconArrowUp size={11} /> : direction === 'down' ? <IconArrowDown size={11} /> : null}
              {Math.abs(delta)}%
            </span>
          )}
          {deltaLabel && <span className="tiny">{deltaLabel}</span>}
          {footer}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Loading, empty and error states
   --------------------------------------------------------------------------- */

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner__ring" />
      {label}
    </span>
  );
}

export function Skeleton({ variant = 'text', width, count = 1 }: {
  variant?: 'text' | 'title' | 'kpi' | 'row' | 'chart';
  width?: string;
  count?: number;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skeleton skeleton--${variant}`} style={width ? { width } : undefined} />
      ))}
    </>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <IconInbox size={20} />
      </div>
      <p className="empty__title">{title}</p>
      {hint && <p className="empty__hint">{hint}</p>}
      {action && <div style={{ marginTop: '0.9rem' }}>{action}</div>}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof ApiError ? error.errors : [];
  const upstream = error instanceof ApiError ? error.detail : undefined;
  const fromD365 = error instanceof ApiError && error.source === 'd365';

  return (
    <div className="banner banner--error" role="alert">
      <IconAlert size={17} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="banner__title">
          {fromD365 ? 'Dynamics 365 rejected the request' : 'Something went wrong'}
        </div>
        <p>{message}</p>
        {details.length > 0 && (
          <ul className="banner__list">
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        {upstream && (
          <details className="banner__detail">
            <summary>What Dynamics 365 said</summary>
            <pre>{upstream}</pre>
          </details>
        )}
      </div>
      {onRetry && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Expander
   --------------------------------------------------------------------------- */

export function Expander({
  title,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="expander">
      <button
        type="button"
        className="expander__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {title}
        <span className={`expander__chevron${open ? ' expander__chevron--open' : ''}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="9 5 16 12 9 19" />
          </svg>
        </span>
      </button>
      {open && <div className="expander__body">{children}</div>}
    </div>
  );
}
