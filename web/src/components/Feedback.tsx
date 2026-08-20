import type { ReactNode } from 'react';
import { ApiError } from '../lib/api';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner__dot" />
      <span>{label}</span>
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
      <div className="banner__body">
        <strong>{fromD365 ? 'Dynamics 365 rejected the request' : 'Something went wrong'}</strong>
        <p>{message}</p>
        {details.length > 0 && (
          <ul className="banner__list">
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        )}
        {upstream && (
          // Collapsed by default: it is verbose and only matters when the
          // summary above is not enough, but it is the message that actually
          // names the offending entity or property.
          <details className="banner__detail">
            <summary>What Dynamics 365 said</summary>
            <pre>{upstream}</pre>
          </details>
        )}
      </div>
      {onRetry && (
        <button type="button" className="btn btn--ghost" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function SuccessBanner({ children }: { children: ReactNode }) {
  return (
    <div className="banner banner--success" role="status">
      <div className="banner__body">{children}</div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {hint && <p className="empty__hint">{hint}</p>}
    </div>
  );
}

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
