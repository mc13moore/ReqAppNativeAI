import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../lib/AppContext';
import { useCopilot } from '../lib/CopilotContext';
import {
  IconChart,
  IconCheckCircle,
  IconDashboard,
  IconList,
  IconMenu,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkles,
} from './Icons';

/**
 * Live connection indicator.
 *
 * Reports where the data on screen actually came from. A demo that quietly
 * shows generated records as though they were live would undermine the whole
 * point of an integration demonstration, so the state is always visible.
 */
function ConnectionIndicator() {
  const { requisitionCount } = useApp();

  return (
    <div className="conn" title="All data is read live from Dynamics 365">
      <span className="conn__dot conn__dot--live" />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600, color: 'var(--text)' }}>
          Dynamics 365 FSC
        </span>
        <span className="tiny dim">
          {requisitionCount === null
            ? 'Connecting…'
            : `${requisitionCount} requisition${requisitionCount === 1 ? '' : 's'} live`}
        </span>
      </span>
    </div>
  );
}

const NAV = [
  { to: '/', label: 'Command Center', icon: IconDashboard, end: true },
  { to: '/requisitions', label: 'Requisitions', icon: IconList },
  { to: '/analytics', label: 'Spend Analytics', icon: IconChart },
];

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { openPanel } = useCopilot();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Ctrl/Cmd+K focuses global search, the convention users already expect.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    navigate(`/requisitions?search=${encodeURIComponent(search.trim())}`);
    setSidebarOpen(false);
  };

  return (
    <div className="shell">
      <aside className={`sidebar${sidebarOpen ? ' sidebar--open' : ''}`}>
        <div className="sidebar__brand">
          <span className="sidebar__mark">
            <IconCheckCircle size={19} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="sidebar__title" style={{ display: 'block' }}>
              Procurement
            </span>
            <span className="sidebar__subtitle">Native AI</span>
          </span>
        </div>

        <nav className="sidebar__nav">
          <div className="sidebar__section">Workspace</div>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `navlink${isActive ? ' navlink--active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <item.icon size={17} />
              {item.label}
            </NavLink>
          ))}

          <div className="sidebar__section">Create</div>
          <NavLink
            to="/requisitions/new"
            className={({ isActive }) => `navlink${isActive ? ' navlink--active' : ''}`}
            onClick={() => setSidebarOpen(false)}
          >
            <IconPlus size={17} />
            New requisition
          </NavLink>

          <div className="sidebar__section">System</div>
          <NavLink
            to="/diagnostics"
            className={({ isActive }) => `navlink${isActive ? ' navlink--active' : ''}`}
            onClick={() => setSidebarOpen(false)}
          >
            <IconSettings size={17} />
            Diagnostics
          </NavLink>
        </nav>

        <div className="sidebar__footer">
          <ConnectionIndicator />
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="btn btn--subtle btn--icon"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle navigation"
            style={{ display: 'none' }}
            data-mobile-only
          >
            <IconMenu size={18} />
          </button>

          <form className="topbar__search" onSubmit={submitSearch} role="search">
            <IconSearch size={15} />
            <input
              id="global-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search requisitions, vendors, requesters…   Ctrl+K"
              aria-label="Search requisitions"
            />
          </form>

          <div className="topbar__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={openPanel}
            >
              <IconSparkles size={15} />
              AI Copilot
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => navigate('/requisitions/new')}
            >
              <IconPlus size={15} />
              New
            </button>
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
