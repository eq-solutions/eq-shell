/**
 * IntakeModule — the production-mount entry-point for EQ Intake.
 *
 * Host app (the EQ Shell) imports this and mounts it at /intake.
 *
 * One screen, two questions:
 *   1. Drop a file — parsed + classified once by the shared useIntakeBundle
 *      hook ("looks like customers — 92% sure").
 *   2. Pick where it goes — Into EQ (canonical commit) or out to Xero / MYOB /
 *      Outlook / SharePoint / Equinix (reshape-out CSV). The same dropped
 *      files feed every destination, so nobody drops twice.
 *
 * This replaces the old three-stacked-sections layout (QuickExportSection +
 * RollupDropZone + CanonicalCommitSection), which made the bookkeeper drop
 * files once per flow. QuickExportSection and CanonicalCommitSection have
 * been removed; their reusable pieces now live in src/shared/. RollupDropZone
 * survives for the standalone playground (App.tsx) and the package barrel.
 *
 * Routes log to `eq-intake:routes` in localStorage by default. Host can
 * override via the onDestinationChange prop.
 */

import { useMemo, useState, useEffect, type JSX } from "react";
import { type ParsedSheet } from "@eq/intake";
import { useIntakeBundle, roleLabel, ROLE_REGISTRY, type IntakeBundle } from "../shared/intake-bundle.js";
import { IntakeDropZone } from "../shared/IntakeDropZone.js";
import { MappingPreviewPanel } from "../shared/MappingPreviewPanel.js";
import { RowsDisclosure } from "../shared/RowsDisclosure.js";
import { entityLabel } from "../shared/entity-label.js";
import { FreeformIntakeInput, type AiClient } from "../shared/FreeformIntakeInput.js";
import { ReconcileModule } from "./ReconcileModule.js";
import { IntakeHealthHome } from "./IntakeHealthHome.js";
import { EntityDrillDown } from "./EntityDrillDown.js";
import { AskCanonical } from "./AskCanonical.js";
import { QUICK_DESTINATIONS, encodeCsv, type QuickDestination } from "../quick-export/destinations.js";
import {
  commitBundleToCanonical,
  type SupabaseLikeClient,
  type CommitResult,
} from "../canonical/commit-canonical.js";
import type { RoleName } from "../rollup/roles.js";
import { BUILTIN_TEMPLATES } from "../rollup/templates.js";
import {
  renderTemplate,
  renderToCsv,
  type DestinationTemplate,
} from "../rollup/template.js";

export interface IntakeModuleProps {
  /**
   * Authenticated Supabase client. Passed by the EQ Shell via getSupabase().
   * When omitted, the Into-EQ destination renders disabled with a "Configure
   * Supabase to enable" hint. The standalone Vite demo passes nothing.
   */
  supabase?: SupabaseLikeClient | null;
  /**
   * Tenant ID for canonical commits. In the per-tenant Supabase model the
   * shell reads this from env (VITE_TENANT_ID) and passes it down.
   */
  tenantId?: string;
  /**
   * Optional AI client for the freeform natural language input. When absent
   * the FreeformIntakeInput renders in preview-only mode with a notice.
   */
  ai?: AiClient | null;
  /**
   * Optional callback fired when the user picks a destination. Defaults to a
   * localStorage logger keyed `eq-intake:routes`.
   */
  onDestinationChange?: (
    value: string | undefined,
    source: "suggested" | "free_text",
  ) => void;
}

const INTO_EQ_ID = "into-eq";
/**
 * Destination IDs collide across the two source lists — both QUICK_DESTINATIONS
 * and BUILTIN_TEMPLATES carry an "outlook-contacts" id, for instance. Namespace
 * them so the picker's <select> value is unambiguous.
 */
const QUICK_PREFIX = "quick:";
const TEMPLATE_PREFIX = "tpl:";
const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const ROUTE_LOG_KEY = "eq-intake:routes";

function defaultRouteLogger(
  value: string | undefined,
  source: "suggested" | "free_text",
): void {
  if (!value) return;
  try {
    const existing = localStorage.getItem(ROUTE_LOG_KEY);
    const log: Array<{ at: string; destination: string; source: string }> = existing
      ? JSON.parse(existing)
      : [];
    log.push({ at: new Date().toISOString(), destination: value, source });
    localStorage.setItem(ROUTE_LOG_KEY, JSON.stringify(log.slice(-200)));
  } catch {
    // localStorage full / disabled — silently skip
  }
}

type IntakeMode = "health" | "import" | "reconcile" | "ask";

export function IntakeModule(props: IntakeModuleProps): JSX.Element {
  const onDestinationChange = useMemo(
    () => props.onDestinationChange ?? defaultRouteLogger,
    [props.onDestinationChange],
  );

  const bundle = useIntakeBundle();
  const [destId, setDestId] = useState<string>(INTO_EQ_ID);
  const [mode, setMode] = useState<IntakeMode>("health");
  const [drillEntity, setDrillEntity] = useState<string | null>(null);

  // Reset drill-down when switching away from health tab
  useEffect(() => {
    if (mode !== "health") setDrillEntity(null);
  }, [mode]);

  const exportDest = useMemo(
    () => QUICK_DESTINATIONS.find((d) => `${QUICK_PREFIX}${d.id}` === destId),
    [destId],
  );
  const joinTemplate = useMemo(
    () => BUILTIN_TEMPLATES.find((t) => `${TEMPLATE_PREFIX}${t.id}` === destId),
    [destId],
  );
  const isCanonical = destId === INTO_EQ_ID;

  return (
    <section className="eq-intake-module">
      {/* Mode toggle — Health (default) / Import / Reconcile */}
      <div className="eq-intake-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "health"}
          className={"eq-intake-tab" + (mode === "health" ? " eq-intake-tab--active" : "")}
          onClick={() => setMode("health")}
        >
          Health
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "import"}
          className={"eq-intake-tab" + (mode === "import" ? " eq-intake-tab--active" : "")}
          onClick={() => { setDrillEntity(null); setMode("import"); }}
        >
          Import
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "reconcile"}
          className={"eq-intake-tab" + (mode === "reconcile" ? " eq-intake-tab--active" : "")}
          onClick={() => { setDrillEntity(null); setMode("reconcile"); }}
        >
          Reconcile
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "ask"}
          className={"eq-intake-tab" + (mode === "ask" ? " eq-intake-tab--active" : "")}
          onClick={() => { setDrillEntity(null); setMode("ask"); }}
        >
          Ask
        </button>
      </div>

      {mode === "health" ? (
        drillEntity !== null ? (
          <EntityDrillDown
            entity={drillEntity}
            supabase={props.supabase}
            tenantId={props.tenantId}
            initialMode="tidy"
            onBack={() => setDrillEntity(null)}
          />
        ) : (
          <IntakeHealthHome
            supabase={props.supabase}
            tenantId={props.tenantId}
            onEntityClick={(e) => setDrillEntity(e)}
          />
        )
      ) : mode === "ask" ? (
        <AskCanonical
          supabase={props.supabase}
          onEntityClick={(e) => { setDrillEntity(e); setMode("health"); }}
        />
      ) : mode === "reconcile" ? (
        <ReconcileModule
          supabase={props.supabase}
          tenantId={props.tenantId}
        />
      ) : (
        <>
          <h2>Bring a file in</h2>
          <p>
            Drop a SimPRO export — we'll work out what it is, then you choose where
            it goes. One drop, no retyping.
          </p>

          <IntakeDropZone bundle={bundle} />

          <FreeformIntakeInput ai={props.ai} />

          {bundle.slots.length > 0 && (
            <>
              <DestinationPicker
                destId={destId}
                bundle={bundle}
                onChange={(id) => {
                  setDestId(id);
                  onDestinationChange(id, "suggested");
                }}
              />

              {isCanonical ? (
                <CommitView
                  bundle={bundle}
                  supabase={props.supabase}
                  tenantId={props.tenantId ?? DEFAULT_TENANT_ID}
                />
              ) : joinTemplate ? (
                <TemplateExportView bundle={bundle} template={joinTemplate} />
              ) : (
                exportDest && <ExportView bundle={bundle} dest={exportDest} />
              )}

              <button
                type="button"
                onClick={() => bundle.reset()}
                disabled={bundle.busy}
                className="eq-intake-btn-ghost"
              >
                Start over
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}

// ============================================================================
// DESTINATION PICKER — Into EQ + the reshape-out destinations, one list.
// ============================================================================

interface DestOption {
  /** Namespaced ID used as the <select> value (see QUICK_PREFIX/TEMPLATE_PREFIX). */
  id: string;
  label: string;
  description: string;
  /**
   * Roles this destination needs present in the dropped bundle. Empty array =
   * Into EQ (accepts any recognised file). Single-file quick exports need one
   * role; join templates can need several (e.g. customers + contacts + sites).
   */
  needsRoles: RoleName[];
}

const INTO_EQ_OPTION: DestOption = {
  id: INTO_EQ_ID,
  label: "Into EQ",
  description:
    "Save these records into EQ — customers, sites and contacts in one place, so you don't retype them anywhere else.",
  needsRoles: [],
};

/** Single-file reshape-out destinations (one file in, one CSV out — no join). */
const QUICK_OPTIONS: DestOption[] = QUICK_DESTINATIONS.map((d) => ({
  id: `${QUICK_PREFIX}${d.id}`,
  label: d.label,
  description: d.description,
  needsRoles: [d.needsRole],
}));

/**
 * Multi-file JOIN templates from the rollup engine (e.g. Xero ContactsImport
 * that denormalises company info across the customers + contacts files). These
 * only make sense once more than one file is dropped, so they surface here in
 * their own group and stay unavailable until every required role is present.
 */
const TEMPLATE_OPTIONS: DestOption[] = BUILTIN_TEMPLATES.map((t) => ({
  id: `${TEMPLATE_PREFIX}${t.id}`,
  label: t.name,
  description: t.description ?? "",
  needsRoles: t.requiredRoles,
}));

function destAvailable(opt: DestOption, bundle: IntakeBundle): boolean {
  if (opt.needsRoles.length === 0) return bundle.availableRoles.size > 0;
  return opt.needsRoles.every((r) => bundle.availableRoles.has(r));
}

/** Roles a destination still needs that aren't yet in the dropped bundle. */
function missingRoles(opt: DestOption, bundle: IntakeBundle): RoleName[] {
  return opt.needsRoles.filter((r) => !bundle.availableRoles.has(r));
}

function optionSuffix(opt: DestOption, bundle: IntakeBundle): string {
  if (destAvailable(opt, bundle)) return "";
  const missing = missingRoles(opt, bundle);
  if (missing.length === 0) return " — needs a file";
  return ` — needs ${missing.map(roleLabel).join(" + ")}`;
}

const ALL_OPTIONS: DestOption[] = [INTO_EQ_OPTION, ...QUICK_OPTIONS, ...TEMPLATE_OPTIONS];

function DestinationPicker({
  destId,
  bundle,
  onChange,
}: {
  destId: string;
  bundle: IntakeBundle;
  onChange: (id: string) => void;
}): JSX.Element {
  const selected = ALL_OPTIONS.find((o) => o.id === destId) ?? INTO_EQ_OPTION;
  const available = destAvailable(selected, bundle);
  const missing = missingRoles(selected, bundle);

  return (
    <div className="eq-intake-dest-picker">
      <label className="eq-intake-dest-picker__label">
        Where's it going?{" "}
        <select
          value={selected.id}
          onChange={(e) => onChange(e.target.value)}
          className="eq-intake-dest-picker__select"
        >
          <option value={INTO_EQ_OPTION.id}>
            {INTO_EQ_OPTION.label}
            {optionSuffix(INTO_EQ_OPTION, bundle)}
          </option>
          <optgroup label="Send one file out">
            {QUICK_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {optionSuffix(o, bundle)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Join files & send out">
            {TEMPLATE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {optionSuffix(o, bundle)}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <span className="eq-intake-dest-picker__desc">
        {selected.description}
      </span>
      {!available && missing.length > 0 && (
        <span className="eq-intake-dest-picker__warn">
          Drop {missing.map(roleLabel).join(" + ")}{" "}
          {missing.length === 1 ? "file" : "files"} above first.
        </span>
      )}
    </div>
  );
}

// ============================================================================
// EXPORT VIEW — reshape-out preview + download (Xero / MYOB / Outlook / …).
// ============================================================================

function ExportView({
  bundle,
  dest,
}: {
  bundle: IntakeBundle;
  dest: QuickDestination;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<{ filename: string; rowCount: number } | null>(null);

  const matched = bundle.slotForRole(dest.needsRole);

  const previewRows = useMemo((): Record<string, unknown>[] | null => {
    if (!matched?.sheet) return null;
    return (matched.sheet.rows as Record<string, unknown>[]).slice(0, 5).map((r) => {
      const out: Record<string, unknown> = {};
      for (const col of dest.columns) out[col.name] = col.value(r);
      return out;
    });
  }, [matched, dest]);

  const download = () => {
    setError(null);
    if (!matched?.sheet) {
      setError(`This needs a ${roleLabel(dest.needsRole)} file. Drop one above first.`);
      return;
    }
    const headers = dest.columns.map((c) => c.name);
    const rows = matched.sheet.rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const col of dest.columns) out[col.name] = col.value(r as Record<string, unknown>);
      return out;
    });
    const csv = encodeCsv(headers, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = dest.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded({ filename: dest.filename, rowCount: rows.length });
  };

  return (
    <div>
      {previewRows && previewRows.length > 0 && !downloaded && (
        <div className="eq-intake-preview">
          <div className="eq-intake-preview__hint">
            Preview — first {previewRows.length} of{" "}
            {matched!.sheet!.rows.length.toLocaleString()} rows → {dest.label}
          </div>
          <div className="eq-intake-preview__table-wrap">
            <table className="eq-intake-preview__table">
              <thead>
                <tr>
                  {dest.columns.map((c) => (
                    <th key={c.name}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i}>
                    {dest.columns.map((c) => (
                      <td
                        key={c.name}
                        title={String(row[c.name] ?? "")}
                      >
                        {String(row[c.name] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="eq-intake-alert">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={download}
        disabled={!matched}
        className="eq-intake-btn-primary"
      >
        Download {dest.label}
      </button>

      {downloaded && (
        <div className="eq-intake-success">
          ✓ Downloaded <strong>{downloaded.filename}</strong> — {downloaded.rowCount}{" "}
          row{downloaded.rowCount === 1 ? "" : "s"}.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TEMPLATE EXPORT VIEW — multi-file JOIN templates (Xero ContactsImport, the
// quotes-by-site rollup, …). Reuses the rollup engine's renderTemplate /
// renderToCsv — no join logic is reimplemented here. The same dropped files
// feed it as everything else; it just joins them by simPRO Customer ID.
// ============================================================================

function TemplateExportView({
  bundle,
  template,
}: {
  bundle: IntakeBundle;
  template: DestinationTemplate;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<{ filename: string; rowCount: number } | null>(null);

  // Build the role→sheet map the engine wants. We pass EVERY recognised file,
  // not just the required ones, so templates that optionally join extra roles
  // (e.g. Xero's customer template pulling the default contact from a contacts
  // file when present) get the richer output. First file per role wins.
  const byRole = useMemo(() => {
    const map: Partial<Record<RoleName, ParsedSheet>> = {};
    for (const slot of bundle.slots) {
      if (slot.role === "unknown" || !slot.sheet) continue;
      if (!map[slot.role]) map[slot.role] = slot.sheet;
    }
    return map;
  }, [bundle.slots]);

  const missing = template.requiredRoles.filter((r) => !byRole[r]);
  const filename = `${template.id}.csv`;

  const result = useMemo(() => {
    if (missing.length > 0) return null;
    return renderTemplate(template, byRole);
  }, [template, byRole, missing.length]);

  const previewRows = result ? result.rows.slice(0, 5) : null;

  const download = () => {
    setError(null);
    if (!result) {
      setError(
        `This needs ${missing.map(roleLabel).join(" + ")}. Drop the missing file(s) above first.`,
      );
      return;
    }
    const csv = renderToCsv(result);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded({ filename, rowCount: result.rows.length });
  };

  const destLabel = template.destinationLabel ?? "CSV";

  return (
    <div>
      {result && previewRows && previewRows.length > 0 && !downloaded && (
        <div className="eq-intake-preview">
          <div className="eq-intake-preview__hint">
            Preview — first {previewRows.length} of{" "}
            {result.rows.length.toLocaleString()} rows → {destLabel}
          </div>
          <div className="eq-intake-preview__table-wrap">
            <table className="eq-intake-preview__table">
              <thead>
                <tr>
                  {result.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i}>
                    {result.headers.map((h) => (
                      <td
                        key={h}
                        title={row[h] ?? ""}
                      >
                        {row[h] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="eq-intake-alert">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={download}
        disabled={!result}
        className="eq-intake-btn-primary"
      >
        Download {destLabel}
      </button>

      {downloaded && (
        <div className="eq-intake-success">
          ✓ Downloaded <strong>{downloaded.filename}</strong> — {downloaded.rowCount}{" "}
          row{downloaded.rowCount === 1 ? "" : "s"}.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMMIT VIEW — Into EQ (canonical commit). Pre-commit mapping preview, then
// the compact result summary plus flagged/rejected per-row drill-downs.
// ============================================================================

type CommitBundle = {
  customer?: ParsedSheet;
  site?: ParsedSheet;
  contact?: ParsedSheet;
  staff?: ParsedSheet;
  licence?: ParsedSheet;
};

function CommitView({
  bundle,
  supabase,
  tenantId,
}: {
  bundle: IntakeBundle;
  supabase?: SupabaseLikeClient | null;
  tenantId: string;
}): JSX.Element {
  const enabled = !!supabase;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  const commit = async () => {
    if (!supabase) return;
    setError(null);
    setResult(null);

    const commitBundle: CommitBundle = {};
    for (const slot of bundle.slots) {
      if (slot.role === "unknown" || !slot.sheet) continue;
      const key = slot.role as keyof CommitBundle;
      if (commitBundle[key]) {
        setError(`Two files look like ${slot.role}s. Remove one before saving.`);
        return;
      }
      commitBundle[key] = slot.sheet;
    }
    if (
      !commitBundle.customer &&
      !commitBundle.site &&
      !commitBundle.contact &&
      !commitBundle.staff &&
      !commitBundle.licence
    ) {
      setError("Drop at least one file we recognise — a customer, site, contact, staff, or licence list.");
      return;
    }

    setBusy(true);
    setProgressMsg(null);
    try {
      const commitResult = await commitBundleToCanonical({
        supabase,
        bundle: commitBundle,
        tenantId,
        sourceFilename: bundle.slots
          .filter((s) => s.role !== "unknown")
          .map((s) => s.file.name)
          .join("+"),
        onProgress: (msg) => setProgressMsg(msg),
      });
      setResult(commitResult);
      setProgressMsg(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {!enabled && (
        <div className="eq-intake-info-strip">
          EQ isn't connected yet — ask whoever set this up to fill in the
          connection details. Saving stays inactive until then.
        </div>
      )}

      {progressMsg && (
        <div className="eq-intake-progress">
          <span className="eq-spinner__dot" style={{ width: 10, height: 10, flexShrink: 0 }} />
          {progressMsg}
        </div>
      )}

      {error && (
        <div role="alert" className="eq-intake-alert">
          {error}
        </div>
      )}

      {/* Pre-commit: show how the dropped columns line up with EQ fields. */}
      {!result && bundle.slots.some((s) => s.role !== "unknown" && s.sheet) && (
        <MappingPreviewPanel slots={bundle.slots} registry={ROLE_REGISTRY} />
      )}

      <button
        type="button"
        onClick={commit}
        disabled={!enabled || busy}
        className="eq-intake-btn-primary"
      >
        {busy ? (
          <span className="eq-intake-btn-spinner">
            <span className="eq-spinner__dot" style={{ width: 10, height: 10 }} />
            Saving…
          </span>
        ) : (
          "Save into EQ"
        )}
      </button>

      {result && <CommitSummary result={result} />}

      {/* Post-commit: per-row drill-downs for anything that needs eyes. */}
      {result?.perEntity.some((r) => r.flaggedRows.length > 0) && (
        <RowsDisclosure
          label="Show rows that saved but need checking"
          hint="These rows are in EQ, but something caught our eye. Review each one before relying on it."
          accentColor="var(--eq-warn)"
          hintColor="var(--eq-ink)"
          perEntity={result.perEntity.map((r) => ({
            entity: r.entity,
            rows: r.flaggedRows,
          }))}
        />
      )}

      {result?.perEntity.some((r) => r.rejectedRows.length > 0) && (
        <RowsDisclosure
          label="Show rows that couldn't save — and why"
          accentColor="var(--eq-ink)"
          showDownload
          downloadFilename="eq-rejected-rows.csv"
          perEntity={result.perEntity.map((r) => ({
            entity: r.entity,
            rows: r.rejectedRows,
          }))}
        />
      )}
    </div>
  );
}

/**
 * Compact post-save summary — the at-a-glance counts and per-entity chips.
 * The richer per-row UI (flagged / rejected drill-downs via RowsDisclosure,
 * and the pre-commit MappingPreviewPanel) now renders alongside this in
 * CommitView, sharing the components under src/shared/.
 */
function CommitSummary({ result }: { result: CommitResult }): JSX.Element {
  const saved = result.perEntity.reduce((n, r) => n + r.committedCount, 0);
  const flagged = result.perEntity.reduce((n, r) => n + r.flaggedCount, 0);
  const rejected = result.perEntity.reduce((n, r) => n + r.rejectedCount, 0);
  const hasFatal = result.perEntity.some((r) => r.fatalError);

  const status = hasFatal ? "error" : rejected > 0 ? "warn" : "ok";
  const icon = hasFatal ? "✗" : rejected > 0 ? "⚠" : "✓";

  return (
    <div
      role="status"
      aria-live="polite"
      className="eq-intake-summary"
      data-status={status}
    >
      <span className="eq-intake-summary__icon" data-status={status}>{icon}</span>
      <div className="eq-intake-summary__body">
        <span className="eq-intake-summary__saved">
          {saved.toLocaleString()} record{saved === 1 ? "" : "s"} saved
        </span>
        {flagged > 0 && (
          <span className="eq-intake-summary__flagged">
            {flagged.toLocaleString()} need{flagged === 1 ? "s" : ""} checking
          </span>
        )}
        {rejected > 0 && (
          <span className="eq-intake-summary__rejected">
            {rejected.toLocaleString()} couldn't save
          </span>
        )}
      </div>
      {result.perEntity
        .filter((r) => r.committedCount > 0)
        .map((r) => (
          <span
            key={r.entity}
            className="eq-intake-summary__chip"
          >
            {r.committedCount} {entityLabel(r.entity).toLowerCase()}
          </span>
        ))}
    </div>
  );
}
