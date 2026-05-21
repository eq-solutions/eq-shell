// TenantHome — the real dashboard. Counts + recent activity + module grid.

import { useEffect, useState } from 'react';
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
  { key: 'intake', label: 'Intake', description: 'Drag-drop CSVs into canonical with AI mapping.', to: 'intake', live: true },
  { key: 'cards', label: 'Cards', description: 'Tradie wallet — licences + tap-to-copy.', to: 'cards', live: true },
  { key: 'field', label: 'Field', description: 'Roster, timesheets, sites.', to: 'field', live: true },
  { key: 'quotes', label: 'Quotes', description: 'React rewrite of the Flask v1 pilot.', to: 'quotes', live: false },
  { key: 'service', label: 'Service', description: 'PPM, work orders, assets.', to: 'service', live: false },
  { key: 'tender_pipeline', label: 'Tender Pipeline', description: 'Kanban + fortnightly review.', to: 'tender-pipeline', live: false },
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

const FEATURED_KEYS = ['customer', 'staff', 'schedule', 'tender', 'timesheet', 'leave_request'];

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

function statusDot(status: string): 'ok' | 'warn' | 'err' | undefined {
  if (status === 'complete' || status === 'approved') return 'ok';
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

  if (!session) return null;

  const enabledModules = MODULES.filter((m) => moduleEnabled(session, m.key));
  const featuredCounts = FEATURED_KEYS.map((k) => counts?.find((c) => c.entity === k)).filter(
    (c): c is DashboardCount => c !== undefined,
  );

  const greetName = session.user.email.split('@')[0].split('.')[0];
  const greetNameCapitalised = greetName.charAt(0).toUpperCase() + greetName.slice(1);

  return (
    <>
      <Topbar />
      <main className="eq-page">
        <div className="eq-page__header">
          <h1 className="eq-page__title">Welcome back, {greetNameCapitalised}</h1>
          <p className="eq-page__lede">
            {session.tenant.name} · You're signed in as{' '}
            <strong>{session.user.role.replace('_', ' ')}</strong>
            {session.user.is_platform_admin ? ' with EQ platform admin access.' : '.'}
          </p>
        </div>

        {err && <EqError title="Couldn't load dashboard" message={err} onRetry={loadData} />}

        <section className="eq-section">
          <h2 className="eq-section__heading">Snapshot</h2>
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
                  {c.count_recent > 0 && (
                    <p className="eq-stat-card__delta eq-stat-card__delta--up">
                      +{c.count_recent} this week
                    </p>
                  )}
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
                className="eq-module-card"
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
      </main>
    </>
  );
}
