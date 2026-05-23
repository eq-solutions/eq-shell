// TenantHome — the dashboard.
// Dark-navy hero strip mirrors the login aesthetic so signed-in feels
// like the same platform, not a Stripe billing page. Below the hero:
// snapshot stats, recent intake activity, module grid.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession, moduleEnabled } from '../session';
import { createSupabaseClient } from '../lib/supabaseJwt';
import { Topbar } from '../components/Topbar';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';

interface DashboardCount {
  entity: string;
  count_total: number;
  count_recent: number;
}

interface IntakeEvent {
  intake_id: string;
  entity: string;
  source_app: string | null;
  source_filename: string | null;
  status: string;
  rows_committed: number;
  rows_flagged: number;
  rows_rejected: number;
  started_at: string;
}

interface ModuleDef {
  key: string;
  label: string;
  description: string;
  to: string;
  live: boolean;
}

const MODULES: ModuleDef[] = [
  { key: 'intake', label: 'Intake', description: 'Drag-drop CSVs into your data with AI column mapping.', to: 'intake', live: true },
  { key: 'cards', label: 'Cards', description: 'Tradie wallet — licences + tap-to-copy.', to: 'cards', live: true },
  { key: 'field', label: 'Field', description: 'Roster, timesheets, sites.', to: 'field', live: true },
  { key: 'quotes', label: 'Quotes', description: 'Job quoting from the EQ platform.', to: 'quotes', live: false },
  { key: 'service', label: 'Service', description: 'PPM, work orders, assets.', to: 'service', live: false },
];

const ENTITY_LABELS: Record<string, string> = {
  customer: 'Customers',
  contact: 'Contacts',
  site: 'Sites',
  staff: 'Active staff',
  schedule: 'Schedule (upcoming)',
  timesheet: 'Timesheets',
  leave_request: 'Pending leave',
  tender: 'Tenders',
  prestart: 'Prestart checks',
  toolbox_talk: 'Toolbox talks',
  licence: 'Licences',
};

// Hero number tiles get pulled from these entities in this order.
const HERO_KEYS = ['customer', 'staff', 'tender'];
// Secondary stats below the hero.
const FEATURED_KEYS = ['site', 'schedule', 'timesheet', 'leave_request', 'prestart', 'toolbox_talk'];

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Audit fix #4: DB stores 'completed' (past tense); we also accept the
// shorter 'complete' for older rows. Both render green.
function statusDot(status: string): 'ok' | 'warn' | 'err' | undefined {
  if (status === 'complete' || status === 'completed' || status === 'approved') return 'ok';
  if (status === 'committing' || status === 'pending' || status === 'submitted') return 'warn';
  if (status === 'failed' || status === 'rejected' || status === 'rolled_back') return 'err';
  return undefined;
}

export default function TenantHome() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session } = useSession();

  const [counts, setCounts] = useState<DashboardCount[] | null>(null);
  const [events, setEvents] = useState<IntakeEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    setErr(null);
    try {
      const sb = await createSupabaseClient();
      const [countsRes, eventsRes] = await Promise.all([
        sb.rpc('eq_tenant_dashboard_counts'),
        sb.rpc('eq_recent_intake_events', { p_limit: 5 }),
      ]);
      if (countsRes.error) throw new Error(countsRes.error.message);
      if (eventsRes.error) throw new Error(eventsRes.error.message);
      setCounts(countsRes.data as DashboardCount[]);
      setEvents(eventsRes.data as IntakeEvent[]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const liveModuleCount = useMemo(
    () => (session ? MODULES.filter((m) => m.live && moduleEnabled(session, m.key)).length : 0),
    [session],
  );

  const totalRowsThisWeek = useMemo(() => {
    if (!counts) return null;
    return counts.reduce((acc, c) => acc + (c.count_recent ?? 0), 0);
  }, [counts]);

  if (!session) return null;

  const enabledModules = MODULES.filter((m) => moduleEnabled(session, m.key));
  const heroCounts = HERO_KEYS.map((k) => counts?.find((c) => c.entity === k)).filter(
    (c): c is DashboardCount => c !== undefined,
  );
  const featuredCounts = FEATURED_KEYS.map((k) => counts?.find((c) => c.entity === k)).filter(
    (c): c is DashboardCount => c !== undefined,
  );

  const greetName = session.user.email.split('@')[0].split('.')[0];
  const greetNameCapitalised = greetName.charAt(0).toUpperCase() + greetName.slice(1);
  const roleLabel = session.user.role.replace('_', ' ');

  // Audit fix #5: the delta is "additions this week" regardless of
  // status. For leave-style entities the wording "added" is more honest
  // than "+N this week" which implied the counter and the delta were
  // filtered the same way (they're not).
  //
  // Audit fix #2 (follow-up 2026-05-21): when delta == total, the
  // entity was seeded this week — showing "+N this week" misleads
  // execs into thinking the platform added that many records as
  // organic activity. Return null so the caller skips the delta line
  // for the all-seeded case.
  function deltaLabel(entity: string, recent: number, total: number): string | null {
    if (recent <= 0) return null;
    if (recent >= total) return null; // all rows are "new this week" = seed data, don't mislead
    if (entity === 'leave_request') return `${recent} added this week`;
    return `+${recent} this week`;
  }

  return (
    <>
      <Topbar />
      <div className="eq-shell-page">
        <section className="eq-home-hero">
          <div className="eq-home-hero__inner">
            <div className="eq-home-hero__chip-row">
              <span className="eq-home-hero__chip">
                <span className="eq-home-hero__chip-dot" />
                {session.tenant.name.toUpperCase()} · {roleLabel.toUpperCase()}
                {session.user.is_platform_admin ? ' · PLATFORM ADMIN' : ''}
              </span>
            </div>

            <h1 className="eq-home-hero__headline">
              Operating <span className="eq-home-hero__accent">EQ Solutions</span>
              <span className="eq-home-hero__sub-name">
                {' '}— {greetNameCapitalised}
              </span>
            </h1>
            <p className="eq-home-hero__sub">
              {liveModuleCount} module{liveModuleCount === 1 ? '' : 's'} live ·{' '}
              {totalRowsThisWeek != null ? `${totalRowsThisWeek.toLocaleString()} rows added this week` : ''}
              {events && events.length > 0
                ? ` · ${events.length} recent intake${events.length === 1 ? '' : 's'}`
                : ''}
            </p>

            <div className="eq-home-hero__tiles">
              {loading && !counts
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div className="eq-home-hero__tile eq-home-hero__tile--skeleton" key={i}>
                      <Skeleton variant="text" width={80} />
                      <Skeleton variant="text" width={120} />
                    </div>
                  ))
                : heroCounts.map((c) => (
                    <Link
                      key={c.entity}
                      to={`/${tenantSlug}/data/${c.entity}`}
                      className="eq-home-hero__tile"
                    >
                      <p className="eq-home-hero__tile-label">
                        {ENTITY_LABELS[c.entity] ?? c.entity}
                      </p>
                      <p className="eq-home-hero__tile-value">{c.count_total.toLocaleString()}</p>
                      {(() => {
                        const label = deltaLabel(c.entity, c.count_recent, c.count_total);
                        return label ? (
                          <p className="eq-home-hero__tile-delta">{label}</p>
                        ) : null;
                      })()}
                    </Link>
                  ))}
            </div>
          </div>
        </section>

        <main className="eq-page">
          {err && <EqError title="Couldn't load dashboard" message={err} onRetry={loadData} />}

          <section className="eq-section">
            <div className="eq-section__head">
              <h2 className="eq-section__heading">Snapshot</h2>
              {counts && (
                <span className="eq-section__hint">
                  Tap a card to open the entity browser
                </span>
              )}
            </div>
            {loading && !counts ? (
              <div className="eq-stat-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} variant="card" />
                ))}
              </div>
            ) : (
              <div className="eq-stat-grid">
                {featuredCounts.map((c) => (
                  <Link
                    key={c.entity}
                    to={`/${tenantSlug}/data/${c.entity}`}
                    className="eq-stat-card"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <p className="eq-stat-card__label">
                      {ENTITY_LABELS[c.entity] ?? c.entity}
                    </p>
                    <p className="eq-stat-card__value">{c.count_total.toLocaleString()}</p>
                    {(() => {
                      const label = deltaLabel(c.entity, c.count_recent, c.count_total);
                      return label ? (
                        <p className="eq-stat-card__delta eq-stat-card__delta--up">{label}</p>
                      ) : null;
                    })()}
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="eq-section">
            <h2 className="eq-section__heading">Recent intake activity</h2>
            {loading && !events ? (
              <div className="eq-activity">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div className="eq-activity__row" key={i}>
                    <Skeleton variant="text" width={300} />
                  </div>
                ))}
              </div>
            ) : !events || events.length === 0 ? (
              <div className="eq-empty">
                <p className="eq-empty__title">No intake events yet</p>
                <p>
                  Drop a CSV at <Link to={`/${tenantSlug}/intake`}>Intake</Link> to see activity here.
                </p>
              </div>
            ) : (
              <div className="eq-activity">
                {events.map((e) => (
                  <div key={e.intake_id} className="eq-activity__row">
                    <span
                      className={`eq-activity__dot ${
                        statusDot(e.status) ? `eq-activity__dot--${statusDot(e.status)}` : ''
                      }`}
                    />
                    <div className="eq-activity__main">
                      <div className="eq-activity__title">
                        {e.source_filename ?? `${e.entity} intake`} · {e.rows_committed.toLocaleString()} committed
                        {e.rows_flagged > 0 && ` · ${e.rows_flagged} flagged`}
                        {e.rows_rejected > 0 && ` · ${e.rows_rejected} rejected`}
                      </div>
                      <div className="eq-activity__meta">
                        {e.entity} · via {e.source_app ?? 'unknown'} · {e.status}
                      </div>
                    </div>
                    <span className="eq-activity__time">{relativeTime(e.started_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="eq-section">
            <h2 className="eq-section__heading">Modules</h2>
            <div className="eq-modules">
              {enabledModules.map((m) => (
                <Link
                  key={m.key}
                  to={`/${tenantSlug}/${m.to}`}
                  className={`eq-module-card ${m.live ? '' : 'eq-module-card--soon'}`}
                >
                  <div className="eq-module-card__head">
                    <h3>{m.label}</h3>
                    <span className={`eq-module-card__chip ${m.live ? '' : 'eq-module-card__chip--soon'}`}>
                      {m.live ? 'Live' : 'Soon'}
                    </span>
                  </div>
                  <p>{m.description}</p>
                </Link>
              ))}
            </div>
          </section>

          <section className="eq-section">
            <h2 className="eq-section__heading">Quick actions</h2>
            <div className="eq-quick-actions">
              <Link to={`/${tenantSlug}/intake`} className="eq-quick-action">
                <span className="eq-quick-action__icon" aria-hidden="true">↑</span>
                <span className="eq-quick-action__label">Import data</span>
                <span className="eq-quick-action__hint">Drop a CSV</span>
              </Link>
              <Link to={`/${tenantSlug}/admin/users/invite`} className="eq-quick-action">
                <span className="eq-quick-action__icon" aria-hidden="true">＋</span>
                <span className="eq-quick-action__label">Invite user</span>
                <span className="eq-quick-action__hint">Add a team member</span>
              </Link>
              <Link to={`/${tenantSlug}/data/customer`} className="eq-quick-action">
                <span className="eq-quick-action__icon" aria-hidden="true">◈</span>
                <span className="eq-quick-action__label">View customers</span>
                <span className="eq-quick-action__hint">Browse your data</span>
              </Link>
              <Link to={`/${tenantSlug}/admin/audit`} className="eq-quick-action">
                <span className="eq-quick-action__icon" aria-hidden="true">◷</span>
                <span className="eq-quick-action__label">Audit log</span>
                <span className="eq-quick-action__hint">Every write, every mint</span>
              </Link>
              <Link to={`/${tenantSlug}/storage`} className="eq-quick-action">
                <span className="eq-quick-action__icon" aria-hidden="true">⊞</span>
                <span className="eq-quick-action__label">Storage</span>
                <span className="eq-quick-action__hint">Files in your bucket</span>
              </Link>
              <Link to={`/${tenantSlug}/admin/settings`} className="eq-quick-action">
                <span className="eq-quick-action__icon" aria-hidden="true">✎</span>
                <span className="eq-quick-action__label">Settings</span>
                <span className="eq-quick-action__hint">Modules, branding</span>
              </Link>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
