import { useState, useCallback } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { Users, Wrench, FileText, CreditCard, Building2, MapPin, User, Settings, Download, Users2, ClipboardList, LogOut, Gauge, BarChart2, AlignJustify, ShieldCheck, Database, ListChecks, BadgeCheck, ChevronLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { useSession } from '../session';
import { useCan } from '../permissions';
import { useDensity } from '../lib/useDensity';
import { EqLogo } from './EqLogo';
import { TenantSwitcher } from './TenantSwitcher';

// Sidebar collapse state — persisted so the rail choice survives navigation.
const COLLAPSE_KEY = 'eq-shell-sidebar-collapsed';
function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

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
  /** Optional path suffix override (default: data/:entity). e.g. 'equipment'. */
  to?: string;
  /** Render the count in the muted (slate) variant instead of sky. */
  muted?: boolean;
  /** Show an amber warn dot beside the count (e.g. expiring licences). */
  warn?: boolean;
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
  const canEquipment = useCan('equipment.view');
  const canIntake = useCan('intake.view');
  const canReports = useCan('reports.view');
  const canAdmin = useCan('admin.list_users');
  const { compact, toggle: toggleDensity } = useDensity();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [adminExpanded, setAdminExpanded] = useState(false);
  const [customersOpen, setCustomersOpen] = useState(true);
  const [internalOpen, setInternalOpen] = useState(true);

  if (!session) return null;

  const userInitials = initials(session.user.name, session.user.email);
  const userName = session.user.name ?? session.user.email.split('@')[0].replace('.', ' ');
  const roleLabel = session.user.role.replace(/_/g, ' ').toUpperCase();

  // Plant & equipment is now a Record (folded out of its own group); only show it
  // to users who can view equipment.
  const visibleRecords = (records ?? []).filter((r) => r.key !== 'equipment' || canEquipment);

  const CUSTOMER_KEYS = ['customer', 'site', 'contact'];
  const INTERNAL_KEYS = ['staff', 'equipment'];
  const customerRecords = visibleRecords.filter((r) => CUSTOMER_KEYS.includes(r.key));
  const internalRecords = visibleRecords.filter((r) => INTERNAL_KEYS.includes(r.key));

  const RECORD_ICONS: Record<string, React.ReactNode> = {
    customer:  <Building2 size={16} aria-hidden="true" />,
    site:      <MapPin size={16} aria-hidden="true" />,
    contact:   <User size={16} aria-hidden="true" />,
    staff:     <Users2 size={16} aria-hidden="true" />,
    licence:   <BadgeCheck size={16} aria-hidden="true" />,
    equipment: <Gauge size={16} aria-hidden="true" />,
  };

  return (
    <aside className={`eq-hub__sidebar${collapsed ? ' eq-hub__sidebar--collapsed' : ''}`}>
      <div className="eq-hub-sidebar__brand-row">
        <Link to={`/${tenantSlug}`} className="eq-hub-sidebar__brand" aria-label="Go to home">
          <EqLogo size={52} onDark />
          <span className="eq-hub-sidebar__nav-label">Home</span>
        </Link>
        <button
          type="button"
          className="eq-hub-sidebar__collapse"
          onClick={toggleCollapsed}
          aria-pressed={collapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="eq-hub-sidebar__live">
        <span className="eq-hub-sidebar__live-dot" aria-hidden="true" />
        <span>Live</span>
      </div>

      {/* ── RECORDS — collapsible Customers + Internal accordion groups ── */}
      {visibleRecords.length > 0 && (
        <>
          <p className="eq-hub-sidebar__section-label">Records</p>

          {customerRecords.length > 0 && (
            <>
              <button
                type="button"
                className="eq-hub-sidebar__admin-toggle"
                onClick={() => setCustomersOpen((v) => !v)}
                aria-expanded={customersOpen}
              >
                <span className="eq-hub-sidebar__nav-icon" aria-hidden="true">
                  <Building2 size={16} aria-hidden="true" />
                </span>
                <span className="eq-hub-sidebar__nav-label">Customers</span>
                <span className="eq-hub-sidebar__admin-chevron" aria-hidden="true">
                  {customersOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </span>
              </button>
              {customersOpen && (
                <div className="eq-hub-sidebar__admin-group">
                  {customerRecords.map((r) => (
                    <NavLink
                      key={r.key}
                      to={`/${tenantSlug}/${r.to ?? `data/${r.entity}`}`}
                      data-tip={r.label}
                      className={({ isActive }) =>
                        `eq-hub-sidebar__nav-item eq-hub-sidebar__nav-item--sub${isActive ? ' active' : ''}`
                      }
                    >
                      <span className="eq-hub-sidebar__nav-icon" aria-hidden="true">
                        {RECORD_ICONS[r.key]}
                      </span>
                      <span className="eq-hub-sidebar__nav-label">{r.label}</span>
                      {r.count !== null && (
                        <span className={`eq-hub-sidebar__nav-count${r.muted ? ' eq-hub-sidebar__nav-count--muted' : ''}`}>
                          {r.count}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
            </>
          )}

          {internalRecords.length > 0 && (
            <>
              <button
                type="button"
                className="eq-hub-sidebar__admin-toggle"
                onClick={() => setInternalOpen((v) => !v)}
                aria-expanded={internalOpen}
              >
                <span className="eq-hub-sidebar__nav-icon" aria-hidden="true">
                  <Users2 size={16} aria-hidden="true" />
                </span>
                <span className="eq-hub-sidebar__nav-label">Internal</span>
                <span className="eq-hub-sidebar__admin-chevron" aria-hidden="true">
                  {internalOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </span>
              </button>
              {internalOpen && (
                <div className="eq-hub-sidebar__admin-group">
                  {internalRecords.map((r) => (
                    <NavLink
                      key={r.key}
                      to={`/${tenantSlug}/${r.to ?? `data/${r.entity}`}`}
                      data-tip={r.label}
                      className={({ isActive }) =>
                        `eq-hub-sidebar__nav-item eq-hub-sidebar__nav-item--sub${isActive ? ' active' : ''}`
                      }
                    >
                      <span className="eq-hub-sidebar__nav-icon" aria-hidden="true">
                        {RECORD_ICONS[r.key]}
                        {r.warn && <span className="eq-hub-sidebar__nav-warn eq-hub-sidebar__nav-warn--chip" aria-hidden="true" />}
                      </span>
                      <span className="eq-hub-sidebar__nav-label">{r.label}</span>
                      {r.warn && <span className="eq-hub-sidebar__nav-warn" aria-label="Needs attention" />}
                      {r.count !== null && (
                        <span className={`eq-hub-sidebar__nav-count${r.muted ? ' eq-hub-sidebar__nav-count--muted' : ''}`}>
                          {r.count}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── APPS ── */}
      <p className="eq-hub-sidebar__section-label" style={{ marginTop: 16 }}>
        Apps
      </p>
      <nav className="eq-hub-sidebar__nav" aria-label="App navigation">
        {apps.map((app) => (
          <NavLink
            key={app.key}
            to={`/${tenantSlug}/${app.to}`}
            data-tip={app.label}
            className={({ isActive }) =>
              `eq-hub-sidebar__nav-item${isActive ? ' active' : ''}`
            }
          >
            <span className="eq-hub-sidebar__nav-icon" aria-hidden="true">
              {app.icon}
              {app.hasAlert && <span className="eq-hub-sidebar__nav-warn eq-hub-sidebar__nav-warn--chip" aria-hidden="true" />}
            </span>
            <span className="eq-hub-sidebar__nav-label">{app.label}</span>
            {app.isBeta && (
              <span className="eq-hub-sidebar__nav-badge">BETA</span>
            )}
            {app.hasAlert && (
              <span className="eq-hub-sidebar__nav-warn" aria-label="Needs attention" />
            )}
            {app.count !== null && (
              <span className="eq-hub-sidebar__nav-count">{app.count}</span>
            )}
            <span className="eq-hub-sidebar__nav-arrow" aria-hidden="true">→</span>
          </NavLink>
        ))}
      </nav>

      {/* ── REPORTS ── */}
      {canReports && (
        <>
          <p className="eq-hub-sidebar__section-label" style={{ marginTop: 16 }}>Reports</p>
          <nav className="eq-hub-sidebar__nav" aria-label="Reports navigation">
            <NavLink
              to={`/${tenantSlug}/reports`}
              data-tip="Reports"
              className={({ isActive }) => `eq-hub-sidebar__nav-item${isActive ? ' active' : ''}`}
            >
              <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><BarChart2 size={16} aria-hidden="true" /></span>
              <span className="eq-hub-sidebar__nav-label">Reports</span>
              <span className="eq-hub-sidebar__nav-arrow" aria-hidden="true">→</span>
            </NavLink>
          </nav>
        </>
      )}

      {/* ── ADMIN — collapsible tools + always-visible Settings + Import ── */}
      {(canAdmin || canIntake) && (
        <>
          <p className="eq-hub-sidebar__section-label" style={{ marginTop: 16 }}>Admin</p>
          <nav className="eq-hub-sidebar__nav" aria-label="Admin navigation">
            {canAdmin && (
              <>
                <button
                  type="button"
                  className="eq-hub-sidebar__admin-toggle"
                  onClick={() => setAdminExpanded((v) => !v)}
                  aria-expanded={adminExpanded}
                >
                  <span className="eq-hub-sidebar__nav-icon" aria-hidden="true">
                    <Users2 size={16} aria-hidden="true" />
                  </span>
                  <span className="eq-hub-sidebar__nav-label">Administration</span>
                  <span className="eq-hub-sidebar__admin-chevron" aria-hidden="true">
                    {adminExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </span>
                </button>
                {adminExpanded && (
                  <div className="eq-hub-sidebar__admin-group">
                    <NavLink
                      to={`/${tenantSlug}/admin/users`}
                      data-tip="Users"
                      className={({ isActive }) => `eq-hub-sidebar__nav-item eq-hub-sidebar__nav-item--sub${isActive ? ' active' : ''}`}
                    >
                      <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><Users2 size={14} aria-hidden="true" /></span>
                      <span className="eq-hub-sidebar__nav-label">Users</span>
                    </NavLink>
                    <NavLink
                      to={`/${tenantSlug}/admin/audit`}
                      data-tip="Audit log"
                      className={({ isActive }) => `eq-hub-sidebar__nav-item eq-hub-sidebar__nav-item--sub${isActive ? ' active' : ''}`}
                    >
                      <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><ClipboardList size={14} aria-hidden="true" /></span>
                      <span className="eq-hub-sidebar__nav-label">Audit log</span>
                    </NavLink>
                    <NavLink
                      to={`/${tenantSlug}/admin/migration`}
                      data-tip="Migration"
                      className={({ isActive }) => `eq-hub-sidebar__nav-item eq-hub-sidebar__nav-item--sub${isActive ? ' active' : ''}`}
                    >
                      <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><ListChecks size={14} aria-hidden="true" /></span>
                      <span className="eq-hub-sidebar__nav-label">Migration</span>
                    </NavLink>
                    <NavLink
                      to={`/${tenantSlug}/admin/access-control`}
                      data-tip="Security groups"
                      className={({ isActive }) => `eq-hub-sidebar__nav-item eq-hub-sidebar__nav-item--sub${isActive ? ' active' : ''}`}
                    >
                      <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><ShieldCheck size={14} aria-hidden="true" /></span>
                      <span className="eq-hub-sidebar__nav-label">Security groups</span>
                    </NavLink>
                    <NavLink
                      to={`/${tenantSlug}/settings/2fa`}
                      data-tip="Two-factor security"
                      className={({ isActive }) => `eq-hub-sidebar__nav-item eq-hub-sidebar__nav-item--sub${isActive ? ' active' : ''}`}
                    >
                      <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><ShieldCheck size={14} aria-hidden="true" /></span>
                      <span className="eq-hub-sidebar__nav-label">Two-factor security</span>
                    </NavLink>
                  </div>
                )}
                <NavLink
                  to={`/${tenantSlug}/admin/settings`}
                  data-tip="Settings"
                  className={({ isActive }) => `eq-hub-sidebar__nav-item${isActive ? ' active' : ''}`}
                >
                  <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><Settings size={16} aria-hidden="true" /></span>
                  <span className="eq-hub-sidebar__nav-label">Settings</span>
                </NavLink>
              </>
            )}
            {canIntake && (
              <NavLink
                to={`/${tenantSlug}/intake`}
                data-tip="Import"
                className={({ isActive }) => `eq-hub-sidebar__nav-item${isActive ? ' active' : ''}`}
              >
                <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><Download size={16} aria-hidden="true" /></span>
                <span className="eq-hub-sidebar__nav-label">Import</span>
                <span className="eq-hub-sidebar__nav-arrow" aria-hidden="true">→</span>
              </NavLink>
            )}
          </nav>
        </>
      )}

      {/* ── PLATFORM (platform-admin only) ── */}
      {session.user.is_platform_admin && (
        <>
          <p className="eq-hub-sidebar__section-label" style={{ marginTop: 16 }}>Platform</p>
          <nav className="eq-hub-sidebar__nav" aria-label="Platform navigation">
            <NavLink
              to="/_platform/tenants"
              data-tip="Tenants"
              className={({ isActive }) => `eq-hub-sidebar__nav-item${isActive ? ' active' : ''}`}
            >
              <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><Database size={16} aria-hidden="true" /></span>
              <span className="eq-hub-sidebar__nav-label">Tenants</span>
            </NavLink>
          </nav>
        </>
      )}

      <div className="eq-hub-sidebar__bottom">
      {session.memberships && session.memberships.length > 1 && (
        <TenantSwitcher />
      )}
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
          className={`eq-hub-sidebar__density-toggle${compact ? ' active' : ''}`}
          onClick={toggleDensity}
          aria-label="Compact view"
          aria-pressed={compact}
          title={compact ? 'Switch to normal view' : 'Switch to compact view'}
        >
          <AlignJustify size={16} aria-hidden="true" />
        </button>
        <button
          className="eq-hub-sidebar__user-logout"
          onClick={() => void logout()}
          aria-label="Log out"
          title="Log out"
        >
          <LogOut size={15} aria-hidden="true" />
        </button>
      </div>
      </div>
    </aside>
  );
}
