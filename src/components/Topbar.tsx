// Shared Topbar — used across all authenticated tenant pages.

import { Link, NavLink, useParams } from 'react-router-dom';
import { useSession, moduleEnabled } from '../session';
import { useCan } from '../permissions';
import { useBrand } from '../brand';
import { EqLogo } from './EqLogo';

export function Topbar() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session, logout } = useSession();
  const brand = useBrand();
  const canAdmin = useCan('admin.list_users');
  const canAudit = useCan('audit.view');
  const canReviewCards = useCan('admin.review_cards');

  if (!session) return null;

  const navItems: { to: string; label: string; module?: string; admin?: boolean; audit?: boolean; cards?: boolean }[] = [
    { to: `/${tenantSlug}`, label: 'Home' },
    { to: `/${tenantSlug}/intake`, label: 'Intake', module: 'intake' },
    { to: `/${tenantSlug}/cards`, label: 'Cards', module: 'cards' },
    { to: `/${tenantSlug}/field`, label: 'Field', module: 'field' },
    { to: `/${tenantSlug}/quotes`, label: 'Quotes', module: 'quotes' },
    { to: `/${tenantSlug}/service`, label: 'Service', module: 'service' },
    { to: `/${tenantSlug}/admin/audit`, label: 'Audit', audit: true },
    { to: `/${tenantSlug}/admin/users`, label: 'Users', admin: true },
    { to: `/${tenantSlug}/admin/cards-feed`, label: 'New staff', cards: true },
    { to: `/${tenantSlug}/admin/settings`, label: 'Settings', admin: true },
  ];

  const visible = navItems.filter((i) => {
    if (i.module && !moduleEnabled(session, i.module)) return false;
    if (i.admin && !canAdmin) return false;
    if (i.audit && !canAudit) return false;
    if (i.cards && !canReviewCards) return false;
    return true;
  });

  return (
    <header className="eq-topbar">
      <div className="eq-topbar__left">
        <Link to={`/${tenantSlug}`} className="eq-topbar__brand">
          <EqLogo size={24} className="eq-topbar__brand-mark" />
          <span>{brand.name}</span>
        </Link>
        <nav className="eq-topbar__nav">
          {visible.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === `/${tenantSlug}`}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="eq-topbar__right">
        <div className="eq-topbar__user">
          <span>{session.user.name ?? session.user.email.split('@')[0]}</span>
          <span className="eq-topbar__role">{session.user.role.replace('_', ' ')}</span>
          {session.user.is_platform_admin && (
            <span className="eq-topbar__admin-chip" title="Platform admin (EQ Solutions)">
              EQ Admin
            </span>
          )}
        </div>
        <button className="eq-btn-ghost" onClick={logout}>
          Sign out
        </button>
      </div>
    </header>
  );
}
