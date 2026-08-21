import { createContext, useContext, type ReactNode } from 'react';
import { api } from './api';
import { useAsync } from './hooks';
import { ErrorBanner, Skeleton } from '../components/primitives';
import type { AppConfig, Schema } from './types';

interface AppContextValue {
  config: AppConfig;
  schema: Schema;
  /** Requisitions currently readable from D365, or null if the count failed. */
  requisitionCount: number | null;
  reload: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * Loads the field schema, environment configuration and a headline requisition
 * count before anything renders.
 *
 * Every table and form is generated from the schema, so there is no useful
 * interface to show until it has arrived.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const state = useAsync(async () => {
    const [config, schema, sample] = await Promise.all([
      api.config(),
      api.schema(),
      // One row is enough: the response envelope carries the total, so this
      // avoids pulling the whole population twice. A failure here must not
      // block the shell from rendering -- the indicator just shows less.
      api.requisitions({ top: 1 }).catch(() => null),
    ]);
    return { config, schema, sample };
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

  const { config, schema, sample } = state.data;

  return (
    <AppContext.Provider
      value={{
        config,
        schema,
        requisitionCount: sample ? sample.total : null,
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
