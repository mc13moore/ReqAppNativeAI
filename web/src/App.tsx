import { Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { CopilotPanel } from './components/CopilotPanel';
import { EmptyState } from './components/primitives';
import { AppProvider } from './lib/AppContext';
import { CopilotProvider, useCopilot } from './lib/CopilotContext';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CommandCenterPage } from './pages/CommandCenterPage';
import { CreateRequisitionPage } from './pages/CreateRequisitionPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { RequisitionDetailPage } from './pages/RequisitionDetailPage';
import { WorkspacePage } from './pages/WorkspacePage';

export default function App() {
  return (
    <AppProvider>
      <CopilotProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<CommandCenterPage />} />
            <Route path="/requisitions" element={<WorkspacePage />} />
            <Route path="/requisitions/new" element={<CreateRequisitionPage />} />
            <Route path="/requisitions/:company/:requisitionNumber" element={<RequisitionDetailPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </CopilotProvider>
    </AppProvider>
  );
}

/**
 * Shell plus the assistant panel.
 *
 * Both sit outside the routed content so navigating between pages never tears
 * down the sidebar or closes an open conversation.
 */
function Layout() {
  const { open, context, closePanel } = useCopilot();

  return (
    <>
      <AppShell>
        <Outlet />
      </AppShell>
      <CopilotPanel open={open} onClose={closePanel} context={context} />
    </>
  );
}

function NotFound() {
  return (
    <div className="page">
      <EmptyState
        title="Page not found"
        hint="That address does not match anything in this application."
      />
    </div>
  );
}
