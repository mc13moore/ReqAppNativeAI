import { NavLink, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './lib/AppContext';
import { CreateRequisitionPage } from './pages/CreateRequisitionPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { RequisitionDetailPage } from './pages/RequisitionDetailPage';
import { RequisitionListPage } from './pages/RequisitionListPage';

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { config } = useApp();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="topbar__brand">
            <span className="topbar__mark" aria-hidden="true" />
            <span>Requisitions</span>
          </div>

          <nav className="topbar__nav">
            <NavLink to="/" end className={navClass}>
              Requisitions
            </NavLink>
            <NavLink to="/requisitions/new" className={navClass}>
              New
            </NavLink>
            <NavLink to="/diagnostics" className={navClass}>
              Diagnostics
            </NavLink>
          </nav>

          <div className="topbar__meta">
            <span className="topbar__env" title="Default legal entity">
              {config.defaultCompany.toUpperCase()}
            </span>
            {config.authEnabled && (
              <a className="topbar__signout" href="/.auth/logout">
                Sign out
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<RequisitionListPage />} />
          <Route path="/requisitions/new" element={<CreateRequisitionPage />} />
          <Route
            path="/requisitions/:company/:requisitionNumber"
            element={<RequisitionDetailPage />}
          />
          <Route path="/diagnostics" element={<DiagnosticsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `topbar__link${isActive ? ' topbar__link--active' : ''}`;

function NotFound() {
  return (
    <section>
      <h1>Page not found</h1>
      <p className="page-head__sub">That address does not match anything in this app.</p>
    </section>
  );
}
