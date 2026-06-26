import { useState, useEffect, useCallback } from 'react';
import { Link, NavLink, useMatch, useParams } from 'react-router-dom';
import {
  Users, Wrench, FileText, House, CircleUser, Settings, LogOut,
  Grid3x3, ShieldCheck, BarChart2, Download, ClipboardList, UserPlus,
  ChevronRight,
} from 'lucide-react';
import { useSession, moduleEnabled } from '../session';
import './MobileTabBar.css';

// Iframe modules embed a full app that owns its own bottom controls. On mobile,
// Shell's fixed bottom tab bar would sit on top of those controls and trap the
// user. For non-adapted modules Shell "yields the bottom bar": it hides the
// bottom tabs and surfaces an Apps / app-name control in a slim top bar instead.
// Note: /quotes and /ops are native React pages, not iframes, so they are NOT
// listed here. Cards is standalone (workers go direct to cards.eq.solutions) —
// the /cards iframe route and auth handoff remain but Cards is not a nav tab.
const IFRAME_MODULES: Record<string, string> = {
  field: 'EQ Field',
  service: 'EQ Service',
};

// Unified mobile chrome — Tier 1+. Iframe modules listed here have stood down
// their OWN bottom nav, so Shell keeps its persistent bottom tab bar on top of
// them instead of yielding it. Modules NOT in this set still get the old
// top-bar-only "yield the bottom" treatment until they adapt.
const ADAPTED_MODULES = new Set<string>(['field', 'service']);

// Tab definitions — each entry's key is matched against moduleEnabled() so
// entitlement-disabled apps are filtered out automatically at render time.
const ALL_TABS = [
  { key: 'home',    label: 'Home',    Icon: House,    to: '' },
  { key: 'field',   label: 'Field',   Icon: Users,    to: 'field'   },
  { key: 'service', label: 'Service', Icon: Wrench,   to: 'service' },
  { key: 'ops',     label: 'Ops',     Icon: FileText, to: 'ops'     },
];

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(' ');
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

/**
 * Mobile-only chrome (<=767px).
 *
 * Non-iframe pages (home, records, admin): slim top bar (EQ logo + account
 * button) + entitlement-filtered 5-tab bottom bar.
 *
 * Iframe-module pages (Field / Service / Quotes / Cards): slim top bar with
 * "Apps ←" + app name + account button. No bottom tabs — the embedded app owns
 * its bottom chrome.
 *
 * Both top bars share the account sheet (Frame 4) and the admin/more sheet
 * (Frame 6, admins only).
 */
export function MobileTabBar() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session, logout } = useSession();
  const match = useMatch('/:tenantSlug/:module/*');
  const activeModule = match?.params?.module ?? null;
  const [accountOpen, setAccountOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  const closeAll = useCallback(() => { setAccountOpen(false); setAdminOpen(false); }, []);

  useEffect(() => {
    if (!accountOpen && !adminOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [accountOpen, adminOpen, closeAll]);

  if (!session || !tenantSlug) return null;

  const userRole = session.user.role as string;
  const isAdmin = userRole === 'manager' || session.user.is_platform_admin;
  const userInitials = initials(session.user.name, session.user.email);
  const userName = session.user.name ?? session.user.email.split('@')[0].replace('.', ' ');
  const iframeAppName = activeModule ? IFRAME_MODULES[activeModule] : undefined;

  // Bottom tabs: home always visible, others filtered by entitlement
  const visibleTabs = ALL_TABS.filter(
    (t) => t.key === 'home' || moduleEnabled(session, t.key),
  );

  // Service section strip — only rendered when Service is the adapted module.
  // Active section derived from Shell URL path (ServiceIframe keeps Shell URL
  // in sync via SERVICE_URL_CHANGED → navigate(), so no extra state needed).
  const serviceSubPath = activeModule === 'service' ? (match?.params?.['*'] ?? '') : '';
  const activeServiceSection =
    serviceSubPath === 'do' ? 'do' :
    serviceSubPath.startsWith('maintenance') ? 'maintenance' :
    serviceSubPath.startsWith('records') ? 'records' :
    'dashboard';
  const serviceSections = [
    { key: 'do',          label: 'Do',          to: `/${tenantSlug}/service/do` },
    { key: 'dashboard',   label: 'Dashboard',   to: `/${tenantSlug}/service/dashboard` },
    { key: 'maintenance', label: 'Maintenance', to: `/${tenantSlug}/service/maintenance` },
    ...(userRole !== 'employee' ? [{ key: 'records', label: 'Records', to: `/${tenantSlug}/service/records` }] : []),
  ];

  // Account sheet — white card, floats above tabs or below iframe top bar
  const AccountSheet = ({ aboveTabs }: { aboveTabs: boolean }) => (
    <>
      <div
        className={`eq-mob-scrim${aboveTabs ? ' eq-mob-scrim--above-tabs' : ' eq-mob-scrim--full'}`}
        onClick={closeAll}
        aria-hidden="true"
      />
      <div
        className={`eq-mob-sheet${aboveTabs ? ' eq-mob-sheet--above-tabs' : ' eq-mob-sheet--top'}`}
        role="menu"
        aria-label="Account"
      >
        <div className="eq-mob-sheet__handle" />
        <div className="eq-mob-sheet__acct">
          <span className="eq-mob-sheet__avatar">{userInitials}</span>
          <div className="eq-mob-sheet__acct-info">
            <div className="eq-mob-sheet__name">{userName}</div>
            <div className="eq-mob-sheet__email">{session.user.email}</div>
          </div>
        </div>
        <div className="eq-mob-sheet__divider" />

        {isAdmin && (
          <NavLink
            to={`/${tenantSlug}/admin/settings`}
            className="eq-mob-sheet__row"
            role="menuitem"
            onClick={closeAll}
          >
            <span className="eq-mob-sheet__row-ic"><Settings size={18} strokeWidth={2} aria-hidden="true" /></span>
            <span className="eq-mob-sheet__row-label">Settings</span>
            <ChevronRight size={16} strokeWidth={2} className="eq-mob-sheet__row-chev" aria-hidden="true" />
          </NavLink>
        )}

        <NavLink
          to={`/${tenantSlug}/settings/2fa`}
          className="eq-mob-sheet__row"
          role="menuitem"
          onClick={closeAll}
        >
          <span className="eq-mob-sheet__row-ic"><ShieldCheck size={18} strokeWidth={2} aria-hidden="true" /></span>
          <span className="eq-mob-sheet__row-label">Two-factor security</span>
          <ChevronRight size={16} strokeWidth={2} className="eq-mob-sheet__row-chev" aria-hidden="true" />
        </NavLink>

        {isAdmin && (
          <button
            type="button"
            className="eq-mob-sheet__row"
            role="menuitem"
            onClick={() => { setAccountOpen(false); setAdminOpen(true); }}
          >
            <span className="eq-mob-sheet__row-ic eq-mob-sheet__row-ic--ice">
              <BarChart2 size={18} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="eq-mob-sheet__row-label">Reports & admin</span>
            <ChevronRight size={16} strokeWidth={2} className="eq-mob-sheet__row-chev" aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          className="eq-mob-sheet__row eq-mob-sheet__row--signout"
          role="menuitem"
          onClick={() => { closeAll(); void logout(); }}
        >
          <span className="eq-mob-sheet__row-ic eq-mob-sheet__row-ic--err">
            <LogOut size={18} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="eq-mob-sheet__row-label eq-mob-sheet__row-label--err">Sign out</span>
        </button>
      </div>
    </>
  );

  // More / Admin sheet (Frame 6) — visible to managers + platform admins
  const AdminSheet = ({ aboveTabs }: { aboveTabs: boolean }) => (
    <>
      <div
        className={`eq-mob-scrim${aboveTabs ? ' eq-mob-scrim--above-tabs' : ' eq-mob-scrim--full'}`}
        onClick={closeAll}
        aria-hidden="true"
      />
      <div
        className={`eq-mob-sheet${aboveTabs ? ' eq-mob-sheet--above-tabs' : ' eq-mob-sheet--top'}`}
        role="menu"
        aria-label="More"
      >
        <div className="eq-mob-sheet__handle" />
        <div className="eq-mob-sheet__acct eq-mob-sheet__acct--compact">
          <span className="eq-mob-sheet__avatar eq-mob-sheet__avatar--sm">{userInitials}</span>
          <div className="eq-mob-sheet__acct-info">
            <div className="eq-mob-sheet__name">{userName}</div>
            <div className="eq-mob-sheet__email">{session.user.email}</div>
          </div>
        </div>
        <div className="eq-mob-sheet__divider" />

        <NavLink
          to={`/${tenantSlug}/reports`}
          className="eq-mob-sheet__row"
          role="menuitem"
          onClick={closeAll}
        >
          <span className="eq-mob-sheet__row-ic eq-mob-sheet__row-ic--ice">
            <BarChart2 size={18} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="eq-mob-sheet__row-label">GM Reports</span>
          <ChevronRight size={16} strokeWidth={2} className="eq-mob-sheet__row-chev" aria-hidden="true" />
        </NavLink>

        <NavLink
          to={`/${tenantSlug}/intake`}
          className="eq-mob-sheet__row"
          role="menuitem"
          onClick={closeAll}
        >
          <span className="eq-mob-sheet__row-ic eq-mob-sheet__row-ic--ice">
            <Download size={18} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="eq-mob-sheet__row-label">Import</span>
          <ChevronRight size={16} strokeWidth={2} className="eq-mob-sheet__row-chev" aria-hidden="true" />
        </NavLink>

        <div className="eq-mob-sheet__sect-label">Admin</div>

        <NavLink
          to={`/${tenantSlug}/admin/users`}
          className="eq-mob-sheet__row"
          role="menuitem"
          onClick={closeAll}
        >
          <span className="eq-mob-sheet__row-ic">
            <Users size={18} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="eq-mob-sheet__row-label">Users</span>
          <ChevronRight size={16} strokeWidth={2} className="eq-mob-sheet__row-chev" aria-hidden="true" />
        </NavLink>

        <NavLink
          to={`/${tenantSlug}/admin/workers`}
          className="eq-mob-sheet__row"
          role="menuitem"
          onClick={closeAll}
        >
          <span className="eq-mob-sheet__row-ic">
            <UserPlus size={18} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="eq-mob-sheet__row-label">Worker invites</span>
          <ChevronRight size={16} strokeWidth={2} className="eq-mob-sheet__row-chev" aria-hidden="true" />
        </NavLink>

        <NavLink
          to={`/${tenantSlug}/admin/audit`}
          className="eq-mob-sheet__row"
          role="menuitem"
          onClick={closeAll}
        >
          <span className="eq-mob-sheet__row-ic">
            <ClipboardList size={18} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="eq-mob-sheet__row-label">Audit log</span>
          <ChevronRight size={16} strokeWidth={2} className="eq-mob-sheet__row-chev" aria-hidden="true" />
        </NavLink>

        <NavLink
          to={`/${tenantSlug}/admin/access-control`}
          className="eq-mob-sheet__row"
          role="menuitem"
          onClick={closeAll}
        >
          <span className="eq-mob-sheet__row-ic">
            <ShieldCheck size={18} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="eq-mob-sheet__row-label">Security groups</span>
          <ChevronRight size={16} strokeWidth={2} className="eq-mob-sheet__row-chev" aria-hidden="true" />
        </NavLink>
      </div>
    </>
  );

  // Persistent bottom tab bar — the global app switcher. Rendered on native
  // pages and on adapted iframe pages (Tier 1), so it never disappears.
  const bottomTabs = (
    <nav className="eq-mtabs" aria-label="App navigation" role="navigation">
      {visibleTabs.map((item) => {
        const href = item.to ? `/${tenantSlug}/${item.to}` : `/${tenantSlug}`;
        const isActive = item.key === 'home'
          ? activeModule === null
          : activeModule === item.key;
        const { Icon } = item;
        return (
          <NavLink
            key={item.key}
            to={href}
            className={`eq-mtabs__item${isActive ? ' eq-mtabs__item--active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={closeAll}
          >
            <Icon size={20} strokeWidth={2} aria-hidden="true" />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );

  // ── Iframe-module layout ────────────────────────────────────────────────────
  if (iframeAppName) {
    // Adapted modules keep Shell's persistent bottom bar; others still yield
    // the bottom of the screen to the embedded app's own controls.
    const adapted = activeModule ? ADAPTED_MODULES.has(activeModule) : false;
    return (
      <>
        {accountOpen && <AccountSheet aboveTabs={adapted} />}
        {adminOpen && <AdminSheet aboveTabs={adapted} />}

        <header className="eq-mtopbar" role="navigation" aria-label="App navigation">
          <Link
            to={`/${tenantSlug}`}
            className="eq-mtopbar__apps"
            onClick={closeAll}
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
            onClick={() => { setAdminOpen(false); setAccountOpen((o) => !o); }}
          >
            <CircleUser size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>
        {adapted && activeModule === 'service' && userRole !== 'apprentice' && (
          <nav className="eq-msect" aria-label="EQ Service sections">
            {serviceSections.map((sect) => (
              <NavLink
                key={sect.key}
                to={sect.to}
                className={`eq-msect__item${activeServiceSection === sect.key ? ' eq-msect__item--active' : ''}`}
                onClick={closeAll}
                aria-current={activeServiceSection === sect.key ? 'page' : undefined}
              >
                {sect.label}
              </NavLink>
            ))}
          </nav>
        )}
        {adapted && bottomTabs}
      </>
    );
  }

  // ── Home / non-iframe layout (Frames 1, 4, 6) ──────────────────────────────
  return (
    <>
      {accountOpen && <AccountSheet aboveTabs />}
      {adminOpen && <AdminSheet aboveTabs />}

      {/* Slim top bar: EQ wordmark + account button */}
      <header className="eq-mtopbar eq-mtopbar--home" role="banner" aria-label="EQ Shell">
        <span className="eq-mtopbar__logo" aria-label="EQ Solutions">EQ</span>
        <span className="eq-mtopbar__sp" aria-hidden="true" />
        <button
          type="button"
          className={`eq-mtopbar__account${accountOpen ? ' eq-mtopbar__account--active' : ''}`}
          aria-haspopup="menu"
          aria-expanded={accountOpen}
          aria-label="Account"
          onClick={() => { setAdminOpen(false); setAccountOpen((o) => !o); }}
        >
          <CircleUser size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      {bottomTabs}
    </>
  );
}
