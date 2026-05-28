import { Link, NavLink, useParams } from 'react-router-dom';
import { Users, Wrench, FileText, CreditCard, Building2, MapPin, User, Settings, Download, Users2, ClipboardList, LogOut } from 'lucide-react';
import { useSession } from '../session';
import { EqLogo } from './EqLogo';
import { TenantSwitcher } from './TenantSwitcher';

export interface HubApp {
  key: string;
  label: string;
  to: string;
  count: number | null;
  hasAlert: boolean;
  isBeta: boolean;
  icon: React.ReactNode;
}

export interface RecordLink {
  key: string;
  label: string;
  entity: string;   // matches /data/:entity route
  count: number | null;
}

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(' ');
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export const HUB_APP_ICONS: Record<string, React.ReactNode> = {
  field:   <Users size={16} aria-hidden="true" />,
  service: <Wrench size={16} aria-hidden="true" />,
  quotes:  <FileText size={16} aria-hidden="true" />,
  cards:   <CreditCard size={16} aria-hidden="true" />,
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  apps: HubApp[];
  records?: RecordLink[];
}

export function HubSidebar({ apps, records }: Props) {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session, logout } = useSession();

  if (!session) return null;

  const userInitials = initials(session.user.name, session.user.email);
  const userName = session.user.name ?? session.user.email.split('@')[0].replace('.', ' ');
  const roleLabel = session.user.role.replace(/_/g, ' ').toUpperCase();
  const isManager = session.user.role === 'manager' || session.user.is_platform_admin;

  return (
    <aside className="eq-hub__sidebar">
      <Link to={`/${tenantSlug}`} className="eq-hub-sidebar__brand">
        <EqLogo size={22} />
        <span className="eq-hub-sidebar__brand-sep">·</span>
        <span className="eq-hub-sidebar__brand-label">SHELL</span>
      </Link>

      <div className="eq-hub-sidebar__live">
        <span className="eq-hub-sidebar__live-dot" aria-hidden="true" />
        LIVE
      </div>

      {session.memberships && session.memberships.length > 1 && (
        <div style={{ margin: '8px 0 12px' }}>
          <TenantSwitcher />
        </div>
      )}

      {/* ── RECORDS ── */}
      {records && records.length > 0 && (
        <>
          <p className="eq-hub-sidebar__section-label">RECORDS</p>
          <nav className="eq-hub-sidebar__nav" aria-label="Records navigation">
            {records.map((r) => (
              <NavLink
                key={r.key}
                to={`/${tenantSlug}/data/${r.entity}`}
                className={({ isActive }) =>
                  `eq-hub-sidebar__nav-item${isActive ? ' active' : ''}`
                }
              >
                <span className="eq-hub-sidebar__nav-icon" aria-hidden="true">
                  {r.key === 'customer' && <Building2 size={16} aria-hidden="true" />}
                  {r.key === 'site'     && <MapPin size={16} aria-hidden="true" />}
                  {r.key === 'contact'  && <User size={16} aria-hidden="true" />}
                </span>
                <span className="eq-hub-sidebar__nav-label">{r.label}</span>
                {r.count !== null && (
                  <span className="eq-hub-sidebar__nav-count">{r.count}</span>
                )}
                <span className="eq-hub-sidebar__nav-arrow" aria-hidden="true">→</span>
              </NavLink>
            ))}
          </nav>
        </>
      )}

      {/* ── APPS ── */}
      <p className="eq-hub-sidebar__section-label" style={{ marginTop: records?.length ? 16 : 0 }}>
        APPS
      </p>
      <nav className="eq-hub-sidebar__nav" aria-label="App navigation">
        {apps.map((app) => (
          <NavLink
            key={app.key}
            to={`/${tenantSlug}/${app.to}`}
            className={({ isActive }) =>
              `eq-hub-sidebar__nav-item${isActive ? ' active' : ''}`
            }
          >
            <span className="eq-hub-sidebar__nav-icon" aria-hidden="true">
              {app.icon}
            </span>
            <span className="eq-hub-sidebar__nav-label">{app.label}</span>
            {app.isBeta && (
              <span className="eq-hub-sidebar__nav-badge">BETA</span>
            )}
            {app.hasAlert && !app.isBeta && (
              <span className="eq-hub-sidebar__nav-alert" aria-label="Needs attention" />
            )}
            {app.count !== null && (
              <span className="eq-hub-sidebar__nav-count">{app.count}</span>
            )}
            <span className="eq-hub-sidebar__nav-arrow" aria-hidden="true">→</span>
          </NavLink>
        ))}
      </nav>

      {/* ── INTAKE ── */}
      {isManager && (
        <>
          <p className="eq-hub-sidebar__section-label" style={{ marginTop: 16 }}>INTAKE</p>
          <nav className="eq-hub-sidebar__nav" aria-label="Intake navigation">
            <NavLink
              to={`/${tenantSlug}/intake`}
              className={({ isActive }) => `eq-hub-sidebar__nav-item${isActive ? ' active' : ''}`}
            >
              <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><Download size={16} aria-hidden="true" /></span>
              <span className="eq-hub-sidebar__nav-label">Import</span>
              <span className="eq-hub-sidebar__nav-arrow" aria-hidden="true">→</span>
            </NavLink>
          </nav>
        </>
      )}

      {/* ── ADMIN ── */}
      {isManager && (
        <>
          <p className="eq-hub-sidebar__section-label" style={{ marginTop: 16 }}>ADMIN</p>
          <nav className="eq-hub-sidebar__nav" aria-label="Admin navigation">
            <NavLink
              to={`/${tenantSlug}/admin/users`}
              className={({ isActive }) => `eq-hub-sidebar__nav-item${isActive ? ' active' : ''}`}
            >
              <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><Users2 size={16} aria-hidden="true" /></span>
              <span className="eq-hub-sidebar__nav-label">Users</span>
            </NavLink>
            <NavLink
              to={`/${tenantSlug}/admin/audit`}
              className={({ isActive }) => `eq-hub-sidebar__nav-item${isActive ? ' active' : ''}`}
            >
              <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><ClipboardList size={16} aria-hidden="true" /></span>
              <span className="eq-hub-sidebar__nav-label">Audit log</span>
            </NavLink>
            <NavLink
              to={`/${tenantSlug}/admin/settings`}
              className={({ isActive }) => `eq-hub-sidebar__nav-item${isActive ? ' active' : ''}`}
            >
              <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><Settings size={16} aria-hidden="true" /></span>
              <span className="eq-hub-sidebar__nav-label">Settings</span>
            </NavLink>
          </nav>
        </>
      )}

      {/* Phase 1.G: 2FA enrollment — accessible to all logged-in users */}
      <NavLink
        to={`/${tenantSlug}/settings/2fa`}
        className={({ isActive }) => `eq-hub-sidebar__nav-item${isActive ? ' active' : ''}`}
        style={{ marginTop: 8 }}
      >
        <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><Settings size={16} aria-hidden="true" /></span>
        <span className="eq-hub-sidebar__nav-label">Security</span>
      </NavLink>

      <div className="eq-hub-sidebar__user">
        <div className="eq-hub-sidebar__user-avatar" aria-hidden="true">
          {userInitials}
        </div>
        <div className="eq-hub-sidebar__user-info">
          <div className="eq-hub-sidebar__user-name">{userName}</div>
          <div className="eq-hub-sidebar__user-meta">
            {roleLabel} · {session.tenant.name}
          </div>
        </div>
        <button
          className="eq-hub-sidebar__user-logout"
          onClick={() => void logout()}
          aria-label="Log out"
          title="Log out"
        >
          <LogOut size={15} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
