import { LayoutDashboard, LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { clearSession } from '../api/client';
import { moduleList } from '../data/modules';

export default function AppLayout({ user, setUser, page, setPage, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const modules = moduleList(user);

  const currentTitle =
    page === 'dashboard'
      ? 'Dashboard'
      : modules.find((module) => module[0] === page)?.[1] || 'Access Restricted';

  function goTo(nextPage) {
    setPage(nextPage);
    setSidebarOpen(false);
  }

  function logout() {
    clearSession();
    setUser(null);
    setPage('dashboard');
    setSidebarOpen(false);
  }

  return (
    <div className="app-shell">
      <button
        type="button"
        className={`mobile-menu-btn ${sidebarOpen ? 'active' : ''}`}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="side-brand">
          <span>SDS</span>
          <b>HRMS</b>
        </div>

        <nav>
          <button
            type="button"
            className={page === 'dashboard' ? 'active' : ''}
            onClick={() => goTo('dashboard')}
          >
            <LayoutDashboard size={18} /> Dashboard
          </button>

          {modules.map(([key, title, Icon]) => (
            <button
              type="button"
              key={key}
              className={page === key ? 'active' : ''}
              onClick={() => goTo(key)}
            >
              {Icon ? <Icon size={18} /> : null}
              {title}
            </button>
          ))}
        </nav>

        <button type="button" className="logout" onClick={logout}>
          <LogOut size={18} /> Logout
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h2>{currentTitle}</h2>
            <p>
              {(user?.roles || []).join(', ')}
              {user?.tenant_id ? ` • ${user.tenant_id}` : ''}
            </p>
          </div>

          <div className="user-chip">{user?.name || user?.email}</div>
        </header>

        {children}
      </main>
    </div>
  );
}