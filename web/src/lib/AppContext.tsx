import { createContext, useContext, type ReactNode } from 'react';
import { api } from './api';
import { useAsync } from './hooks';
import { ErrorBanner, Skeleton } from '../components/primitives';
import type { AppConfig, DataSource, Schema } from './types';

interface AppContextValue {
  config: AppConfig;
  schema: Schema;
  /** Where the requisition population is coming from right now. */
  source: DataSource;
  liveCount: number;
  demoCount: number;
  approvalCount: number;
  reload: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * Loads the field schema, environment configuration and a headline count of
 * pending approvals before anything renders.
 *
 * Every table and form is generated from the schema, and the shell's data
 * source indicator depends on knowing where records came from, so there is no
 * useful interface to show until this has arrived.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const state = useAsync(async () => {
    const [config, schema, approvals, sample] = await Promise.all([
      api.config(),
      api.schema(),
      // Neither of these should block the shell from rendering: a failure just
      // means the badge and the source indicator show less, not that the
      // application refuses to start.
      api.approvals().catch(() => ({ value: [], count: 0, totalValue: 0, source: 'demo' as const })),
      // One row is enough: the response carries the source breakdown in its
      // envelope, so this avoids pulling the whole population twice.
      api
        .requisitions({ top: 1 })
        .catch(() => ({ source: 'demo' as const, liveCount: 0, demoCount: 0 })),
    ]);
    return { config, schema, approvals, sample };
  }, []);

  if (state.loading) {
    return (
      <div style={{ padding: '2rem', maxWidth: 1100, margin: '0 auto' }}>
        <Skeleton variant="title" />
        <div className="grid grid--kpi" style={{ marginTop: '1.5rem' }}>
          <Skeleton variant="kpi" count={4} />
        </div>
        <div style={{ marginTop: '1.5rem' }}>
          <Skeleton variant="chart" />
        </div>
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div style={{ padding: '2rem', maxWidth: 640, margin: '4rem auto' }}>
        <ErrorBanner
          error={state.error ?? new Error('Configuration unavailable.')}
          onRetry={state.reload}
        />
      </div>
    );
  }

  const { config, schema, approvals, sample } = state.data;

  return (
    <AppContext.Provider
      value={{
        config,
        schema,
        source: sample.source,
        liveCount: sample.liveCount,
        demoCount: sample.demoCount,
        approvalCount: approvals.count,
        reload: state.reload,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider.');
  return value;
}
