import { useState, useEffect, useCallback } from 'react';
import { Link, NavLink, useMatch, useParams } from 'react-router-dom';
import { Users, Wrench, FileText, CreditCard, House, CircleUser, Settings, LogOut, Grid3x3 } from 'lucide-react';
import { useSession } from '../session';
import './MobileTabBar.css';

// Iframe modules (Field / Service / Cards / Quotes) embed a full app that owns
// its own bottom controls. On mobile, Shell's fixed bottom tab bar would sit on
// top of those controls and trap the user. For these modules Shell "yields the
// bottom bar": it hides the bottom tabs and surfaces an Apps / app-name control
// in a slim top bar instead, leaving the bottom of the screen to the embedded app.
const IFRAME_MODULES: Record<string, string> = {
  field: 'EQ Field',
  service: 'EQ Service',
  quotes: 'EQ Quotes',
  cards: 'EQ Cards',
};

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(' ');
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

const NAV_TABS = [
  { key: 'home',    label: 'Home',    icon: <House size={20} strokeWidth={2} aria-hidden="true" />,      to: '' },
  { key: 'field',   label: 'Field',   icon: <Users size={20} strokeWidth={2} aria-hidden="true" />,      to: 'field'   },
  { key: 'service', label: 'Service', icon: <Wrench size={20} strokeWidth={2} aria-hidden="true" />,     to: 'service' },
  { key: 'quotes',  label: 'Quotes',  icon: <FileText size={20} strokeWidth={2} aria-hidden="true" />,   to: 'quotes'  },
  { key: 'cards',   label: 'Cards',   icon: <CreditCard size={20} strokeWidth={2} aria-hidden="true" />, to: 'cards'   },
];

/**
 * Mobile-only bottom tab bar (<=767px). Rendered on the dashboard and on
 * iframe module pages so navigation + Sign out are reachable on phones, where
 * the desktop sidebar / icon rail are hidden. The Account tab opens a small
 * sheet because Sign out is an action, not a route.
 */
export function MobileTabBar() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session, logout } = useSession();
  const match = useMatch('/:tenantSlug/:module/*');
  const activeModule = match?.params?.module ?? null;
  const [accountOpen, setAccountOpen] = useState(false);

  const closeAccount = useCallback(() => setAccountOpen(false), []);

  useEffect(() => {
    if (!accountOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAccount();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [accountOpen, closeAccount]);

  if (!session || !tenantSlug) return null;

  const isAdmin = (session.user.role as string) === 'manager' || session.user.is_platform_admin;
  const userInitials = initials(session.user.name, session.user.email);
  const userName = session.user.name ?? session.user.email.split('@')[0].replace('.', ' ');
  const accountActive = activeModule === 'admin';

  // Iframe-module case: yield the bottom bar to the embedded app. On mobile we
  // render a slim top bar (Apps ← + app name + Account) instead of the bottom
  // tabs, so the embedded app's own bottom nav is reachable. Desktop is
  // unaffected — both bars are display:none above 767px.
  const iframeAppName = activeModule ? IFRAME_MODULES[activeModule] : undefined;
  if (iframeAppName) {
    return (
      <>
        {accountOpen && (
          <div className="eq-mtabs__backdrop" onClick={closeAccount} aria-hidden="true" />
        )}

        {accountOpen && (
          <div className="eq-mtabs__sheet eq-mtabs__sheet--top" role="menu" aria-label="Account">
            <div className="eq-mtabs__sheet-id">
              <span className="eq-mtabs__sheet-avatar" aria-hidden="true">{userInitials}</span>
              <div className="eq-mtabs__sheet-info">
                <span className="eq-mtabs__sheet-name">{userName}</span>
                <span className="eq-mtabs__sheet-email">{session.user.email}</span>
              </div>
            </div>

            {isAdmin && (
              <NavLink
                to={`/${tenantSlug}/admin/settings`}
                className="eq-mtabs__sheet-action"
                role="menuitem"
                onClick={closeAccount}
              >
                <Settings size={18} strokeWidth={2} aria-hidden="true" />
                <span>Settings</span>
              </NavLink>
            )}

            <button
              className="eq-mtabs__sheet-action eq-mtabs__sheet-action--signout"
              role="menuitem"
              onClick={() => { closeAccount(); void logout(); }}
            >
              <LogOut size={18} strokeWidth={2} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        )}

        <header className="eq-mtopbar" role="navigation" aria-label="App navigation">
          <Link
            to={`/${tenantSlug}`}
            className="eq-mtopbar__apps"
            onClick={closeAccount}
            aria-label="Back to all apps"
          >
            <Grid3x3 size={18} strokeWidth={2} aria-hidden="true" />
            <span>Apps</span>
          </Link>

          <span className="eq-mtopbar__title">{iframeAppName}</span>

          <button
            type="button"
            className={`eq-mtopbar__account${accountOpen ? ' eq-mtopbar__account--active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            aria-label="Account"
            onClick={() => setAccountOpen((o) => !o)}
          >
            <CircleUser size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>
      </>
    );
  }

  return (
    <>
      {accountOpen && (
        <div className="eq-mtabs__backdrop" onClick={closeAccount} aria-hidden="true" />
      )}

      {accountOpen && (
        <div className="eq-mtabs__sheet" role="menu" aria-label="Account">
          <div className="eq-mtabs__sheet-id">
            <span className="eq-mtabs__sheet-avatar" aria-hidden="true">{userInitials}</span>
            <div className="eq-mtabs__sheet-info">
              <span className="eq-mtabs__sheet-name">{userName}</span>
              <span className="eq-mtabs__sheet-email">{session.user.email}</span>
            </div>
          </div>

          {isAdmin && (
            <NavLink
              to={`/${tenantSlug}/admin/settings`}
              className="eq-mtabs__sheet-action"
              role="menuitem"
              onClick={closeAccount}
            >
              <Settings size={18} strokeWidth={2} aria-hidden="true" />
              <span>Settings</span>
            </NavLink>
          )}

          <button
            className="eq-mtabs__sheet-action eq-mtabs__sheet-action--signout"
            role="menuitem"
            onClick={() => { closeAccount(); void logout(); }}
          >
            <LogOut size={18} strokeWidth={2} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </div>
      )}

      <nav className="eq-mtabs" aria-label="App navigation" role="navigation">
        {NAV_TABS.map((item) => {
          const href = item.to ? `/${tenantSlug}/${item.to}` : `/${tenantSlug}`;
          const isActive = item.key === 'home'
            ? activeModule === null
            : activeModule === item.key;

          return (
            <NavLink
              key={item.key}
              to={href}
              className={`eq-mtabs__item${isActive ? ' eq-mtabs__item--active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={closeAccount}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          );
        })}

        <button
          type="button"
          className={`eq-mtabs__item${accountActive || accountOpen ? ' eq-mtabs__item--active' : ''}`}
          aria-haspopup="menu"
          aria-expanded={accountOpen}
          onClick={() => setAccountOpen((o) => !o)}
        >
          <CircleUser size={20} strokeWidth={2} aria-hidden="true" />
          <span>Account</span>
        </button>
      </nav>
    </>
  );
}
