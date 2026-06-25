import { useState, useEffect, type JSX } from "react";
import {
  computeHealthScores,
  runLicenceExpiryCheck,
  runOrphanCheck,
  computeComplianceMetrics,
  detectAllDuplicates,
  decayCheck,
} from "@eq/intake";
import type {
  HealthScore,
  LicenceExpiryAlertSummary,
  ComplianceMetrics,
  DuplicateReport,
  DecaySummary,
} from "@eq/intake";
import type { SupabaseLikeClient } from "../canonical/commit-canonical.js";
import { entityLabel } from "../shared/entity-label.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface IntakeHealthHomeProps {
  supabase?: SupabaseLikeClient | null;
  tenantId?: string;
  onEntityClick?: (entity: string) => void;
}

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface OrphanSummary {
  assets_no_site_count:     number;
  contacts_no_parent_count: number;
  licences_no_staff_count:  number;
  sites_no_customer_count:  number;
  total:                    number;
}

interface DimensionResult {
  reachability:  number; // 0–1
  compliance:    number;
  serviceability: number;
  integrity:     number;
  composite:     number; // 0–100
}

interface ActionItem {
  id:          string;
  title:       string;
  description: string;
  pts:         number;
  severity:    "danger" | "warning" | "info";
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000001";

function computeDimensions(
  scores:    HealthScore[] | null,
  licences:  LicenceExpiryAlertSummary | null,
  orphans:   OrphanSummary | null,
  cm:        ComplianceMetrics | null,
): DimensionResult {
  const st = cm?.staff.total ?? 0;

  // Reachability (20%): staff email + contacts completeness
  const staffEmailRate  = st > 0 ? (cm!.staff.has_email / st) : 0;
  const contactsScore   = scores?.find((s) => s.entity === "contacts")?.score ?? 0;
  const reachability    = (staffEmailRate + contactsScore) / 2;

  // Compliance (35%): licence coverage (≥1 record per staff) + emergency contacts
  const licenceRecords  = licences?.records_total ?? 0;
  const licenceCoverage = st > 0 ? Math.min(1, licenceRecords / st) : 0;
  const emergencyRate   = st > 0 ? (cm!.staff.has_emergency_contact / st) : 0;
  const compliance      = (licenceCoverage + emergencyRate) / 2;

  // Serviceability (35%): trade classification + sites completeness
  const tradeRate       = st > 0 ? (cm!.staff.has_trade / st) : 0;
  const sitesScore      = scores?.find((s) => s.entity === "sites")?.score ?? 0;
  const serviceability  = (tradeRate + sitesScore) / 2;

  // Integrity (10%): orphan-free
  const orphanTotal = orphans?.total ?? 0;
  const integrity   = orphanTotal === 0 ? 1 : Math.max(0, 1 - orphanTotal / 100);

  const composite = Math.round(
    reachability * 20 + compliance * 35 + serviceability * 35 + integrity * 10,
  );

  return { reachability, compliance, serviceability, integrity, composite };
}

function deriveActions(
  licences: LicenceExpiryAlertSummary | null,
  cm:       ComplianceMetrics | null,
): ActionItem[] {
  const actions: ActionItem[] = [];
  const st = cm?.staff.total ?? 0;

  if (st > 0 && (licences?.records_total ?? 0) === 0) {
    actions.push({
      id:          "no_licences",
      title:       `${st} active staff — no licence records on file`,
      description: "White cards, yellow cards, electrical licences are all untracked. Adds ~25 pts to compliance.",
      pts:         25,
      severity:    "danger",
    });
  }

  const missingTrade = st - (cm?.staff.has_trade ?? 0);
  if (st > 0 && missingTrade > 0) {
    actions.push({
      id:          "no_trade",
      title:       `${missingTrade} of ${st} staff have no trade classification`,
      description: "Skill-based dispatch and PPM assignment require this field. Adds ~12 pts to serviceability.",
      pts:         12,
      severity:    "warning",
    });
  }

  const missingEmergency = st - (cm?.staff.has_emergency_contact ?? 0);
  if (st > 0 && missingEmergency > Math.floor(st * 0.1)) {
    actions.push({
      id:          "no_emergency",
      title:       `${missingEmergency} of ${st} staff missing emergency contact`,
      description: "Required for field dispatch under H&S compliance. Adds ~8 pts to compliance.",
      pts:         8,
      severity:    "warning",
    });
  }

  if ((licences?.total ?? 0) > 0) {
    actions.push({
      id:          "expiring",
      title:       `${licences!.total} licence${licences!.total === 1 ? "" : "s"} expiring within 60 days`,
      description: `${licences!.critical > 0 ? `${licences!.critical} expired or critical. ` : ""}Renewal required before deployment.`,
      pts:         4,
      severity:    licences!.critical > 0 ? "danger" : "warning",
    });
  }

  const missingEmail = st - (cm?.staff.has_email ?? 0);
  if (missingEmail > 0) {
    actions.push({
      id:          "no_email",
      title:       `${missingEmail} staff ${missingEmail === 1 ? "has" : "have"} no email address`,
      description: "They won't receive roster notifications or shift confirmations. Adds ~3 pts to reachability.",
      pts:         3,
      severity:    "info",
    });
  }

  return actions.sort((a, b) => b.pts - a.pts).slice(0, 4);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function dimFill(score: number): string {
  if (score >= 0.8) return "eq-health-dim-fill--ok";
  if (score >= 0.5) return "eq-health-dim-fill--warn";
  return "eq-health-dim-fill--err";
}

function statusLabel(composite: number): string {
  if (composite >= 85) return "Good";
  if (composite >= 60) return "Fair";
  if (composite >= 40) return "Needs attention";
  return "Gaps present";
}

function ringColour(composite: number): string {
  if (composite >= 85) return "var(--eq-ok)";
  if (composite >= 60) return "var(--eq-sky)";
  if (composite >= 40) return "var(--eq-warn)";
  return "var(--eq-err)";
}


// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreRing({ composite }: { composite: number }): JSX.Element {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - composite / 100);
  const colour = ringColour(composite);
  const label  = statusLabel(composite);

  return (
    <div className="eq-health-ring-wrap">
      <div className="eq-health-ring-svg">
        <svg width="96" height="96" viewBox="0 0 96 96" fill="none">
          <circle cx="48" cy="48" r={r} stroke="var(--eq-line)" strokeWidth="7" />
          <circle
            cx="48" cy="48" r={r}
            stroke={colour}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            transform="rotate(-90 48 48)"
          />
        </svg>
        <div className="eq-health-ring-inner">
          <span className="eq-health-ring-num">{composite}</span>
          <span className="eq-health-ring-sub">/100</span>
        </div>
      </div>
      <span className="eq-health-ring-status" style={{ color: colour }}>{label}</span>
    </div>
  );
}

function DimensionBar({
  label, score, weight,
}: { label: string; score: number; weight: string }): JSX.Element {
  return (
    <div className="eq-health-dim">
      <span className="eq-health-dim-name">
        {label}
        <span className="eq-health-dim-weight">{weight}</span>
      </span>
      <div className="eq-health-dim-track">
        <div
          className={`eq-health-dim-fill ${dimFill(score)}`}
          style={{ width: pct(score) } as React.CSSProperties}
        />
      </div>
      <span className="eq-health-dim-pct">{pct(score)}</span>
    </div>
  );
}

function ActionCard({
  action, onEntityClick,
}: { action: ActionItem; onEntityClick?: (entity: string) => void }): JSX.Element {
  const entityMap: Record<string, string> = {
    no_licences:   "licences",
    no_trade:      "staff",
    no_emergency:  "staff",
    no_email:      "staff",
    expiring:      "licences",
  };

  return (
    <button
      type="button"
      className={`eq-health-action eq-health-action--${action.severity}`}
      onClick={
        onEntityClick && entityMap[action.id]
          ? () => onEntityClick(entityMap[action.id])
          : undefined
      }
    >
      <div className={`eq-health-action-icon eq-health-action-icon--${action.severity}`} aria-hidden="true">
        {action.severity === "danger" ? "!" : "→"}
      </div>
      <div className="eq-health-action-body">
        <p className="eq-health-action-title">{action.title}</p>
        <p className="eq-health-action-sub">{action.description}</p>
      </div>
      <span className={`eq-health-action-badge eq-health-action-badge--${action.severity}`}>
        +{action.pts} pts
      </span>
    </button>
  );
}

function HealthCard({
  hs, onClick,
}: { hs: HealthScore; onClick?: (entity: string) => void }): JSX.Element {
  const label      = entityLabel(hs.entity);
  const percentage = pct(hs.score);
  const fillClass  = hs.score >= 0.9 ? "eq-health-bar--ok" : hs.score >= 0.7 ? "eq-health-bar--warn" : "eq-health-bar--err";

  return (
    <button
      type="button"
      className="eq-health-card"
      onClick={onClick ? () => onClick(hs.entity) : undefined}
      aria-label={`${label} — ${percentage} complete`}
    >
      <div className="eq-health-card__header">
        <span className="eq-health-card__name">{label}</span>
        <span className="eq-health-card__count">
          {hs.total.toLocaleString()} record{hs.total === 1 ? "" : "s"}
        </span>
      </div>
      <div className="eq-health-bar-wrap">
        <div className={`eq-health-bar ${fillClass}`} style={{ width: percentage } as React.CSSProperties} />
      </div>
      <span className="eq-health-card__pct">{percentage}</span>
      {hs.gaps.length > 0 && (
        <p className="eq-health-card__gaps">Missing: {hs.gaps.join(", ")}</p>
      )}
    </button>
  );
}

function LicenceStrip({ summary }: { summary: LicenceExpiryAlertSummary }): JSX.Element {
  if (summary.records_total === 0) {
    return (
      <div className="eq-health-licence-strip">
        <span className="eq-health-badge eq-health-badge--err">No licence data — 0 records</span>
      </div>
    );
  }

  if (summary.total === 0) {
    return (
      <div className="eq-health-licence-strip">
        <span className="eq-health-badge eq-health-badge--ok">
          All {summary.records_total.toLocaleString()} licences current
        </span>
      </div>
    );
  }

  return (
    <div className="eq-health-licence-strip">
      {summary.critical > 0 && (
        <span className="eq-health-badge eq-health-badge--critical">{summary.critical} expired / critical</span>
      )}
      {summary.warning > 0 && (
        <span className="eq-health-badge eq-health-badge--warning">{summary.warning} expiring soon</span>
      )}
      {summary.info > 0 && (
        <span className="eq-health-badge eq-health-badge--info">{summary.info} within 60 days</span>
      )}
    </div>
  );
}

function DuplicateStrip({
  report, onEntityClick,
}: { report: DuplicateReport[]; onEntityClick?: (entity: string) => void }): JSX.Element {
  const total = report.reduce((n, r) => n + r.clusters.length, 0);

  if (total === 0) {
    return (
      <div className="eq-health-licence-strip">
        <span className="eq-health-badge eq-health-badge--ok">No duplicates found</span>
      </div>
    );
  }

  return (
    <div className="eq-health-licence-strip">
      {report
        .filter((r) => r.clusters.length > 0)
        .map((r) => {
          const text = `${r.clusters.length} possible duplicate${r.clusters.length !== 1 ? "s" : ""} in ${r.entity}`;
          return onEntityClick ? (
            <button
              key={r.entity}
              type="button"
              className="eq-health-badge eq-health-badge--warning eq-health-orphan__btn"
              onClick={() => onEntityClick(r.entity)}
              title={`Open ${r.entity} drill-down`}
            >
              {text}
            </button>
          ) : (
            <span key={r.entity} className="eq-health-badge eq-health-badge--warning">{text}</span>
          );
        })}
    </div>
  );
}

function OrphanStrip({
  summary, onEntityClick,
}: { summary: OrphanSummary; onEntityClick?: (entity: string) => void }): JSX.Element {
  if (summary.total === 0) {
    return (
      <div className="eq-health-licence-strip">
        <span className="eq-health-badge eq-health-badge--ok">No broken links</span>
      </div>
    );
  }

  function Badge({ count, entity, label }: { count: number; entity: string; label: string }): JSX.Element | null {
    if (count === 0) return null;
    const text = `${count} ${label}`;
    return onEntityClick ? (
      <button
        type="button"
        className="eq-health-badge eq-health-badge--warning eq-health-orphan__btn"
        onClick={() => onEntityClick(entity)}
        title={`Open ${entity} drill-down`}
      >
        {text}
      </button>
    ) : (
      <span className="eq-health-badge eq-health-badge--warning">{text}</span>
    );
  }

  return (
    <div className="eq-health-licence-strip">
      <Badge count={summary.assets_no_site_count}     entity="assets"   label={`asset${summary.assets_no_site_count !== 1 ? "s" : ""} missing site`} />
      <Badge count={summary.contacts_no_parent_count} entity="contacts" label={`contact${summary.contacts_no_parent_count !== 1 ? "s" : ""} unlinked`} />
      <Badge count={summary.licences_no_staff_count}  entity="licences" label={`licence${summary.licences_no_staff_count !== 1 ? "s" : ""} missing staff`} />
      <Badge count={summary.sites_no_customer_count}  entity="sites"    label={`site${summary.sites_no_customer_count !== 1 ? "s" : ""} missing customer`} />
    </div>
  );
}

function DecayStrip({
  report, onEntityClick,
}: { report: DecaySummary[]; onEntityClick?: (entity: string) => void }): JSX.Element {
  const anyStale = report.some((r) => r.aging + r.stale + r.very_stale > 0);

  if (!anyStale) {
    return (
      <div className="eq-health-licence-strip">
        <span className="eq-health-badge eq-health-badge--ok">All records current</span>
      </div>
    );
  }

  return (
    <div className="eq-health-licence-strip">
      {report
        .filter((r) => r.aging + r.stale + r.very_stale > 0)
        .map((r) => {
          const label    = entityLabel(r.entity);
          const severity = r.very_stale > 0 ? "err" : r.stale > 0 ? "warning" : "info";
          const worst    = r.very_stale > 0
            ? `${r.very_stale} very stale`
            : r.stale > 0
            ? `${r.stale} stale`
            : `${r.aging} aging`;
          const tip = r.stalest[0]
            ? `Oldest: ${r.stalest[0].label} (${r.stalest[0].days_since}d)`
            : `${r.oldest_days}d since last update`;

          return onEntityClick ? (
            <button
              key={r.entity}
              type="button"
              className={`eq-health-badge eq-health-badge--${severity} eq-health-orphan__btn`}
              onClick={() => onEntityClick(r.entity)}
              title={tip}
            >
              {label}: {worst}, oldest {r.oldest_days}d
            </button>
          ) : (
            <span
              key={r.entity}
              className={`eq-health-badge eq-health-badge--${severity}`}
              title={tip}
            >
              {label}: {worst}, oldest {r.oldest_days}d
            </span>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function IntakeHealthHome({
  supabase,
  tenantId,
  onEntityClick,
}: IntakeHealthHomeProps): JSX.Element {
  const resolvedTenantId = tenantId ?? DEFAULT_TENANT_ID;

  if (!tenantId) {
    // eslint-disable-next-line no-console
    console.warn("[IntakeHealthHome] tenantId prop not provided — health queries will use the fixture tenant.");
  }

  const [scores,     setScores]     = useState<HealthScore[] | null>(null);
  const [licences,   setLicences]   = useState<LicenceExpiryAlertSummary | null>(null);
  const [orphans,    setOrphans]    = useState<OrphanSummary | null>(null);
  const [compliance, setCompliance] = useState<ComplianceMetrics | null>(null);
  const [dupes,      setDupes]      = useState<DuplicateReport[] | null>(null);
  const [dupesBusy,  setDupesBusy]  = useState(false);
  const [decay,      setDecay]      = useState<DecaySummary[] | null>(null);
  const [decayBusy,  setDecayBusy]  = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    // The demo's SupabaseLikeClient is narrower than @eq/intake's (no select).
    // At runtime the actual client has select — this cast is safe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    Promise.allSettled([
      computeHealthScores(sb),
      runLicenceExpiryCheck(sb, resolvedTenantId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runOrphanCheck({ supabase: supabase as any, tenantId: resolvedTenantId }),
      computeComplianceMetrics(sb),
    ]).then(([healthResult, licenceResult, orphanResult, complianceResult]) => {
      if (cancelled) return;

      if (healthResult.status === "fulfilled") {
        setScores(healthResult.value);
      } else {
        setError(
          healthResult.reason instanceof Error
            ? healthResult.reason.message
            : String(healthResult.reason),
        );
      }

      if (licenceResult.status === "fulfilled") {
        setLicences(licenceResult.value);
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          "[IntakeHealthHome] Licence expiry check failed:",
          licenceResult.reason instanceof Error
            ? licenceResult.reason.message
            : licenceResult.reason,
        );
      }

      if (orphanResult.status === "fulfilled") {
        setOrphans(orphanResult.value.summary);
      }

      if (complianceResult.status === "fulfilled") {
        setCompliance(complianceResult.value);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [supabase, resolvedTenantId]);

  if (!supabase) {
    return (
      <section className="eq-health-home">
        <div className="eq-health-notice">Connect EQ to see your data health</div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="eq-health-home">
        <div className="eq-health-loading">Checking your data…</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="eq-health-home">
        <div className="eq-health-notice eq-health-notice--err" role="alert">{error}</div>
      </section>
    );
  }

  const dims    = computeDimensions(scores, licences, orphans, compliance);
  const actions = deriveActions(licences, compliance);

  const scanDuplicates = async () => {
    if (!supabase || dupesBusy) return;
    setDupesBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const report = await detectAllDuplicates(supabase as any);
      setDupes(report);
    } catch {
      // non-critical — silently skip
    } finally {
      setDupesBusy(false);
    }
  };

  const scanDecay = async () => {
    if (!supabase || decayBusy) return;
    setDecayBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const report = await decayCheck(supabase as any);
      setDecay(report);
    } catch {
      // non-critical — silently skip
    } finally {
      setDecayBusy(false);
    }
  };

  return (
    <section className="eq-health-home">

      {/* Composite score + 4 dimensions */}
      <div className="eq-health-top">
        <ScoreRing composite={dims.composite} />
        <div className="eq-health-dims">
          <DimensionBar label="Reachability"  score={dims.reachability}   weight="20%" />
          <DimensionBar label="Compliance"    score={dims.compliance}     weight="35%" />
          <DimensionBar label="Serviceability" score={dims.serviceability} weight="35%" />
          <DimensionBar label="Integrity"     score={dims.integrity}      weight="10%" />
        </div>
      </div>

      {/* Action queue */}
      {actions.length > 0 && (
        <div className="eq-health-actions">
          <span className="eq-health-section-label">
            Fix these to improve your score
          </span>
          {actions.map((a) => (
            <ActionCard key={a.id} action={a} onEntityClick={onEntityClick} />
          ))}
        </div>
      )}

      {/* Entity cards */}
      <div className="eq-health-grid">
        {(scores ?? []).map((hs) => (
          <HealthCard key={hs.entity} hs={hs} onClick={onEntityClick} />
        ))}
      </div>

      {/* Licence strip */}
      {licences && (
        <div className="eq-health-strip-section">
          <span className="eq-health-section-label">Licences</span>
          <LicenceStrip summary={licences} />
        </div>
      )}

      {/* Orphan strip */}
      {orphans && (
        <div className="eq-health-strip-section">
          <span className="eq-health-section-label">Broken links</span>
          <OrphanStrip summary={orphans} onEntityClick={onEntityClick} />
        </div>
      )}

      {/* Duplicate detection (on-demand) */}
      <div className="eq-health-strip-section">
        <span className="eq-health-section-label">Duplicates</span>
        {dupes === null ? (
          <button
            type="button"
            className="eq-intake-btn-ghost"
            onClick={scanDuplicates}
            disabled={dupesBusy}
          >
            {dupesBusy ? "Scanning…" : "Scan for possible duplicates"}
          </button>
        ) : (
          <DuplicateStrip report={dupes} onEntityClick={onEntityClick} />
        )}
      </div>

      {/* Decay detection (on-demand) */}
      <div className="eq-health-strip-section">
        <span className="eq-health-section-label">Record age</span>
        {decay === null ? (
          <button
            type="button"
            className="eq-intake-btn-ghost"
            onClick={scanDecay}
            disabled={decayBusy}
          >
            {decayBusy ? "Scanning…" : "Check for stale records"}
          </button>
        ) : (
          <DecayStrip report={decay} onEntityClick={onEntityClick} />
        )}
      </div>

    </section>
  );
}
