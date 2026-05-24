// Shared Topbar — used across all authenticated tenant pages.

import { useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { useSession, moduleEnabled } from '../session';
import { useCan } from '../permissions';
import { useBrand } from '../brand';
import { EqLogo } from './EqLogo';

export function Topbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
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
    { to: `/${tenantSlug}/jobs`, label: 'Jobs', admin: true },
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

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <>
      <header className="eq-topbar">
        <div className="eq-topbar__left">
          <Link to={`/${tenantSlug}`} className="eq-topbar__brand" onClick={closeMenu}>
            <EqLogo size={24} className="eq-topbar__brand-mark" />
            <span>{brand.name}</span>
          </Link>
          <nav className="eq-topbar__nav" aria-label="Main navigation">
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
          <button className="eq-btn-ghost eq-topbar__signout" onClick={logout}>
            Sign out
          </button>
          <button
            className="eq-topbar__menu-toggle"
            aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((v) => !v)}
          >
            {isMenuOpen ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 5H17M3 10H17M3 15H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {isMenuOpen && (
        <>
          <div className="eq-topbar__backdrop" onClick={closeMenu} aria-hidden="true" />
          <div className="eq-topbar__drawer" role="dialog" aria-label="Navigation menu">
            <nav className="eq-topbar__drawer-nav">
              {visible.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === `/${tenantSlug}`}
                  className={({ isActive }) =>
                    `eq-topbar__drawer-link${isActive ? ' active' : ''}`
                  }
                  onClick={closeMenu}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="eq-topbar__drawer-footer">
              <div>
                <p className="eq-topbar__drawer-user-name">
                  {session.user.name ?? session.user.email.split('@')[0]}
                </p>
                <div className="eq-topbar__drawer-user-meta">
                  <span className="eq-topbar__role">{session.user.role.replace('_', ' ')}</span>
                  {session.user.is_platform_admin && (
                    <span className="eq-topbar__admin-chip">EQ Admin</span>
                  )}
                </div>
              </div>
              <button
                className="eq-btn-ghost"
                style={{ width: '100%' }}
                onClick={() => { closeMenu(); void logout(); }}
              >
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
