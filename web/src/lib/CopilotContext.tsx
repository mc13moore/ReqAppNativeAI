import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CopilotContext as Context } from '../components/CopilotPanel';

interface CopilotState {
  open: boolean;
  context: Context;
  openPanel: () => void;
  closePanel: () => void;
  /** Pages call this to tell the assistant which record is on screen. */
  setContext: (context: Context) => void;
}

const CopilotCtx = createContext<CopilotState | null>(null);

/**
 * Holds the assistant's open state and its subject.
 *
 * Lifted above the routes so the panel survives navigation and so any page can
 * hand it a record without threading props through the shell.
 */
export function CopilotProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<Context>({});

  const value = useMemo<CopilotState>(
    () => ({
      open,
      context,
      openPanel: () => setOpen(true),
      closePanel: () => setOpen(false),
      setContext,
    }),
    [open, context],
  );

  return <CopilotCtx.Provider value={value}>{children}</CopilotCtx.Provider>;
}

export function useCopilot(): CopilotState {
  const value = useContext(CopilotCtx);
  if (!value) throw new Error('useCopilot must be used inside CopilotProvider.');
  return value;
}
