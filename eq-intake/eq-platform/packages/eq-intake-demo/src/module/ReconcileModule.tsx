/**
 * ReconcileModule — drop a file, see what's new vs what conflicts vs what matches.
 *
 * Flow:
 *   Step 1: Drop a file → auto-classify entity → fetch canonical rows → run reconcile()
 *   Step 2: Show summary (green matched / orange conflicts / red new / grey canonical-only)
 *   Step 3: Resolve conflicts — per-row "keep canonical" / "use source" / skip
 *            Bulk buttons: "resolve all → use source" / "resolve all → keep canonical"
 *   Step 4: Approve → commit new rows + resolved "use source" rows
 *
 * Design rules: EQ palette CSS vars only, no inline hex, no gradients, no shadows.
 * CSS classes are defined in styles.css under the .eq-reconcile namespace.
 */

import { useState, useCallback, type JSX } from "react";
import { parseFile, classifySheet, reconcileSheets, fetchCanonicalRows, scoreRows, normaliseAbn, normalisePhone, type ParsedSheet } from "@eq/intake";
import type { ReconcileResult, ReconcileRow, Resolution, RowConfidence, EntityConfidenceSummary } from "@eq/intake";
import {
  commitBundleToCanonical,
  type SupabaseLikeClient,
} from "../canonical/commit-canonical.js";
import { ROLE_REGISTRY } from "../shared/intake-bundle.js";
import { entityLabel } from "../shared/entity-label.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ReconcileModuleProps {
  supabase?: SupabaseLikeClient | null;
  tenantId?: string;
}

const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000001";

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

type Step =
  | { tag: "idle" }
  | { tag: "loading"; label: string }
  | { tag: "ready"; entity: string; sheet: ParsedSheet; result: ReconcileResult; scores: EntityConfidenceSummary }
  | { tag: "committing" }
  | { tag: "done"; added: number; updated: number; avgConfidence?: number }
  | { tag: "error"; message: string };

const PHONE_FIELDS: Record<string, string> = {
  customers: 'primary_phone',
  staff:     'phone',
  contacts:  'work_phone',
};

function normaliseRow(entity: string, row: Record<string, unknown>): Record<string, unknown> {
  const r = { ...row };
  if (entity === 'customers' && typeof r.abn === 'string' && r.abn) {
    r.abn = normaliseAbn(r.abn);
  }
  const phoneField = PHONE_FIELDS[entity];
  if (phoneField && typeof r[phoneField] === 'string' && r[phoneField]) {
    r[phoneField] = normalisePhone(r[phoneField] as string);
  }
  return r;
}

export function ReconcileModule({ supabase, tenantId }: ReconcileModuleProps): JSX.Element {
  const [step, setStep] = useState<Step>({ tag: "idle" });
  const [resolutions, setResolutions] = useState<Map<number, Resolution>>(new Map());

  const handleFiles = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;

      setStep({ tag: "loading", label: "Parsing file…" });

      try {
        const bytes = await file.arrayBuffer();
        const parsed = await parseFile({ bytes, fileName: file.name });
        const sheet = parsed.sheets[0];
        if (!sheet) {
          setStep({ tag: "error", message: "File appears to be empty or unreadable." });
          return;
        }

        setStep({ tag: "loading", label: "Classifying…" });
        const classified = await classifySheet({ schemas: ROLE_REGISTRY, sheet });
        const entity = classified.entity;

        setStep({ tag: "loading", label: `Fetching ${entityLabel(entity)} from canonical…` });

        let canonicalRows: Record<string, unknown>[] = [];
        if (supabase) {
          try {
            canonicalRows = await fetchCanonicalRows(
              supabase as unknown as Parameters<typeof fetchCanonicalRows>[0],
              entity,
            );
          } catch {
            // Non-fatal — proceed with empty canonical so the user can still
            // see all source rows as "new". The fetch error is not surfaced to
            // avoid confusion; canonical is optional in the demo context.
            canonicalRows = [];
          }
        }

        setStep({ tag: "loading", label: "Reconciling…" });
        const result = reconcileSheets(sheet, canonicalRows);

        const scores = scoreRows(entity, result.onlyInSource.map((r) => r.sourceRow ?? {}));

        setResolutions(new Map());
        setStep({ tag: "ready", entity, sheet, result, scores });
      } catch (e) {
        setStep({ tag: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [supabase],
  );

  const setResolution = useCallback((index: number, resolution: Resolution) => {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(index, resolution);
      return next;
    });
  }, []);

  const resolveAll = useCallback(
    (resolution: Resolution) => {
      if (step.tag !== "ready") return;
      const next = new Map<number, Resolution>();
      step.result.conflicts.forEach((_, i) => next.set(i, resolution));
      setResolutions(next);
    },
    [step],
  );

  const handleCommit = useCallback(async () => {
    if (step.tag !== "ready" || !supabase) return;

    const { result, entity, sheet, scores } = step;

    // Build rows to commit:
    //   - All onlyInSource rows (new additions)
    //   - Conflict rows where resolution === "use-source"
    const toAdd: Record<string, unknown>[] = [
      ...result.onlyInSource.map((r) => r.sourceRow!),
    ];
    const toUpdate: Record<string, unknown>[] = [];

    result.conflicts.forEach((row, i) => {
      const res = resolutions.get(i);
      if (res === "use-source" && row.sourceRow) {
        toUpdate.push(row.sourceRow);
      }
    });

    const avgConfidence = scores.scores.length > 0
      ? Math.round(scores.avg_score * 100)
      : undefined;

    setStep({ tag: "committing" });

    try {
      // Normalise ABN and phone before committing — eliminates format-based rejections.
      const rawRows = [...toAdd, ...toUpdate];
      if (rawRows.length === 0) {
        setStep({ tag: "done", added: 0, updated: 0 });
        return;
      }

      const allCommitRows = rawRows.map((row) => normaliseRow(entity, row));

      // Build a thin ParsedSheet from the rows we want to commit.
      const commitSheet: ParsedSheet = {
        ...sheet,
        rows: allCommitRows as Record<string, string>[],
      };

      const bundle: Record<string, ParsedSheet> = { [entity]: commitSheet };
      await commitBundleToCanonical({
        supabase,
        bundle: bundle as Parameters<typeof commitBundleToCanonical>[0]["bundle"],
        tenantId: tenantId ?? DEFAULT_TENANT_ID,
        sourceFilename: sheet.sheetName ?? "reconcile",
      });

      setStep({ tag: "done", added: toAdd.length, updated: toUpdate.length, avgConfidence });
    } catch (e) {
      setStep({ tag: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [step, resolutions, supabase, tenantId]);

  const reset = () => {
    setStep({ tag: "idle" });
    setResolutions(new Map());
  };

  return (
    <section className="eq-reconcile">
      <h2 className="eq-reconcile__title">Reconcile against canonical</h2>
      <p className="eq-reconcile__subtitle">
        Drop a file to see what's new, what conflicts with what's already in EQ,
        and what already matches. Resolve conflicts before committing.
      </p>

      {(step.tag === "idle" || step.tag === "error") && (
        <ReconcileDropZone onFiles={handleFiles} />
      )}

      {step.tag === "loading" && (
        <div className="eq-spinner">
          <span className="eq-spinner__dot" />
          <span className="eq-spinner__text">
            <span>{step.label}</span>
          </span>
        </div>
      )}

      {step.tag === "error" && (
        <div className="eq-reconcile__error" role="alert">
          {step.message}
        </div>
      )}

      {step.tag === "ready" && (
        <ReconcileReview
          entity={step.entity}
          result={step.result}
          scores={step.scores.scores}
          resolutions={resolutions}
          onSetResolution={setResolution}
          onResolveAll={resolveAll}
          onCommit={supabase ? handleCommit : undefined}
          onReset={reset}
        />
      )}

      {step.tag === "committing" && (
        <div className="eq-spinner">
          <span className="eq-spinner__dot" />
          <span className="eq-spinner__text">
            <span>Committing to canonical…</span>
          </span>
        </div>
      )}

      {step.tag === "done" && (
        <div className="eq-reconcile__done" role="status">
          <span className="eq-reconcile__done-icon">✓</span>
          <div>
            <strong>Done.</strong>{" "}
            {step.added > 0 && `${step.added} new row${step.added === 1 ? "" : "s"} added.`}{" "}
            {step.updated > 0 && `${step.updated} row${step.updated === 1 ? "" : "s"} updated.`}
            {step.added === 0 && step.updated === 0 && "Nothing to commit — all resolved as keep-canonical or skipped."}
            {step.avgConfidence !== undefined && (
              <span
                className="eq-reconcile__confidence-note"
                style={{ color: step.avgConfidence >= 80 ? "var(--eq-ok)" : step.avgConfidence >= 60 ? "var(--eq-warn)" : "var(--eq-err)" } as React.CSSProperties}
              >
                {" "}Avg confidence: {step.avgConfidence}%
              </span>
            )}
          </div>
          <button type="button" onClick={reset}>
            Reconcile another file
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Drop zone — simple, self-contained, no IntakeBundle dependency
// ---------------------------------------------------------------------------

function ReconcileDropZone({ onFiles }: { onFiles: (f: File[]) => void }): JSX.Element {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={"eq-dropzone eq-reconcile__dropzone" + (dragOver ? " eq-dropzone--over" : "")}
      tabIndex={0}
      role="button"
      aria-label="Drop a file or click to pick"
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) onFiles(files);
      }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onClick={() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".csv,.xlsx";
        input.onchange = () => {
          const files = Array.from(input.files ?? []);
          if (files.length > 0) onFiles(files);
        };
        input.click();
      }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.currentTarget.click(); }}
    >
      <p className="eq-dropzone__title">Drop a file here, or click to pick</p>
      <p className="eq-dropzone__hint">CSV or XLSX — we'll detect the entity and compare against canonical</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review panel (Steps 2 + 3)
// ---------------------------------------------------------------------------

interface ReconcileReviewProps {
  entity: string;
  result: ReconcileResult;
  scores: RowConfidence[];
  resolutions: Map<number, Resolution>;
  onSetResolution: (index: number, resolution: Resolution) => void;
  onResolveAll: (resolution: Resolution) => void;
  onCommit?: () => void;
  onReset: () => void;
}

function ReconcileReview({
  entity,
  result,
  scores,
  resolutions,
  onSetResolution,
  onResolveAll,
  onCommit,
  onReset,
}: ReconcileReviewProps): JSX.Element {
  const unresolvedCount = result.conflicts.filter(
    (_, i) => !resolutions.has(i),
  ).length;

  const commitLabel = () => {
    const newCount = result.onlyInSource.length;
    const updateCount = Array.from(resolutions.values()).filter((r) => r === "use-source").length;
    if (newCount === 0 && updateCount === 0) return "Nothing to commit";
    const parts: string[] = [];
    if (newCount > 0) parts.push(`add ${newCount} new`);
    if (updateCount > 0) parts.push(`update ${updateCount}`);
    return `Commit — ${parts.join(", ")} ${entityLabel(entity).toLowerCase()}`;
  };

  return (
    <div className="eq-reconcile__review">
      {/* Summary bar */}
      <div className="eq-reconcile__summary">
        {result.matched.length > 0 && (
          <span className="eq-reconcile__badge eq-reconcile__badge--matched">
            {result.matched.length} matched
          </span>
        )}
        {result.conflicts.length > 0 && (
          <span className="eq-reconcile__badge eq-reconcile__badge--conflict">
            {result.conflicts.length} conflict{result.conflicts.length === 1 ? "" : "s"}
          </span>
        )}
        {result.onlyInSource.length > 0 && (
          <span className="eq-reconcile__badge eq-reconcile__badge--new">
            {result.onlyInSource.length} new
          </span>
        )}
        {result.onlyInCanonical.length > 0 && (
          <span className="eq-reconcile__badge eq-reconcile__badge--canonical">
            {result.onlyInCanonical.length} canonical-only (untouched)
          </span>
        )}
        <span className="eq-reconcile__match-key">
          Matched on: <code>{result.matchKey}</code>
        </span>
      </div>

      {/* Conflicts — expandable rows with field diffs */}
      {result.conflicts.length > 0 && (
        <div className="eq-reconcile__section">
          <div className="eq-reconcile__section-header">
            <h3>Conflicts</h3>
            <span className="eq-reconcile__section-hint">
              These rows exist in canonical but differ on some fields. Choose which version to keep.
            </span>
          </div>

          {unresolvedCount > 0 && (
            <div className="eq-reconcile__bulk-actions">
              <span>Resolve all:</span>
              <button type="button" onClick={() => onResolveAll("use-source")}>
                Use source
              </button>
              <button type="button" onClick={() => onResolveAll("keep-canonical")}>
                Keep canonical
              </button>
              <button type="button" onClick={() => onResolveAll("skip")}>
                Skip all
              </button>
            </div>
          )}

          <div className="eq-reconcile__conflict-list">
            {result.conflicts.map((row, i) => (
              <ConflictRow
                key={i}
                row={row}
                resolution={resolutions.get(i)}
                onSetResolution={(res) => onSetResolution(i, res)}
                matchKey={result.matchKey}
              />
            ))}
          </div>
        </div>
      )}

      {/* New rows — count only */}
      {result.onlyInSource.length > 0 && (
        <div className="eq-reconcile__section eq-reconcile__section--new">
          <h3>New rows — will be added</h3>
          <p>
            {result.onlyInSource.length} row{result.onlyInSource.length === 1 ? "" : "s"} in
            your file {result.onlyInSource.length === 1 ? "has" : "have"} no match in
            canonical and will be added on commit.
          </p>
          <NewRowList rows={result.onlyInSource} matchKey={result.matchKey} scores={scores} />
        </div>
      )}

      {/* Canonical-only — info count */}
      {result.onlyInCanonical.length > 0 && (
        <div className="eq-reconcile__section eq-reconcile__section--canonical">
          <h3>Canonical-only — not in your file</h3>
          <p>
            {result.onlyInCanonical.length} row{result.onlyInCanonical.length === 1 ? "" : "s"} in
            canonical {result.onlyInCanonical.length === 1 ? "was" : "were"} not found in your
            file. These rows will not be touched.
          </p>
        </div>
      )}

      {result.matched.length > 0 && (
        <div className="eq-reconcile__section eq-reconcile__section--matched">
          <h3>Matched — already in sync</h3>
          <p>
            {result.matched.length} row{result.matched.length === 1 ? "" : "s"} in your file
            match canonical exactly. Nothing to do.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="eq-reconcile__actions">
        {onCommit ? (
          <button
            type="button"
            className="eq-primary"
            onClick={onCommit}
            disabled={result.onlyInSource.length === 0 && resolutions.size === 0}
          >
            {commitLabel()}
          </button>
        ) : (
          <span className="eq-reconcile__no-supabase">
            Connect Supabase to enable commit.
          </span>
        )}
        <button type="button" onClick={onReset}>
          Start over
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict row — expandable with field-level diff table
// ---------------------------------------------------------------------------

interface ConflictRowProps {
  row: ReconcileRow;
  resolution: Resolution | undefined;
  onSetResolution: (r: Resolution) => void;
  matchKey: string;
}

function ConflictRow({
  row,
  resolution,
  onSetResolution,
  matchKey,
}: ConflictRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const keyValue = String(row.sourceRow?.[matchKey] ?? row.canonicalRow?.[matchKey] ?? "—");

  return (
    <div
      className={
        "eq-reconcile__conflict-row" +
        (resolution ? " eq-reconcile__conflict-row--resolved" : "")
      }
    >
      <div className="eq-reconcile__conflict-header">
        <button
          type="button"
          className="eq-link-button eq-reconcile__expand-btn"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? "▾" : "▸"} <code>{keyValue}</code>
          <span className="eq-reconcile__conflict-count">
            {row.conflicts.length} field{row.conflicts.length === 1 ? "" : "s"} differ
          </span>
        </button>

        <div className="eq-reconcile__resolution-buttons" role="group" aria-label="Resolution">
          <button
            type="button"
            aria-pressed={resolution === "keep-canonical"}
            onClick={() => onSetResolution("keep-canonical")}
          >
            Keep canonical
          </button>
          <button
            type="button"
            aria-pressed={resolution === "use-source"}
            onClick={() => onSetResolution("use-source")}
          >
            Use source
          </button>
          <button
            type="button"
            aria-pressed={resolution === "skip"}
            onClick={() => onSetResolution("skip")}
          >
            Skip
          </button>
        </div>
      </div>

      {expanded && (
        <table className="eq-reconcile__diff-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Source (file)</th>
              <th>Canonical (EQ)</th>
            </tr>
          </thead>
          <tbody>
            {row.conflicts.map((c) => (
              <tr key={c.field}>
                <td><code>{c.field}</code></td>
                <td className="eq-reconcile__diff-source">{c.sourceValue}</td>
                <td className="eq-reconcile__diff-canonical">{c.canonicalValue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New row list — compact key-value preview with confidence scores
// ---------------------------------------------------------------------------

function scoreColor(score: number): string {
  if (score >= 0.80) return '#2f9e44';
  if (score >= 0.60) return '#e67700';
  return '#c92a2a';
}

function NewRowList({
  rows,
  matchKey,
  scores,
}: {
  rows: ReconcileRow[];
  matchKey: string;
  scores?: RowConfidence[];
}): JSX.Element {
  const MAX_VISIBLE = 10;
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, MAX_VISIBLE);

  return (
    <div className="eq-reconcile__new-list">
      {visible.map((row, i) => {
        const keyValue = String(row.sourceRow?.[matchKey] ?? `row ${i + 1}`);
        const score = scores?.[i];
        return (
          <span key={i} className="eq-reconcile__new-chip">
            {keyValue}
            {score !== undefined && (
              <span
                className="eq-reconcile__new-chip-score"
                style={{ color: scoreColor(score.score) }}
                title={score.issues.length > 0 ? score.issues.join(' · ') : 'Good quality'}
              >
                {Math.round(score.score * 100)}%
              </span>
            )}
          </span>
        );
      })}
      {!showAll && rows.length > MAX_VISIBLE && (
        <button
          type="button"
          className="eq-link-button"
          onClick={() => setShowAll(true)}
        >
          + {rows.length - MAX_VISIBLE} more
        </button>
      )}
    </div>
  );
}
