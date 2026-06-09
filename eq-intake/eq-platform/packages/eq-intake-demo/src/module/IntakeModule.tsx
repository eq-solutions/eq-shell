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
 * Routes log to `eq-intake:routes` in localStorage by default. Host can
 * override via the onDestinationChange prop.
 */

import { useMemo, useState, type JSX } from "react";
import { type ParsedSheet } from "@eq/intake";
import { useIntakeBundle, roleLabel, ROLE_REGISTRY, type IntakeBundle } from "../shared/intake-bundle.js";
import { IntakeDropZone } from "../shared/IntakeDropZone.js";
import { MappingPreviewPanel } from "../shared/MappingPreviewPanel.js";
import { RowsDisclosure } from "../shared/RowsDisclosure.js";
import { entityLabel } from "../shared/entity-label.js";
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

// ---------------------------------------------------------------------------
// Props / constants
// ---------------------------------------------------------------------------
export interface IntakeModuleProps {
  supabase?: SupabaseLikeClient | null;
  tenantId?: string;
  onDestinationChange?: (value: string | undefined, source: "suggested" | "free_text") => void;
}

const INTO_EQ_ID      = "into-eq";
const QUICK_PREFIX    = "quick:";
const TEMPLATE_PREFIX = "tpl:";
const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const ROUTE_LOG_KEY   = "eq-intake:routes";

function defaultRouteLogger(value: string | undefined, source: "suggested" | "free_text"): void {
  if (!value) return;
  try {
    const existing = localStorage.getItem(ROUTE_LOG_KEY);
    const log: Array<{ at: string; destination: string; source: string }> = existing ? JSON.parse(existing) : [];
    log.push({ at: new Date().toISOString(), destination: value, source });
    localStorage.setItem(ROUTE_LOG_KEY, JSON.stringify(log.slice(-200)));
  } catch { /* localStorage full / disabled */ }
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------
export function IntakeModule(props: IntakeModuleProps): JSX.Element {
  const onDestinationChange = useMemo(
    () => props.onDestinationChange ?? defaultRouteLogger,
    [props.onDestinationChange],
  );

  const bundle   = useIntakeBundle();
  const [destId, setDestId] = useState<string>(INTO_EQ_ID);

  const exportDest   = useMemo(() => QUICK_DESTINATIONS.find((d) => `${QUICK_PREFIX}${d.id}` === destId), [destId]);
  const joinTemplate = useMemo(() => BUILTIN_TEMPLATES.find((t) => `${TEMPLATE_PREFIX}${t.id}` === destId), [destId]);
  const isCanonical  = destId === INTO_EQ_ID;

  const hasRecognisedFiles = bundle.slots.some((s) => s.role !== "unknown" && !s.error);

  return (
    <section className="eq-intake-module">
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: "var(--eq-ink)", margin: "0 0 4px" }}>
          Bring a file in
        </h2>
        <p style={{ fontSize: 14, color: "var(--eq-muted)", lineHeight: 1.5, margin: 0 }}>
          Drop a SimPRO export — we'll work out what it is, then you choose where it goes.
          One drop, no retyping.
        </p>
      </div>

      {/* Drop zone */}
      <IntakeDropZone bundle={bundle} />

      {/* Destination + action */}
      {hasRecognisedFiles && (
        <>
          <DestinationPicker
            destId={destId}
            bundle={bundle}
            onChange={(id) => { setDestId(id); onDestinationChange(id, "suggested"); }}
          />

          <div className="eq-intake-action">
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
          </div>

          <div className="eq-intake-footer">
            <button
              type="button"
              onClick={() => bundle.reset()}
              disabled={bundle.busy}
              style={{ fontSize: 13, padding: "6px 12px", color: "var(--eq-muted)", background: "transparent", border: "1px solid var(--eq-line)", borderRadius: 8 }}
            >
              Start over
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ============================================================================
// DESTINATION PICKER — visual pills replacing the old <select>
// ============================================================================

interface DestOption {
  id: string;
  label: string;
  shortLabel?: string;
  description: string;
  needsRoles: RoleName[];
  group: "eq" | "quick" | "join";
}

const INTO_EQ_OPTION: DestOption = {
  id: INTO_EQ_ID,
  label: "Save into EQ",
  shortLabel: "Into EQ",
  description: "Save these records into EQ — customers, sites and contacts in one place.",
  needsRoles: [],
  group: "eq",
};

const QUICK_OPTIONS: DestOption[] = QUICK_DESTINATIONS.map((d) => ({
  id: `${QUICK_PREFIX}${d.id}`,
  label: d.label,
  description: d.description,
  needsRoles: [d.needsRole],
  group: "quick" as const,
}));

const TEMPLATE_OPTIONS: DestOption[] = BUILTIN_TEMPLATES.map((t) => ({
  id: `${TEMPLATE_PREFIX}${t.id}`,
  label: t.name,
  description: t.description ?? "",
  needsRoles: t.requiredRoles,
  group: "join" as const,
}));

const ALL_OPTIONS: DestOption[] = [INTO_EQ_OPTION, ...QUICK_OPTIONS, ...TEMPLATE_OPTIONS];

function destAvailable(opt: DestOption, bundle: IntakeBundle): boolean {
  if (opt.needsRoles.length === 0) return bundle.availableRoles.size > 0;
  return opt.needsRoles.every((r) => bundle.availableRoles.has(r));
}

function missingRoles(opt: DestOption, bundle: IntakeBundle): RoleName[] {
  return opt.needsRoles.filter((r) => !bundle.availableRoles.has(r));
}

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
  const missing  = missingRoles(selected, bundle);

  const quickAvailable   = QUICK_OPTIONS.filter((o) => destAvailable(o, bundle));
  const quickUnavailable = QUICK_OPTIONS.filter((o) => !destAvailable(o, bundle));
  const joinAvailable    = TEMPLATE_OPTIONS.filter((o) => destAvailable(o, bundle));

  return (
    <div className="eq-intake-dest">
      <div className="eq-intake-dest__label">Where's it going?</div>

      {/* Row 1: Into EQ + quick exports */}
      <div className="eq-intake-dest__row">
        <DestPill opt={INTO_EQ_OPTION} isSelected={destId === INTO_EQ_ID} available primary onClick={() => onChange(INTO_EQ_ID)} />

        {(quickAvailable.length > 0 || quickUnavailable.length > 0) && (
          <span className="eq-intake-dest__divider">or export as</span>
        )}

        {quickAvailable.map((o) => (
          <DestPill key={o.id} opt={o} isSelected={destId === o.id} available onClick={() => onChange(o.id)} />
        ))}
        {quickUnavailable.map((o) => (
          <DestPill key={o.id} opt={o} isSelected={false} available={false} onClick={() => {}} />
        ))}
      </div>

      {/* Row 2: Join templates (only if available) */}
      {joinAvailable.length > 0 && (
        <div className="eq-intake-dest__row" style={{ marginTop: 6 }}>
          <span className="eq-intake-dest__divider">or join files for</span>
          {joinAvailable.map((o) => (
            <DestPill key={o.id} opt={o} isSelected={destId === o.id} available onClick={() => onChange(o.id)} />
          ))}
        </div>
      )}

      {/* Description + missing hint */}
      <div className="eq-intake-dest__footer">
        <span className="eq-intake-dest__desc">{selected.description}</span>
        {missing.length > 0 && (
          <span className="eq-intake-dest__missing">
            Drop {missing.map(roleLabel).join(" + ")} file{missing.length > 1 ? "s" : ""} first
          </span>
        )}
      </div>
    </div>
  );
}

function DestPill({
  opt,
  isSelected,
  available,
  primary = false,
  onClick,
}: {
  opt: DestOption;
  isSelected: boolean;
  available: boolean;
  primary?: boolean;
  onClick: () => void;
}): JSX.Element {
  const label = opt.shortLabel ?? opt.label;

  let cls = "eq-dest-pill";
  if (primary)    cls += " eq-dest-pill--primary";
  if (!available) cls += " eq-dest-pill--disabled";

  if (isSelected && primary) cls += " eq-dest-pill--active-primary";
  else if (isSelected)       cls += " eq-dest-pill--active";

  return (
    <button type="button" className={cls} onClick={available ? onClick : undefined}>
      {label}
    </button>
  );
}

// ============================================================================
// PREVIEW TABLE — shared by ExportView + TemplateExportView
// ============================================================================
function PreviewTable({
  headers,
  rows,
  totalRows,
  destLabel,
}: {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
  destLabel: string;
}): JSX.Element {
  return (
    <div className="eq-intake-preview">
      <p className="eq-intake-preview__hint">
        Preview — first {rows.length} of {totalRows.toLocaleString()} rows → {destLabel}
      </p>
      <div className="eq-intake-preview__wrap">
        <table className="eq-intake-preview__table">
          <thead>
            <tr>
              {headers.map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {headers.map((h) => (
                  <td key={h} title={String(row[h] ?? "")}>{String(row[h] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// EXPORT VIEW
// ============================================================================
function ExportView({ bundle, dest }: { bundle: IntakeBundle; dest: QuickDestination }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<{ filename: string; rowCount: number } | null>(null);

  const matched = bundle.slotForRole(dest.needsRole);

  const previewRows = useMemo((): Record<string, string>[] | null => {
    if (!matched?.sheet) return null;
    return (matched.sheet.rows as Record<string, unknown>[]).slice(0, 5).map((r) => {
      const out: Record<string, string> = {};
      for (const col of dest.columns) out[col.name] = String(col.value(r) ?? "");
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
    triggerDownload(csv, dest.filename);
    setDownloaded({ filename: dest.filename, rowCount: rows.length });
  };

  return (
    <div>
      {previewRows && previewRows.length > 0 && !downloaded && (
        <PreviewTable
          headers={dest.columns.map((c) => c.name)}
          rows={previewRows}
          totalRows={matched!.sheet!.rows.length}
          destLabel={dest.label}
        />
      )}
      {error && <Notice kind="err">{error}</Notice>}
      {downloaded
        ? <Notice kind="ok">Downloaded <strong>{downloaded.filename}</strong> — {downloaded.rowCount} row{downloaded.rowCount === 1 ? "" : "s"}.</Notice>
        : <PrimaryButton onClick={download} disabled={!matched}>Download {dest.label}</PrimaryButton>
      }
    </div>
  );
}

// ============================================================================
// TEMPLATE EXPORT VIEW
// ============================================================================
function TemplateExportView({ bundle, template }: { bundle: IntakeBundle; template: DestinationTemplate }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<{ filename: string; rowCount: number } | null>(null);

  const byRole = useMemo(() => {
    const map: Partial<Record<RoleName, ParsedSheet>> = {};
    for (const slot of bundle.slots) {
      if (slot.role === "unknown" || !slot.sheet) continue;
      if (!map[slot.role]) map[slot.role] = slot.sheet;
    }
    return map;
  }, [bundle.slots]);

  const missing  = template.requiredRoles.filter((r) => !byRole[r]);
  const filename = `${template.id}.csv`;
  const result   = useMemo(() => (missing.length > 0 ? null : renderTemplate(template, byRole)), [template, byRole, missing.length]);
  const destLabel = template.destinationLabel ?? "CSV";

  const download = () => {
    setError(null);
    if (!result) { setError(`Needs ${missing.map(roleLabel).join(" + ")}. Drop the missing file(s) above first.`); return; }
    triggerDownload(renderToCsv(result), filename);
    setDownloaded({ filename, rowCount: result.rows.length });
  };

  return (
    <div>
      {result && result.rows.length > 0 && !downloaded && (
        <PreviewTable
          headers={result.headers}
          rows={result.rows.slice(0, 5)}
          totalRows={result.rows.length}
          destLabel={destLabel}
        />
      )}
      {error && <Notice kind="err">{error}</Notice>}
      {downloaded
        ? <Notice kind="ok">Downloaded <strong>{downloaded.filename}</strong> — {downloaded.rowCount} row{downloaded.rowCount === 1 ? "" : "s"}.</Notice>
        : <PrimaryButton onClick={download} disabled={!result}>Download {destLabel}</PrimaryButton>
      }
    </div>
  );
}

// ============================================================================
// COMMIT VIEW
// ============================================================================
type CommitBundle = {
  customer?: ParsedSheet;
  site?: ParsedSheet;
  contact?: ParsedSheet;
  staff?: ParsedSheet;
  licence?: ParsedSheet;
};

function CommitView({ bundle, supabase, tenantId }: { bundle: IntakeBundle; supabase?: SupabaseLikeClient | null; tenantId: string }): JSX.Element {
  const enabled = !!supabase;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  const commit = async () => {
    if (!supabase) return;
    setError(null); setResult(null);

    const cb: CommitBundle = {};
    for (const slot of bundle.slots) {
      if (slot.role === "unknown" || !slot.sheet) continue;
      const key = slot.role as keyof CommitBundle;
      if (cb[key]) { setError(`Two files look like ${slot.role}s. Remove one before saving.`); return; }
      cb[key] = slot.sheet;
    }
    if (!cb.customer && !cb.site && !cb.contact && !cb.staff && !cb.licence) {
      setError("Drop at least one recognised file — customers, sites, contacts, staff, or licences.");
      return;
    }

    setBusy(true); setProgressMsg(null);
    try {
      const r = await commitBundleToCanonical({
        supabase, bundle: cb, tenantId,
        sourceFilename: bundle.slots.filter((s) => s.role !== "unknown").map((s) => s.file.name).join("+"),
        onProgress: (msg) => setProgressMsg(msg),
      });
      setResult(r); setProgressMsg(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {!enabled && (
        <Notice kind="warn">
          EQ isn't connected yet — ask whoever set this up to fill in the connection details. Saving stays inactive until then.
        </Notice>
      )}

      {progressMsg && (
        <div className="eq-intake-progress">
          <span className="eq-intake-spinner eq-intake-spinner--dark" />
          {progressMsg}
        </div>
      )}

      {error && <Notice kind="err">{error}</Notice>}

      {!result && bundle.slots.some((s) => s.role !== "unknown" && s.sheet) && (
        <div style={{ marginBottom: 16 }}>
          <MappingPreviewPanel slots={bundle.slots} registry={ROLE_REGISTRY} />
        </div>
      )}

      {!result && (
        <PrimaryButton onClick={commit} disabled={!enabled || busy} loading={busy}>
          {busy ? "Saving…" : "Save into EQ"}
        </PrimaryButton>
      )}

      {result && <CommitSummary result={result} />}

      {result?.perEntity.some((r) => r.flaggedRows.length > 0) && (
        <RowsDisclosure
          label="Show rows that saved but need checking"
          hint="These rows are in EQ, but something caught our eye."
          accentColor="var(--eq-warn)"
          hintColor="#78350f"
          perEntity={result.perEntity.map((r) => ({ entity: r.entity, rows: r.flaggedRows }))}
        />
      )}
      {result?.perEntity.some((r) => r.rejectedRows.length > 0) && (
        <RowsDisclosure
          label="Show rows that couldn't save — and why"
          accentColor="var(--eq-ink)"
          showDownload
          downloadFilename="eq-rejected-rows.csv"
          perEntity={result.perEntity.map((r) => ({ entity: r.entity, rows: r.rejectedRows }))}
        />
      )}
    </div>
  );
}

function CommitSummary({ result }: { result: CommitResult }): JSX.Element {
  const saved    = result.perEntity.reduce((n, r) => n + r.committedCount, 0);
  const flagged  = result.perEntity.reduce((n, r) => n + r.flaggedCount, 0);
  const rejected = result.perEntity.reduce((n, r) => n + r.rejectedCount, 0);
  const hasFatal = result.perEntity.some((r) => r.fatalError);

  const variant = hasFatal || rejected > 0 ? (hasFatal ? "err" : "warn") : "ok";
  const icon    = hasFatal ? "✗" : rejected > 0 ? "⚠" : "✓";

  return (
    <div className={`eq-commit-result eq-commit-result--${variant}`} role="status" aria-live="polite">
      <div className="eq-commit-result__icon">{icon}</div>
      <div className="eq-commit-result__body">
        <div className="eq-commit-result__title">
          {saved.toLocaleString()} record{saved === 1 ? "" : "s"} saved
        </div>
        {(flagged > 0 || rejected > 0) && (
          <div className="eq-commit-result__sub">
            {flagged  > 0 && <span className="eq-commit-result__sub-warn">{flagged.toLocaleString()} need{flagged === 1 ? "s" : ""} checking</span>}
            {rejected > 0 && <span className="eq-commit-result__sub-err">{rejected.toLocaleString()} couldn't save</span>}
          </div>
        )}
      </div>
      <div className="eq-commit-result__chips">
        {result.perEntity
          .filter((r) => r.committedCount > 0)
          .map((r) => (
            <span key={r.entity} className="eq-commit-result__chip">
              {r.committedCount} {entityLabel(r.entity).toLowerCase()}
            </span>
          ))}
      </div>
    </div>
  );
}

// ============================================================================
// SHARED PRIMITIVES
// ============================================================================
function PrimaryButton({
  onClick,
  disabled = false,
  loading = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className="eq-primary"
      onClick={(!disabled && !loading) ? onClick : undefined}
      disabled={disabled || loading}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, padding: "10px 20px", borderRadius: 8 }}
    >
      {loading && <span className="eq-intake-spinner" />}
      {children}
    </button>
  );
}

function Notice({ kind, children }: { kind: "ok" | "warn" | "err"; children: React.ReactNode }): JSX.Element {
  return (
    <div className={`eq-intake-notice eq-intake-notice--${kind}`} role={kind === "err" ? "alert" : undefined}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function triggerDownload(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
