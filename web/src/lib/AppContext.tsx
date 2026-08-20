import { createContext, useContext, type ReactNode } from 'react';
import { api } from './api';
import { useAsync } from './hooks';
import { ErrorBanner, Spinner } from '../components/Feedback';
import type { AppConfig, Schema } from './types';

interface AppContextValue {
  config: AppConfig;
  schema: Schema;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * Loads the field schema and environment configuration once, before anything
 * renders. Every table and form in the app is generated from this, so there is
 * no useful UI to show until it has arrived.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const state = useAsync(
    async () => {
      const [config, schema] = await Promise.all([api.config(), api.schema()]);
      return { config, schema };
    },
    [],
  );

  if (state.loading) {
    return (
      <div className="boot">
        <Spinner label="Connecting to Dynamics 365…" />
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="boot">
        <ErrorBanner error={state.error ?? new Error('Configuration unavailable.')} onRetry={state.reload} />
      </div>
    );
  }

  return <AppContext.Provider value={state.data}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider.');
  return value;
}
