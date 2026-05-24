import { NavLink, useParams } from 'react-router-dom';
import { useSession } from '../session';
import { EqLogo } from './EqLogo';

export interface HubApp {
  key: string;
  label: string;
  to: string;
  count: number | null;
  hasAlert: boolean;
  isBeta: boolean;
  icon: React.ReactNode;
}

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(' ');
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

const FieldIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 2a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM4 13c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const ServiceIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M13 8A5 5 0 103 8M8 8v2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="8" cy="12" r="1" fill="currentColor" />
  </svg>
);

const QuotesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6 6h4M6 9h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const CardsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="4" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2 7.5h12" stroke="currentColor" strokeWidth="1.5" />
    <path d="M5 10.5h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
    <path d="M5.5 3H3a1 1 0 00-1 1v7a1 1 0 001 1h2.5M9.5 10.5l3-3-3-3M12.5 7.5H5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const HUB_APP_ICONS: Record<string, React.ReactNode> = {
  field: <FieldIcon />,
  service: <ServiceIcon />,
  quotes: <QuotesIcon />,
  cards: <CardsIcon />,
};

interface Props {
  apps: HubApp[];
}

export function HubSidebar({ apps }: Props) {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session, logout } = useSession();

  if (!session) return null;

  const userInitials = initials(session.user.name, session.user.email);
  const userName = session.user.name ?? session.user.email.split('@')[0].replace('.', ' ');
  const roleLabel = session.user.role.replace(/_/g, ' ').toUpperCase();

  return (
    <aside className="eq-hub__sidebar">
      <div className="eq-hub-sidebar__brand">
        <EqLogo size={22} />
        <span className="eq-hub-sidebar__brand-sep">·</span>
        <span className="eq-hub-sidebar__brand-label">SHELL</span>
      </div>

      <div className="eq-hub-sidebar__live">
        <span className="eq-hub-sidebar__live-dot" aria-hidden="true" />
        LIVE
      </div>

      <p className="eq-hub-sidebar__section-label">LAUNCH</p>

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
          <LogoutIcon />
        </button>
      </div>
    </aside>
  );
}
