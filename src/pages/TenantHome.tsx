import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession, moduleEnabled } from '../session';
import { createSupabaseClient } from '../lib/supabaseJwt';
import { HubSidebar, HUB_APP_ICONS, type HubApp } from '../components/HubSidebar';
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

const HUB_APPS: { key: string; label: string; to: string; isBeta: boolean }[] = [
  { key: 'field',   label: 'EQ Field',   to: 'field',   isBeta: false },
  { key: 'service', label: 'EQ Service', to: 'service', isBeta: false },
  { key: 'quotes',  label: 'EQ Quotes',  to: 'quotes',  isBeta: false },
  { key: 'cards',   label: 'EQ Cards',   to: 'cards',   isBeta: true  },
];

const APP_DESCRIPTIONS: Record<string, string> = {
  field:   'Rosters, staff, licences and availability.',
  service: 'Maintenance, defects and customer reports.',
  quotes:  'Quoting and proposals.',
  cards:   'Staff profiles and licence cards.',
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).toUpperCase();
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusDot(status: string): 'ok' | 'warn' | 'err' | 'default' {
  if (['complete', 'completed', 'approved'].includes(status)) return 'ok';
  if (['committing', 'pending', 'submitted'].includes(status)) return 'warn';
  if (['failed', 'rejected', 'rolled_back'].includes(status)) return 'err';
  return 'default';
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

  useEffect(() => { void loadData(); }, []);

  if (!session) return null;

  const greetName = (() => {
    if (session.user.name) return session.user.name.split(' ')[0];
    const fromEmail = session.user.email.split('@')[0].split('.')[0];
    return fromEmail.charAt(0).toUpperCase() + fromEmail.slice(1);
  })();

  const staffCount = counts?.find((c) => c.entity === 'staff')?.count_total ?? null;

  const alertItems = events?.filter(
    (e) => ['failed', 'rejected', 'rolled_back'].includes(e.status) || e.rows_flagged > 0 || e.rows_rejected > 0
  ) ?? [];
  const hasAlerts = !loading && events !== null && alertItems.length > 0;
  const allClear  = !loading && events !== null && alertItems.length === 0;

  // Build sidebar apps — counts wired up as cross-app RPCs are added.
  // Field shows staff total for now; operational counts (on shift, open defects) come later.
  const sidebarApps: HubApp[] = HUB_APPS
    .filter((a) => moduleEnabled(session, a.key))
    .map((a) => ({
      key: a.key,
      label: a.label,
      to: a.to,
      isBeta: a.isBeta,
      count: a.key === 'field' ? staffCount : null,
      hasAlert: false,
      icon: HUB_APP_ICONS[a.key],
    }));

  const enabledApps = HUB_APPS.filter((a) => moduleEnabled(session, a.key));

  return (
    <div className="eq-hub">
      <HubSidebar apps={sidebarApps} />

      <div className="eq-hub__content">

        {hasAlerts && (
          <div className="eq-hub-alert eq-hub-alert--action">
            <span className="eq-hub-alert__icon" aria-hidden="true">⚠</span>
            <span className="eq-hub-alert__text">
              {alertItems.length === 1
                ? '1 import needs attention'
                : `${alertItems.length} imports need attention`}
              {' — '}
              <Link to={`/${tenantSlug}/intake`} className="eq-hub-alert__link">review now</Link>
            </span>
          </div>
        )}

        {allClear && (
          <div className="eq-hub-alert eq-hub-alert--clear">
            <span className="eq-hub-alert__icon" aria-hidden="true">✓</span>
            <span className="eq-hub-alert__text">All clear — no action needed</span>
          </div>
        )}

        <div className="eq-hub-content">

          <div className="eq-hub-content__dateline">
            <span className="eq-hub-content__dateline-dot" aria-hidden="true" />
            {formatDate()}
          </div>

          <h1 className="eq-hub-content__greeting">
            {greeting()}, {greetName}.
          </h1>

          {/* KPI strip — values stubbed until cross-app RPCs are wired */}
          <div className="eq-hub-kpis">
            <div className="eq-hub-kpi">
              <p className="eq-hub-kpi__label">Team</p>
              {loading ? (
                <Skeleton variant="text" width={60} />
              ) : (
                <p className="eq-hub-kpi__value">
                  {staffCount !== null ? staffCount : '—'}
                </p>
              )}
              <p className="eq-hub-kpi__sub">active staff</p>
            </div>
            <div className="eq-hub-kpi">
              <p className="eq-hub-kpi__label">Activity</p>
              {loading ? (
                <Skeleton variant="text" width={60} />
              ) : (
                <p className="eq-hub-kpi__value">
                  {events !== null ? events.length : '—'}
                </p>
              )}
              <p className="eq-hub-kpi__sub">recent imports</p>
            </div>
            <div className="eq-hub-kpi">
              <p className="eq-hub-kpi__label">Sites</p>
              {loading ? (
                <Skeleton variant="text" width={60} />
              ) : (
                <p className="eq-hub-kpi__value">
                  {counts?.find((c) => c.entity === 'site')?.count_total ?? '—'}
                </p>
              )}
              <p className="eq-hub-kpi__sub">active sites</p>
            </div>
          </div>

          {err && (
            <EqError title="Couldn't load dashboard" message={err} onRetry={loadData} />
          )}

          {/* App tiles */}
          <div className="eq-hub-tiles">
            {enabledApps.map((app) => (
              <Link
                key={app.key}
                to={`/${tenantSlug}/${app.to}`}
                className="eq-hub-tile"
              >
                <div className="eq-hub-tile__head">
                  <span className="eq-hub-tile__name">{app.label}</span>
                  <span className={`eq-hub-tile__badge eq-hub-tile__badge--${app.isBeta ? 'beta' : 'live'}`}>
                    {app.isBeta ? 'BETA' : 'LIVE'}
                  </span>
                </div>
                <p className="eq-hub-tile__desc">{APP_DESCRIPTIONS[app.key]}</p>
                <div className="eq-hub-tile__footer">
                  <span className="eq-hub-tile__open">Open →</span>
                </div>
              </Link>
            ))}
          </div>

          {/* Recent activity */}
          <div>
            <div className="eq-hub-activity__head">
              <span className="eq-hub-activity__title">Recent activity</span>
              <Link
                to={`/${tenantSlug}/intake`}
                className="eq-hub-activity__view-all"
              >
                View all →
              </Link>
            </div>

            {loading && !events ? (
              <div className="eq-hub-activity__list">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="eq-hub-activity__item">
                    <Skeleton variant="text" width={280} />
                  </div>
                ))}
              </div>
            ) : !events || events.length === 0 ? (
              <div className="eq-hub-activity__list eq-hub-activity__empty">
                <p>No activity yet — <Link to={`/${tenantSlug}/intake`}>import some data</Link> to see it here.</p>
              </div>
            ) : (
              <div className="eq-hub-activity__list">
                {events.map((e) => {
                  const dot = statusDot(e.status);
                  return (
                    <div key={e.intake_id} className="eq-hub-activity__item">
                      <span className={`eq-hub-activity__dot eq-hub-activity__dot--${dot}`} aria-hidden="true" />
                      <div className="eq-hub-activity__name">
                        {e.source_filename ?? `${e.entity} import`}
                        {e.rows_committed > 0 && (
                          <span className="eq-hub-activity__rows"> · {e.rows_committed.toLocaleString()} rows</span>
                        )}
                      </div>
                      <span className="eq-hub-activity__source">
                        {e.source_app ?? 'Intake'}
                      </span>
                      <span className="eq-hub-activity__time">
                        {relativeTime(e.started_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sync bar */}
          <div className="eq-hub-syncbar">
            <span>
              <span className="eq-hub-syncbar__dot" aria-hidden="true" />
              EQ FIELD
            </span>
            <span>
              <span className="eq-hub-syncbar__dot" aria-hidden="true" />
              EQ SERVICE
            </span>
            <span>
              <span className="eq-hub-syncbar__dot" aria-hidden="true" />
              EQ QUOTES
            </span>
            <span>
              <span className="eq-hub-syncbar__dot" aria-hidden="true" />
              EQ CARDS
            </span>
          </div>

        </div>
      </div>
    </div>
  );
}
