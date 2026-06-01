import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Check } from 'lucide-react';
import { useSession, moduleEnabled, type EqTier } from '../session';
import { HubSidebar, HUB_APP_ICONS, type HubApp } from '../components/HubSidebar';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';
import { HubLayout } from '../components/HubLayout';

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

interface CanonicalEvent {
  id:          string;
  app_source:  string;
  event:       string;
  payload:     Record<string, unknown>;
  occurred_at: string;
}

interface AiAction {
  rank:      number;
  title:     string;
  source:    string;
  app_link?: string;
  deadline?: string;
  urgency:   'critical' | 'high' | 'normal';
}

interface AiOnShift {
  name:   string;
  site?:  string;
  since?: string;
}

interface AiUpcoming {
  day?:   string;
  time?:  string;
  label:  string;
  source: string;
}

interface PipelineSummary {
  total_value_cents: number;
  by_stage:          Record<string, { count: number; value_cents: number }>;
  verbal_agreement:  Array<{ job_name: string; client: string | null; value_cents: number; due_date: string | null }>;
  confirmed_jobs:    Array<{ job_name: string; peak_workers: number | null; duration_weeks: number | null }>;
  headcount:         number;
  peak_demand:       number;
  bench:             number | null;
}

interface AiData {
  brief:                string | null;
  actions:              AiAction[];
  on_shift:             AiOnShift[];
  upcoming:             AiUpcoming[];
  pipeline:             PipelineSummary | null;
  contributing_sources: string[];
  generated_at:         string;
}

const SOURCE_LABELS: Record<string, string> = {
  field:    'EQ Field',
  service:  'EQ Service',
  quotes:   'EQ Quotes',
  cards:    'EQ Cards',
  pipeline: 'Pipeline',
};

function formatSource(source: string): string {
  return source.replace('eq-', '').replace('sks-pipeline', 'pipeline');
}

// Human-readable labels and dot colours for known canonical events.
const EVENT_META: Record<string, { label: string; dot: 'ok' | 'warn' | 'err' | 'default' }> = {
  'quote.created':                 { label: 'Quote created',             dot: 'default' },
  'quote.sent':                    { label: 'Quote sent to client',      dot: 'warn'    },
  'quote.accepted':                { label: 'Quote accepted',            dot: 'ok'      },
  'defect.created':                { label: 'Defect raised',             dot: 'err'     },
  'defect.resolved':               { label: 'Defect resolved',           dot: 'ok'      },
  'maintenance_check.completed':   { label: 'Maintenance check complete', dot: 'ok'     },
  'maintenance_check.overdue':     { label: 'Maintenance check overdue', dot: 'err'     },
  'asset.imported':                { label: 'Equipment imported',        dot: 'ok'      },
  'asset.service_due':             { label: 'Equipment due for service', dot: 'warn'    },
};

const APP_LABELS: Record<string, string> = {
  quotes:  'EQ Quotes',
  service: 'EQ Service',
  field:   'EQ Field',
  cards:   'EQ Cards',
  shell:   'EQ Shell',
};

// `hideForTier` lets us hide tiles for tiers where the module isn't trial-grade.
// Today: trial users don't see Quotes (the in-shell Quotes module is just a
// pointer to the standalone Flask pilot — confusing for new users) and don't
// see Service (the Next.js app is still in active development).
const HUB_APPS: { key: string; label: string; to: string; isBeta: boolean; hideForTier?: EqTier[] }[] = [
  { key: 'cards',   label: 'EQ Cards',   to: 'cards',   isBeta: false },
  { key: 'field',   label: 'EQ Field',   to: 'field',   isBeta: false },
  { key: 'service', label: 'EQ Service', to: 'service', isBeta: true,  hideForTier: ['trial'] },
  { key: 'quotes',  label: 'EQ Quotes',  to: 'quotes',  isBeta: false, hideForTier: ['trial'] },
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
  const [feed, setFeed]     = useState<CanonicalEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [briefingLoading, setBriefingLoading] = useState(true);
  // undefined = still fetching, null = no data, AiData = loaded
  const [aiData, setAiData]             = useState<AiData | null | undefined>(undefined);
  const [regenerating, setRegenerating] = useState(false);
  // Optimistic local state for dismissed/actioned items
  const [actionedTitles, setActionedTitles] = useState<Set<string>>(new Set());

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const silentRefreshFeed = async () => {
    try {
      const res = await fetch('/.netlify/functions/tenant-dashboard');
      if (!res.ok) return;
      const body = await res.json() as { ok: boolean; counts: DashboardCount[]; events: IntakeEvent[]; feed: CanonicalEvent[] };
      setFeed(body.feed ?? []);
    } catch {
      // silent — polling failures don't surface to user
    }
  };

  const handleAction = async (action: AiAction, state: 'actioned' | 'dismissed') => {
    setActionedTitles(prev => new Set([...prev, action.title]));
    try {
      await fetch('/.netlify/functions/briefing-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_title: action.title, action_source: action.source, state }),
      });
    } catch {
      // Optimistic update already applied — silent on network error
    }
  };

  const loadAiData = async (isRegenerate = false) => {
    if (isRegenerate) setRegenerating(true);
    try {
      const url = isRegenerate
        ? '/.netlify/functions/ai-briefing?refresh=1'
        : '/.netlify/functions/ai-briefing';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) { setAiData(null); return; }
      const body = await res.json() as { ok: boolean } & Partial<AiData>;
      if (!body.ok) { setAiData(null); return; }
      setActionedTitles(new Set()); // reset optimistic state on fresh load
      setAiData({
        brief:                body.brief                ?? null,
        actions:              body.actions              ?? [],
        on_shift:             body.on_shift             ?? [],
        upcoming:             body.upcoming             ?? [],
        pipeline:             body.pipeline             ?? null,
        contributing_sources: body.contributing_sources ?? [],
        generated_at:         body.generated_at         ?? new Date().toISOString(),
      });
    } catch {
      setAiData(null);
    } finally {
      if (isRegenerate) setRegenerating(false);
      setBriefingLoading(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/.netlify/functions/tenant-dashboard');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const body = await res.json() as { ok: boolean; counts: DashboardCount[]; events: IntakeEvent[]; feed: CanonicalEvent[] };
      setCounts(body.counts);
      setEvents(body.events);
      setFeed(body.feed ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    void loadAiData();
    pollRef.current = setInterval(() => { void silentRefreshFeed(); }, 60_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  if (!session) return null;

  // Workspace not ready: the session exists but has no usable workspace — a
  // membership that's missing or deactivated. Show a clear notice instead of a
  // dashboard full of dashes and dead links. Platform admins skip this; they
  // can operate across workspaces and shouldn't be blocked.
  const workspaceReady = !!session.tenant && session.tenant.active !== false;
  if (!workspaceReady && !session.user.is_platform_admin) {
    return (
      <HubLayout>
        <div className="eq-page__header">
          <span
            className="eq-pill eq-pill--warn"
            style={{ display: 'inline-block', marginBottom: 12 }}
          >
            Not ready
          </span>
          <h1 className="eq-page__title">Your workspace isn't ready yet</h1>
          <p className="eq-page__lede">
            Your account is signed in, but it isn't linked to an active workspace
            yet — so there's nothing to show here. This usually means your setup
            isn't finished. Ask your administrator to finish setting up your access,
            then sign in again.
          </p>
        </div>
      </HubLayout>
    );
  }

  const greetName = (() => {
    if (session.user.name) return session.user.name.split(' ')[0];
    const fromEmail = session.user.email.split('@')[0].split('.')[0];
    return fromEmail.charAt(0).toUpperCase() + fromEmail.slice(1);
  })();

  const staffCount    = counts?.find((c) => c.entity === 'staff')?.count_total    ?? null;
  const customerCount = counts?.find((c) => c.entity === 'customer')?.count_total ?? null;
  const siteCount     = counts?.find((c) => c.entity === 'site')?.count_total     ?? null;
  const contactCount  = counts?.find((c) => c.entity === 'contact')?.count_total  ?? null;
  // Cross-app counts — populated when apps sync data into canonical via Intake or direct writes.
  // Null (badge hidden) until data flows; never show 0 as that implies "empty" not "not wired".
  const quoteCount    = counts?.find((c) => c.entity === 'quote')?.count_total    || null;
  const incidentCount = counts?.find((c) => c.entity === 'incident')?.count_total || null;
  const licenceCount  = counts?.find((c) => c.entity === 'licence')?.count_total  || null;
  const assetCount    = counts?.find((c) => c.entity === 'asset')?.count_total    ?? null;
  // asset_service_due: count_total = due within 30 days, count_recent = overdue now.
  const assetDueSoon  = counts?.find((c) => c.entity === 'asset_service_due')?.count_total  ?? 0;
  const assetOverdue  = counts?.find((c) => c.entity === 'asset_service_due')?.count_recent ?? 0;

  const sidebarRecords = defaultSidebarRecords().map((r) => {
    if (r.key === 'customer') return { ...r, count: customerCount };
    if (r.key === 'site')     return { ...r, count: siteCount };
    if (r.key === 'contact')  return { ...r, count: contactCount };
    return r;
  });

  const alertItems = events?.filter(
    (e) => ['failed', 'rejected', 'rolled_back'].includes(e.status) || e.rows_flagged > 0 || e.rows_rejected > 0
  ) ?? [];
  const hasAlerts = !loading && events !== null && alertItems.length > 0;
  const allClear  = !loading && events !== null && alertItems.length === 0;

  // Build sidebar apps — counts come from canonical app_data entities.
  // 0 is treated as null (badge hidden) for cross-app counts so the badge
  // only appears once data actually flows from that app into canonical.
  const tier: EqTier = session.tenant.tier;
  const visibleApps = HUB_APPS
    .filter((a) => moduleEnabled(session, a.key))
    .filter((a) => !a.hideForTier?.includes(tier));

  const appCountMap: Record<string, number | null> = {
    field:   staffCount,    // active staff — always available
    service: incidentCount, // open incidents in canonical
    quotes:  quoteCount,    // quotes in canonical
    cards:   licenceCount,  // staff licences (proxy until issued-card entity)
  };

  const sidebarApps: HubApp[] = visibleApps.map((a) => ({
    key: a.key,
    label: a.label,
    to: a.to,
    isBeta: a.isBeta,
    count: appCountMap[a.key] ?? null,
    hasAlert: false,
    icon: HUB_APP_ICONS[a.key],
  }));

  const enabledApps = visibleApps;

  return (
    <div className="eq-hub">
      <HubSidebar apps={sidebarApps} records={sidebarRecords} />

      <div className="eq-hub__content">

        {hasAlerts && (
          <div className="eq-hub-alert eq-hub-alert--action">
            <span className="eq-hub-alert__icon" aria-hidden="true"><AlertTriangle size={14} /></span>
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
            <span className="eq-hub-alert__icon" aria-hidden="true"><Check size={14} /></span>
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

          {/* AI Briefing */}
          {aiData === undefined && briefingLoading && (
            <div className="eq-hub-briefing-skeleton">
              <Skeleton variant="text" width={480} />
              <Skeleton variant="text" width={360} />
            </div>
          )}
          {(aiData?.brief || (aiData?.actions ?? []).length > 0) && (
            <div className="eq-hub-ai">
              {/* Brief prose */}
              {aiData?.brief && (
                <>
                  <div className="eq-hub-ai__header">
                    <span className="eq-hub-ai__badge">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M6 3v3l2 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      AI Brief
                    </span>
                  </div>
                  <p className="eq-hub-briefing">{aiData.brief}</p>
                  <div className="eq-hub-ai__meta">
                    <span>Generated {relativeTime(aiData.generated_at)}</span>
                    <button
                      className="eq-hub-ai__regen"
                      onClick={() => void loadAiData(true)}
                      disabled={regenerating}
                      aria-label="Regenerate briefing"
                    >
                      {regenerating ? 'Refreshing…' : 'Tap to regenerate'}
                    </button>
                  </div>
                  {(aiData.contributing_sources ?? []).length > 0 && (
                    <p className="eq-hub-ai__coverage">
                      Based on{' '}
                      {aiData.contributing_sources
                        .map(s => SOURCE_LABELS[s] ?? s)
                        .join(', ')}
                    </p>
                  )}
                </>
              )}

              {/* Ranked actions */}
              {(aiData?.actions ?? []).length > 0 && (
                <div className="eq-hub-actions">
                  <div className="eq-hub-actions__head">
                    <span className="eq-hub-actions__title">Today's actions</span>
                    <span className="eq-hub-actions__count">{aiData!.actions.length} ranked</span>
                  </div>
                  <div className="eq-hub-actions__list">
                    {aiData!.actions
                      .filter(a => !actionedTitles.has(a.title))
                      .map((action) => {
                        const dest = action.app_link ? `/${tenantSlug}/${action.app_link}` : null;
                        return (
                          <div key={action.rank} className={`eq-hub-action eq-hub-action--${action.urgency}`}>
                            <span className="eq-hub-action__rank">{action.rank}</span>
                            <div className="eq-hub-action__body">
                              {dest ? (
                                <Link to={dest} className="eq-hub-action__title-link">
                                  {action.title}
                                </Link>
                              ) : (
                                <p className="eq-hub-action__title">{action.title}</p>
                              )}
                              <div className="eq-hub-action__meta">
                                <span className="eq-hub-action__source">
                                  {SOURCE_LABELS[formatSource(action.source)] ?? formatSource(action.source)}
                                </span>
                                {action.deadline && (
                                  <span className="eq-hub-action__deadline">{action.deadline}</span>
                                )}
                              </div>
                            </div>
                            <div className="eq-hub-action__feedback">
                              <button
                                className="eq-hub-action__btn eq-hub-action__btn--done"
                                onClick={() => void handleAction(action, 'actioned')}
                                title="Mark done"
                                aria-label="Mark done"
                              >✓</button>
                              <button
                                className="eq-hub-action__btn eq-hub-action__btn--dismiss"
                                onClick={() => void handleAction(action, 'dismissed')}
                                title="Dismiss"
                                aria-label="Dismiss"
                              >×</button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Side panels: On Shift / Upcoming / Pipeline */}
              {((aiData?.on_shift ?? []).length > 0 || (aiData?.upcoming ?? []).length > 0 || aiData?.pipeline) && (
                <div className="eq-hub-panels">
                  {(aiData?.on_shift ?? []).length > 0 && (
                    <div className="eq-hub-panel">
                      <div className="eq-hub-panel__head">
                        <span className="eq-hub-panel__title">On shift now</span>
                        <span className="eq-hub-panel__count">{aiData!.on_shift.length}</span>
                      </div>
                      {aiData!.on_shift.map((s, i) => (
                        <div key={i} className="eq-hub-panel__item">
                          <span className="eq-hub-panel__avatar">{s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
                          <div className="eq-hub-panel__info">
                            <p className="eq-hub-panel__name">{s.name}</p>
                            {s.site && <p className="eq-hub-panel__sub">{s.site}{s.since ? ` · since ${s.since}` : ''}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(aiData?.upcoming ?? []).length > 0 && (
                    <div className="eq-hub-panel">
                      <div className="eq-hub-panel__head">
                        <span className="eq-hub-panel__title">Upcoming</span>
                        <span className="eq-hub-panel__count">next 48h</span>
                      </div>
                      {aiData!.upcoming.map((u, i) => (
                        <div key={i} className="eq-hub-panel__item eq-hub-panel__item--upcoming">
                          {(u.day || u.time) && (
                            <div className="eq-hub-panel__when">
                              {u.day && <span className="eq-hub-panel__day">{u.day}</span>}
                              {u.time && <span className="eq-hub-panel__time">{u.time}</span>}
                            </div>
                          )}
                          <div className="eq-hub-panel__info">
                            <p className="eq-hub-panel__name">{u.label}</p>
                            <p className="eq-hub-panel__sub">{u.source.replace('eq-', 'EQ ').replace('sks-pipeline', 'Pipeline')}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {aiData?.pipeline && (
                    <div className="eq-hub-panel">
                      <div className="eq-hub-panel__head">
                        <span className="eq-hub-panel__title">Pipeline</span>
                        <span className="eq-hub-panel__count">
                          {new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0, notation: 'compact' }).format(aiData.pipeline.total_value_cents / 100)}
                        </span>
                      </div>
                      {Object.entries(aiData.pipeline.by_stage).map(([stage, data]) => (
                        <div key={stage} className="eq-hub-panel__item">
                          <span className={`eq-hub-panel__stage-dot eq-hub-panel__stage-dot--${stage}`} aria-hidden="true" />
                          <div className="eq-hub-panel__info">
                            <p className="eq-hub-panel__name" style={{ textTransform: 'capitalize' }}>{stage}</p>
                            <p className="eq-hub-panel__sub">
                              {data.count} tender{data.count !== 1 ? 's' : ''} ·{' '}
                              {new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0, notation: 'compact' }).format(data.value_cents / 100)}
                            </p>
                          </div>
                        </div>
                      ))}
                      {aiData.pipeline.bench !== null && (
                        <div className="eq-hub-panel__capacity">
                          <span>{aiData.pipeline.bench} on bench</span>
                          <span className="eq-hub-panel__capacity-sep">·</span>
                          <span>{aiData.pipeline.peak_demand} peak demand</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
            <Link to={`/${tenantSlug}/data/customer`} className="eq-hub-kpi eq-hub-kpi--link">
              <p className="eq-hub-kpi__label">Customers</p>
              {loading ? (
                <Skeleton variant="text" width={60} />
              ) : (
                <p className="eq-hub-kpi__value">
                  {customerCount ?? '—'}
                </p>
              )}
              <p className="eq-hub-kpi__sub">all customers →</p>
            </Link>
            <Link to={`/${tenantSlug}/data/contact`} className="eq-hub-kpi eq-hub-kpi--link">
              <p className="eq-hub-kpi__label">Contacts</p>
              {loading ? (
                <Skeleton variant="text" width={60} />
              ) : (
                <p className="eq-hub-kpi__value">
                  {contactCount ?? '—'}
                </p>
              )}
              <p className="eq-hub-kpi__sub">all contacts →</p>
            </Link>
            <Link to={`/${tenantSlug}/data/site`} className="eq-hub-kpi eq-hub-kpi--link">
              <p className="eq-hub-kpi__label">Sites</p>
              {loading ? (
                <Skeleton variant="text" width={60} />
              ) : (
                <p className="eq-hub-kpi__value">
                  {siteCount ?? '—'}
                </p>
              )}
              <p className="eq-hub-kpi__sub">all sites →</p>
            </Link>
            <Link to={`/${tenantSlug}/data/asset`} className="eq-hub-kpi eq-hub-kpi--link">
              <p className="eq-hub-kpi__label">Equipment</p>
              {loading ? (
                <Skeleton variant="text" width={60} />
              ) : (
                <p className="eq-hub-kpi__value">
                  {assetCount ?? '—'}
                </p>
              )}
              <p className="eq-hub-kpi__sub">
                {assetOverdue > 0
                  ? `${assetOverdue} overdue for service →`
                  : assetDueSoon > 0
                    ? `${assetDueSoon} due this month →`
                    : 'all equipment →'}
              </p>
            </Link>
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

          {/* Cross-app briefing feed — canonical events from EQ Quotes, Service, etc. */}
          {(feed !== null && feed.length > 0) && (
            <div>
              <div className="eq-hub-activity__head">
                <span className="eq-hub-activity__title">Live feed</span>
              </div>

              {loading && !feed ? (
                <div className="eq-hub-activity__list">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="eq-hub-activity__item">
                      <Skeleton variant="text" width={280} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="eq-hub-activity__list">
                  {(feed ?? []).map((e) => {
                    const meta = EVENT_META[e.event] ?? { label: e.event, dot: 'default' as const };
                    return (
                      <div key={e.id} className="eq-hub-activity__item">
                        <span className={`eq-hub-activity__dot eq-hub-activity__dot--${meta.dot}`} aria-hidden="true" />
                        <div className="eq-hub-activity__name">{meta.label}</div>
                        <span className="eq-hub-activity__source">
                          {APP_LABELS[e.app_source] ?? e.app_source}
                        </span>
                        <span className="eq-hub-activity__time">
                          {relativeTime(e.occurred_at)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Recent activity — intake pipeline events */}
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

          {/* Sync bar — the green dot conveys "connected"; the visually-hidden
              text carries that meaning for screen readers since colour can't. */}
          <div className="eq-hub-syncbar" role="group" aria-label="App connection status">
            {['EQ Field', 'EQ Service', 'EQ Quotes', 'EQ Cards'].map((app) => (
              <span key={app}>
                <span className="eq-hub-syncbar__dot" aria-hidden="true" />
                {app.toUpperCase()}
                <span className="eq-sr-only">: connected</span>
              </span>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
