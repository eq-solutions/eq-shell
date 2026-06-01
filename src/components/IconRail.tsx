import { NavLink, useMatch, useParams } from 'react-router-dom';
import { Users, Wrench, FileText, CreditCard, Settings, House } from 'lucide-react';
import { useSession, type EqTier } from '../session';
import { EqLogo } from './EqLogo';
import './IconRail.css';

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(' ');
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

const TRIAL_TIERS: EqTier[] = ['trial'];

interface RailItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  to: string;
  hideForTier?: EqTier[];
}

const RAIL_ITEMS: RailItem[] = [
  { key: 'field',   label: 'EQ Field',   icon: <Users size={20} strokeWidth={2} aria-hidden="true" />,      to: 'field'   },
  { key: 'service', label: 'EQ Service', icon: <Wrench size={20} strokeWidth={2} aria-hidden="true" />,     to: 'service' },
  { key: 'quotes',  label: 'EQ Quotes',  icon: <FileText size={20} strokeWidth={2} aria-hidden="true" />,   to: 'quotes',  hideForTier: TRIAL_TIERS },
  { key: 'cards',   label: 'EQ Cards',   icon: <CreditCard size={20} strokeWidth={2} aria-hidden="true" />, to: 'cards'   },
];

const MOBILE_ITEMS = [
  { key: 'home',    label: 'Home',    icon: <House size={20} strokeWidth={2} aria-hidden="true" />,        to: '' },
  { key: 'field',   label: 'Field',   icon: <Users size={20} strokeWidth={2} aria-hidden="true" />,       to: 'field'   },
  { key: 'service', label: 'Service', icon: <Wrench size={20} strokeWidth={2} aria-hidden="true" />,      to: 'service' },
  { key: 'quotes',  label: 'Quotes',  icon: <FileText size={20} strokeWidth={2} aria-hidden="true" />,    to: 'quotes'  },
  { key: 'cards',   label: 'Cards',   icon: <CreditCard size={20} strokeWidth={2} aria-hidden="true" />,  to: 'cards'   },
];

export function IconRail() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session, logout } = useSession();
  const match = useMatch('/:tenantSlug/:module/*');
  const activeModule = match?.params?.module ?? null;

  if (!session || !tenantSlug) return null;

  const tier: EqTier = session.tenant.tier;
  const isAdmin = (session.user.role as string) === 'manager' || session.user.is_platform_admin;
  const userInitials = initials(session.user.name, session.user.email);
  const userName = session.user.name ?? session.user.email.split('@')[0].replace('.', ' ');

  return (
    <>
      {/* Desktop icon rail */}
      <nav className="eq-icon-rail" aria-label="App navigation" role="navigation">
        {/* Logo → home */}
        <NavLink
          to={`/${tenantSlug}`}
          className="eq-icon-rail__logo"
          title="EQ Shell home"
          aria-label="Go to dashboard"
        >
          <EqLogo size={28} onDark variant="mark" />
          <span className="eq-icon-rail__label" aria-hidden="true">EQ Solutions</span>
          <span className="eq-icon-rail__sr-only">EQ Solutions home</span>
        </NavLink>

        <div className="eq-icon-rail__sep" role="separator" />

        {/* Module items */}
        <div className="eq-icon-rail__nav">
          {RAIL_ITEMS.map((item) => {
            const isTrialHidden = item.hideForTier?.includes(tier);
            const isActive = activeModule === item.key;
            const href = `/${tenantSlug}/${item.to}`;

            if (isTrialHidden) {
              return (
                <span
                  key={item.key}
                  className="eq-icon-rail__item eq-icon-rail__item--disabled"
                  title="Upgrade to access Quotes"
                  aria-label={`${item.label} — upgrade to access`}
                  role="link"
                  aria-disabled="true"
                >
                  <span className="eq-icon-rail__icon">{item.icon}</span>
                  <span className="eq-icon-rail__label" aria-hidden="true">{item.label}</span>
                  <span className="eq-icon-rail__sr-only">{item.label} (upgrade to access)</span>
                </span>
              );
            }

            return (
              <NavLink
                key={item.key}
                to={href}
                className={`eq-icon-rail__item${isActive ? ' eq-icon-rail__item--active' : ''}`}
                title={item.label}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="eq-icon-rail__icon">{item.icon}</span>
                <span className="eq-icon-rail__label" aria-hidden="true">{item.label}</span>
                <span className="eq-icon-rail__sr-only">{item.label}</span>
              </NavLink>
            );
          })}
        </div>

        {/* Bottom: settings + user */}
        <div className="eq-icon-rail__bottom">
          {isAdmin && (
            <NavLink
              to={`/${tenantSlug}/admin/settings`}
              className={({ isActive }) =>
                `eq-icon-rail__item${isActive ? ' eq-icon-rail__item--active' : ''}`
              }
              title="Settings"
              aria-current={activeModule === 'admin' ? 'page' : undefined}
            >
              <span className="eq-icon-rail__icon">
                <Settings size={20} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="eq-icon-rail__label" aria-hidden="true">Settings</span>
              <span className="eq-icon-rail__sr-only">Settings</span>
            </NavLink>
          )}

          <button
            className="eq-icon-rail__user"
            onClick={() => void logout()}
            title="Sign out"
            aria-label={`Sign out (${userName})`}
          >
            <span className="eq-icon-rail__avatar" aria-hidden="true">{userInitials}</span>
            <span className="eq-icon-rail__user-info" aria-hidden="true">
              <span className="eq-icon-rail__user-name">{userName}</span>
              <span className="eq-icon-rail__user-action">Sign out</span>
            </span>
          </button>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="eq-icon-rail-tabs" aria-label="App navigation" role="navigation">
        {MOBILE_ITEMS.map((item) => {
          const href = item.to ? `/${tenantSlug}/${item.to}` : `/${tenantSlug}`;
          const isActive = item.key === 'home'
            ? activeModule === null
            : activeModule === item.key;

          return (
            <NavLink
              key={item.key}
              to={href}
              className={`eq-icon-rail-tabs__item${isActive ? ' eq-icon-rail-tabs__item--active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </>
  );
}
