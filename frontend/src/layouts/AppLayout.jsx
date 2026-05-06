import { LayoutDashboard, LogOut } from 'lucide-react';
import { clearSession } from '../api/client';
import { moduleList } from '../data/modules';

export default function AppLayout({ user, setUser, page, setPage, children }) {
  const modules = moduleList(user);

  const currentTitle =
    page === 'dashboard'
      ? 'Dashboard'
      : modules.find((module) => module[0] === page)?.[1] || 'Access Restricted';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="side-brand">
          <span>SDS</span>
          <b>HRMS</b>
        </div>

        <nav>
          <button
            className={page === 'dashboard' ? 'active' : ''}
            onClick={() => setPage('dashboard')}
          >
            <LayoutDashboard size={18} /> Dashboard
          </button>

          {modules.map(([key, title, Icon]) => (
            <button
              key={key}
              className={page === key ? 'active' : ''}
              onClick={() => setPage(key)}
            >
              <Icon size={18} /> {title}
            </button>
          ))}
        </nav>

        <button
          className="logout"
          onClick={() => {
            clearSession();
            setUser(null);
            setPage('dashboard');
          }}
        >
          <LogOut size={18} /> Logout
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h2>{currentTitle}</h2>
            <p>
              {(user.roles || []).join(', ')}
              {user.tenant_id ? ` • ${user.tenant_id}` : ''}
            </p>
          </div>

          <div className="user-chip">{user.name || user.email}</div>
        </header>

        {children}
      </main>
    </div>
  );
}