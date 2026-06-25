import { useState, useEffect, useCallback, useMemo, type JSX } from "react";
import {
  fetchCanonicalRows,
  runTidyPass,
  commitTidyFixes,
  suggestGaps,
} from "@eq/intake";
import type {
  CanonicalFetchClient,
  TidyFix,
  GapItem,
  ReviewFlag,
  TidyReport,
  TidyCommitResult,
  TidyEntity,
  GapSuggestResult,
  GapSuggestion,
  EdgeFnCaller,
} from "@eq/intake";
import type { SupabaseLikeClient } from "../canonical/commit-canonical.js";
import { fieldLabel } from "../shared/entity-label.js";
import { Table, type TableColumn } from "@eq-solutions/ui/Table";

export interface EntityDrillDownProps {
  entity: string;
  /** Full Supabase client — used for row fetching, tidy pass, and fix commits. */
  supabase?: SupabaseLikeClient | null;
  tenantId?: string;
  /** Which filter tab to open on mount. Defaults to "all". */
  initialMode?: FilterMode;
  onBack?: () => void;
  onBulkFix?: (csvBlob: Blob, filename: string) => void;
}

type Row = Record<string, unknown>;
type DrillRow = Row & { _dupeField?: string; _dupeKey?: string };
type FilterMode = "all" | "gaps" | "duplicates" | "tidy";

const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000001";

const GAP_FIELDS: Record<string, string[]> = {
  staff: ["email", "phone"],
  sites: ["address", "suburb", "state", "postcode"],
  contacts: ["email", "phone"],
  customers: ["email", "phone", "abn"],
  assets: ["asset_type", "serial_number", "site_id"],
  licences: ["expiry_date", "licence_number", "licence_type"],
};

const DUPE_KEYS: Record<string, string[]> = {
  staff: ["email"],
  sites: ["site_name"],
  contacts: ["email"],
  customers: ["abn", "company_name"],
  assets: ["serial_number"],
  // licences: licence_number legitimately repeats across different staff/states
};

// Entity string used in the UI → TidyEntity used by the tidy pass engine.
const ENTITY_TO_TIDY: Partial<Record<string, TidyEntity>> = {
  customers: "customer",
  sites: "site",
  contacts: "contact",
  staff: "staff",
  assets: "asset",
  licences: "licence",
};

const DISPLAY_COLUMNS: Record<string, string[]> = {
  staff: ["first_name", "last_name", "email", "phone"],
  sites: ["site_name", "address", "suburb", "state", "postcode"],
  contacts: ["full_name", "email", "phone"],
  customers: ["company_name", "email", "phone", "abn"],
  assets: ["asset_name", "asset_type", "serial_number"],
  licences: ["licence_number", "licence_type", "expiry_date", "staff_id"],
};


function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

function rowHasGap(row: Row, gapFields: string[]): boolean {
  return gapFields.some((f) => isBlank(row[f]));
}

function formatLabel(entity: string): string {
  return entity.charAt(0).toUpperCase() + entity.slice(1);
}

function buildCsvContent(rows: Row[], columns: string[]): string {
  const header = columns.map((c) => `"${fieldLabel(c)}"`).join(",");
  const body = rows.map((row) =>
    columns
      .map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      })
      .join(","),
  );
  return [header, ...body].join("\r\n");
}

function todayString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

interface EditState {
  rowId: string;
  field: string;
}

// ── Main component ────────────────────────────────────────────────────────────

export function EntityDrillDown({
  entity,
  supabase,
  tenantId,
  initialMode,
  onBack,
  onBulkFix,
}: EntityDrillDownProps): JSX.Element {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Honour initialMode only if the entity supports that mode (e.g. "tidy"
  // needs a tidy entity mapping; fall back to "all" if not).
  const resolvedInitialMode: FilterMode =
    initialMode === "tidy" && !ENTITY_TO_TIDY[entity]
      ? "all"
      : (initialMode ?? "all");

  const [filterMode, setFilterMode] = useState<FilterMode>(resolvedInitialMode);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [hasLocalEdits, setHasLocalEdits] = useState(false);

  // Tidy pass state
  const [tidyReport, setTidyReport] = useState<TidyReport | null>(null);
  const [tidyLoading, setTidyLoading] = useState(false);
  const [tidyError, setTidyError] = useState<string | null>(null);
  const [tidyProgress, setTidyProgress] = useState("");
  const [selectedFixKeys, setSelectedFixKeys] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<TidyCommitResult | null>(null);

  // Gap suggestion state
  const [suggestRowId, setSuggestRowId] = useState<string | null>(null);
  const [suggestRowLabel, setSuggestRowLabel] = useState("");
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestResult, setSuggestResult] = useState<GapSuggestResult | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const gapFields = GAP_FIELDS[entity] ?? [];
  const displayColumns = DISPLAY_COLUMNS[entity] ?? [];
  const dupeKeys = DUPE_KEYS[entity] ?? [];
  const tidyEntity = ENTITY_TO_TIDY[entity] ?? null;
  const resolvedTenantId = tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantId) {
    // eslint-disable-next-line no-console
    console.warn("[EntityDrillDown] tenantId prop not provided — tidy-pass and fix-commits will use the fixture tenant.");
  }

  // ── Fetch canonical rows ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      if (!supabase) {
        setLoading(false);
        setError("No database connection available.");
        return;
      }

      try {
        const data = await fetchCanonicalRows(supabase as unknown as CanonicalFetchClient, entity);
        if (!cancelled) setRows(data);
      } catch (err: unknown) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load records.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [entity, supabase, refreshCounter]);

  // ── Tidy pass ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (filterMode !== "tidy" || !supabase || !tidyEntity) return;

    let cancelled = false;
    setTidyLoading(true);
    setTidyError(null);
    setTidyReport(null);
    setSelectedFixKeys(new Set());
    setCommitResult(null);
    setTidyProgress("Scanning records…");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runTidyPass({
      supabase: supabase as any,
      tenantId: resolvedTenantId,
      entities: [tidyEntity],
      onProgress: (msg) => {
        if (!cancelled) setTidyProgress(msg);
      },
    })
      .then((report) => {
        if (cancelled) return;
        setTidyReport(report);
        // Pre-select all auto-fixes
        setSelectedFixKeys(
          new Set(report.auto_fixes.map((f) => `${f.row_id}:${f.field}`)),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setTidyError(err instanceof Error ? err.message : "Tidy pass failed.");
      })
      .finally(() => {
        if (!cancelled) setTidyLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filterMode, supabase, tidyEntity, resolvedTenantId]);

  // Reset tidy state when leaving tidy mode
  useEffect(() => {
    if (filterMode !== "tidy") {
      setTidyReport(null);
      setTidyError(null);
      setCommitResult(null);
    }
  }, [filterMode]);

  // ── Duplicate detection ────────────────────────────────────────────────
  const duplicateRows = useMemo<DrillRow[]>(() => {
    if (dupeKeys.length === 0) return [];

    const allGroups: DrillRow[][] = [];

    for (const keyField of dupeKeys) {
      const seenIds = new Set<string>();
      const byValue = new Map<string, Row[]>();
      for (const row of rows) {
        const val = row[keyField];
        if (val === null || val === undefined || String(val).trim() === "") continue;
        const normalized = String(val).trim().toLowerCase();
        if (!byValue.has(normalized)) byValue.set(normalized, []);
        byValue.get(normalized)!.push(row);
      }
      for (const group of byValue.values()) {
        if (group.length < 2) continue;
        const fresh = group.filter((r) => !seenIds.has(String(r.id ?? "")));
        if (fresh.length < 2) continue;
        fresh.forEach((r) => seenIds.add(String(r.id ?? "")));
        allGroups.push(
          fresh.map((r) => ({
            ...r,
            _dupeField: keyField,
            _dupeKey: String(r[keyField]),
          })),
        );
      }
    }

    return allGroups.flat();
  }, [rows, dupeKeys]);

  const dupeGroupIndex = useMemo<Map<string, number>>(() => {
    if (filterMode !== "duplicates") return new Map();
    const m = new Map<string, number>();
    let idx = 0;
    for (const row of duplicateRows) {
      const key = `${row._dupeField}:${row._dupeKey}`;
      if (!m.has(key)) m.set(key, idx++);
    }
    return m;
  }, [duplicateRows, filterMode]);

  const displayRows = useMemo<DrillRow[]>(() => {
    if (filterMode === "gaps") return rows.filter((r) => rowHasGap(r, gapFields));
    if (filterMode === "duplicates") return duplicateRows;
    return rows;
  }, [rows, filterMode, gapFields, duplicateRows]);

  const gapCount = useMemo(
    () => rows.filter((r) => rowHasGap(r, gapFields)).length,
    [rows, gapFields],
  );
  const totalCount = rows.length;
  const dupeCount = duplicateRows.length;

  // ── Edit handlers (by row ID) ──────────────────────────────────────────
  const startEdit = useCallback(
    (rowId: string, field: string) => {
      const targetRow = rows.find((r) => String(r.id ?? "") === rowId);
      const current = targetRow?.[field];
      setEditState({ rowId, field });
      setEditDraft(current === null || current === undefined ? "" : String(current));
    },
    [rows],
  );

  const commitEdit = useCallback(() => {
    if (!editState) return;
    const { rowId, field } = editState;
    setRows((prev) =>
      prev.map((r) =>
        String(r.id ?? "") === rowId ? { ...r, [field]: editDraft } : r,
      ),
    );
    setHasLocalEdits(true);
    setEditState(null);
    setEditDraft("");
  }, [editState, editDraft]);

  const cancelEdit = useCallback(() => {
    setEditState(null);
    setEditDraft("");
  }, []);

  // ── Tidy fix commit ────────────────────────────────────────────────────
  const handleApplyFixes = useCallback(async () => {
    if (!supabase || !tidyReport || selectedFixKeys.size === 0 || committing) return;

    const fixes = tidyReport.auto_fixes.filter((f) =>
      selectedFixKeys.has(`${f.row_id}:${f.field}`),
    );

    setCommitting(true);
    setCommitResult(null);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await commitTidyFixes({
        supabase: supabase as any,
        tenantId: resolvedTenantId,
        fixes,
      });
      setCommitResult(result);
      if (result.applied > 0) {
        // Refresh main rows and re-run tidy on next entry
        setRefreshCounter((c) => c + 1);
        setTidyReport(null);
      }
    } catch (err: unknown) {
      setTidyError(err instanceof Error ? err.message : "Failed to apply fixes.");
    } finally {
      setCommitting(false);
    }
  }, [supabase, tidyReport, selectedFixKeys, committing, resolvedTenantId]);

  // ── Gap suggestions ───────────────────────────────────────────────────
  const callEdgeFn = useMemo<EdgeFnCaller | null>(() => {
    if (!supabase) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    return (action: string, payload: Record<string, unknown>) =>
      sb.functions.invoke('eq-ai-assist', { body: { action, ...payload } }) as Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
  }, [supabase]);

  const handleSuggest = useCallback(
    async (row: Row) => {
      if (!callEdgeFn) return;
      const rowId = String(row.id ?? '');
      const missingFields = gapFields.filter((f) => isBlank(row[f]));
      if (missingFields.length === 0) return;

      const label = String(
        row['company_name'] ?? row['first_name'] ?? row['site_name'] ??
        row['asset_name'] ?? row['licence_number'] ?? rowId
      );

      setSuggestRowId(rowId);
      setSuggestRowLabel(label);
      setSuggestLoading(true);
      setSuggestResult(null);
      setSuggestError(null);

      try {
        const result = await suggestGaps(entity, row, missingFields, callEdgeFn);
        setSuggestResult(result);
      } catch (err: unknown) {
        setSuggestError(err instanceof Error ? err.message : String(err));
      } finally {
        setSuggestLoading(false);
      }
    },
    [callEdgeFn, entity, gapFields],
  );

  const acceptSuggestion = useCallback(
    (field: string, value: string) => {
      if (!suggestRowId) return;
      setRows((prev) =>
        prev.map((r) => String(r.id ?? '') === suggestRowId ? { ...r, [field]: value } : r),
      );
      setHasLocalEdits(true);
    },
    [suggestRowId],
  );

  // ── Column definitions ────────────────────────────────────────────────
  const columns = useMemo<TableColumn<DrillRow>[]>(() => {
    const cols: TableColumn<DrillRow>[] = displayColumns.map((col) => {
      const isGapField = gapFields.includes(col);
      return {
        key: col,
        header: fieldLabel(col),
        sortAccessor: (row: DrillRow) => {
          const v = row[col];
          return typeof v === "string" || typeof v === "number" ? v : null;
        },
        filterable: "text" as const,
        render: (row: DrillRow) => {
          const rowId = String(row.id ?? "");
          const isEditing = editState?.rowId === rowId && editState?.field === col;
          const blank = isGapField && isBlank(row[col]);

          if (isEditing) {
            return (
              <span className="eq-drill__inline-edit">
                <input
                  className="eq-drill__inline-input"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  autoFocus
                  aria-label={`Edit ${fieldLabel(col)}`}
                />
                <button className="eq-drill__inline-save" onClick={commitEdit} type="button">
                  Save
                </button>
                <button className="eq-drill__inline-cancel" onClick={cancelEdit} type="button">
                  Cancel
                </button>
              </span>
            );
          }

          const cellClass = [
            "eq-drill__cell-value",
            blank ? "eq-drill__cell-value--gap" : "",
            isGapField && !blank ? "eq-drill__cell-value--filled" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <span
              className={cellClass}
              onClick={
                isGapField && !isEditing
                  ? (e) => {
                      e.stopPropagation();
                      startEdit(rowId, col);
                    }
                  : undefined
              }
              title={isGapField && !isEditing ? "Click to edit" : undefined}
            >
              {isBlank(row[col]) ? (
                <span className="eq-drill__cell-empty">—</span>
              ) : (
                String(row[col])
              )}
            </span>
          );
        },
      };
    });

    if (filterMode === "duplicates") {
      cols.push({
        key: "_dupeKey",
        header: "Matched on",
        // no sortAccessor = not sortable
        render: (row: DrillRow) =>
          row._dupeField ? (
            <span className="eq-drill__dupe-badge">
              {fieldLabel(row._dupeField)}
            </span>
          ) : null,
      });
    }

    if (filterMode === "gaps" && callEdgeFn) {
      cols.push({
        key: "_suggest",
        header: "Suggest",
        render: (row: DrillRow) => {
          const missing = gapFields.filter((f) => isBlank(row[f]));
          if (missing.length === 0) return null;
          return (
            <button
              type="button"
              className="eq-drill__suggest-btn"
              onClick={(e) => { e.stopPropagation(); handleSuggest(row); }}
            >
              Suggest
            </button>
          );
        },
      });
    }

    return cols;
  }, [
    displayColumns,
    gapFields,
    filterMode,
    editState,
    editDraft,
    commitEdit,
    cancelEdit,
    startEdit,
    callEdgeFn,
    handleSuggest,
  ]);

  // ── CSV download ──────────────────────────────────────────────────────
  const handleDownloadCsv = useCallback(() => {
    const csv = buildCsvContent(displayRows, displayColumns);
    const suffix =
      filterMode === "gaps"
        ? "-gaps"
        : filterMode === "duplicates"
          ? "-dupes"
          : "";
    const filename = `${entity}${suffix}-${todayString()}.csv`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

    if (onBulkFix) {
      onBulkFix(blob, filename);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }, [displayRows, displayColumns, entity, filterMode, onBulkFix]);

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="eq-drill">
        <Table<DrillRow>
          columns={displayColumns.map((col) => ({
            key: col,
            header: fieldLabel(col),
          }))}
          rows={[]}
          loading={true}
          loadingRows={8}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="eq-drill">
        {onBack && (
          <button className="eq-drill__back" onClick={onBack} type="button">
            ← Back
          </button>
        )}
        <div className="eq-drill__error" role="alert">
          <strong>Error:</strong> {error}
        </div>
      </div>
    );
  }

  const emptyMsg =
    filterMode === "gaps"
      ? `No gaps found — all ${formatLabel(entity).toLowerCase()} records are complete.`
      : filterMode === "duplicates"
        ? `No duplicates detected in ${formatLabel(entity).toLowerCase()}.`
        : `No ${entity} records found — import some via the Import tab.`;

  return (
    <div className="eq-drill">
      <div className="eq-drill__header">
        <div className="eq-drill__header-left">
          {onBack && (
            <button className="eq-drill__back" onClick={onBack} type="button">
              ← Back
            </button>
          )}
          <h2 className="eq-drill__title">
            {formatLabel(entity)} — {totalCount.toLocaleString()} record
            {totalCount !== 1 ? "s" : ""}
            {gapCount > 0 && (
              <span className="eq-drill__gap-badge">{gapCount} with gaps</span>
            )}
            {dupeCount > 0 && (
              <span className="eq-drill__dupe-count-badge">
                {dupeCount} possible dupes
              </span>
            )}
          </h2>
        </div>
        <div className="eq-drill__actions">
          <div className="eq-drill__filter" role="group" aria-label="Filter rows">
            <button
              className={`eq-drill__filter-btn${filterMode === "all" ? " eq-drill__filter-btn--active" : ""}`}
              onClick={() => setFilterMode("all")}
              type="button"
              aria-pressed={filterMode === "all"}
            >
              All
            </button>
            <button
              className={`eq-drill__filter-btn${filterMode === "gaps" ? " eq-drill__filter-btn--active" : ""}`}
              onClick={() => setFilterMode("gaps")}
              type="button"
              aria-pressed={filterMode === "gaps"}
            >
              Gaps
            </button>
            {dupeKeys.length > 0 && (
              <button
                className={`eq-drill__filter-btn${filterMode === "duplicates" ? " eq-drill__filter-btn--active" : ""}`}
                onClick={() => setFilterMode("duplicates")}
                type="button"
                aria-pressed={filterMode === "duplicates"}
              >
                Dupes{dupeCount > 0 ? ` (${dupeCount})` : ""}
              </button>
            )}
            {tidyEntity && (
              <button
                className={`eq-drill__filter-btn${filterMode === "tidy" ? " eq-drill__filter-btn--active" : ""}`}
                onClick={() => setFilterMode("tidy")}
                type="button"
                aria-pressed={filterMode === "tidy"}
              >
                Tidy
              </button>
            )}
          </div>
          {filterMode !== "tidy" && (
            <button
              className="eq-drill__download"
              onClick={handleDownloadCsv}
              type="button"
              disabled={displayRows.length === 0}
            >
              Download CSV
            </button>
          )}
        </div>
      </div>

      {hasLocalEdits && filterMode !== "tidy" && (
        <div className="eq-drill__edit-notice" role="status">
          Changes are local only — use Download to export and re-import via Reconcile.
        </div>
      )}

      {filterMode === "tidy" ? (
        <TidyPanel
          loading={tidyLoading}
          progress={tidyProgress}
          error={tidyError}
          report={tidyReport}
          selectedFixKeys={selectedFixKeys}
          onSelectionChange={setSelectedFixKeys}
          onApply={handleApplyFixes}
          committing={committing}
          commitResult={commitResult}
          entityLabel={formatLabel(entity)}
        />
      ) : (
        <Table<DrillRow>
          columns={columns}
          rows={displayRows}
          getRowId={(row) => {
            const id = row["id"];
            return id !== null && id !== undefined ? String(id) : "";
          }}
          emptyMessage={emptyMsg}
          rowStyle={
            filterMode === "duplicates"
              ? (row) => {
                  const key = `${row._dupeField}:${row._dupeKey}`;
                  const idx = dupeGroupIndex.get(key) ?? 0;
                  return idx % 2 === 1
                    ? { backgroundColor: "var(--eq-ice)" }
                    : undefined;
                }
              : undefined
          }
          className="eq-drill__data-table"
        />
      )}

      {suggestRowId && (
        <SuggestPanel
          rowLabel={suggestRowLabel}
          loading={suggestLoading}
          result={suggestResult}
          error={suggestError}
          onAccept={acceptSuggestion}
          onClose={() => { setSuggestRowId(null); setSuggestResult(null); setSuggestError(null); }}
        />
      )}
    </div>
  );
}

// ── TidyPanel ─────────────────────────────────────────────────────────────────

interface TidyPanelProps {
  loading: boolean;
  progress: string;
  error: string | null;
  report: TidyReport | null;
  selectedFixKeys: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onApply: () => void;
  committing: boolean;
  commitResult: TidyCommitResult | null;
  entityLabel: string;
}

const FIX_TYPE_LABELS: Record<string, string> = {
  phone: "Phone",
  au_state: "State",
  email: "Email",
  abn: "ABN",
  date: "Date",
  string: "Text",
  boolean: "Boolean",
  other: "Other",
};

const GAP_TYPE_LABELS: Record<string, string> = {
  required_missing: "Missing",
  format_invalid: "Invalid format",
  fk_no_match: "Broken link",
};

const FLAG_TYPE_LABELS: Record<string, string> = {
  phone_kept_raw: "Phone kept raw",
  date_ambiguous: "Date ambiguous",
  value_unusual: "Unusual value",
  cross_field_warning: "Cross-field",
};

function TidyPanel({
  loading,
  progress,
  error,
  report,
  selectedFixKeys,
  onSelectionChange,
  onApply,
  committing,
  commitResult,
  entityLabel,
}: TidyPanelProps): JSX.Element {
  if (loading) {
    return (
      <div className="eq-tidy">
        <div className="eq-tidy__loading">
          <span className="eq-health-spinner" aria-hidden="true" />
          <span>{progress || "Scanning…"}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="eq-tidy">
        <div className="eq-drill__error" role="alert">
          <strong>Tidy pass error:</strong> {error}
        </div>
      </div>
    );
  }

  if (!report) return <div className="eq-tidy" />;

  const { auto_fixes, gaps, review_flags, summary } = report;

  const fixColumns: TableColumn<TidyFix>[] = [
    {
      key: "row_label",
      header: "Record",
      sortAccessor: (f) => f.row_label,
      filterable: "text",
    },
    {
      key: "field",
      header: "Field",
      sortAccessor: (f) => f.field,
    },
    {
      key: "old_value",
      header: "Current",
      render: (f) => <span className="eq-tidy__old-value">{f.old_value}</span>,
    },
    {
      key: "new_value",
      header: "Normalised",
      render: (f) => <span className="eq-tidy__new-value">{f.new_value}</span>,
    },
    {
      key: "fix_type",
      header: "Type",
      sortable: false,
      render: (f) => (
        <span className="eq-tidy__fix-badge">
          {FIX_TYPE_LABELS[f.fix_type] ?? f.fix_type}
        </span>
      ),
    },
  ];

  const gapColumns: TableColumn<GapItem>[] = [
    {
      key: "row_label",
      header: "Record",
      sortAccessor: (g) => g.row_label,
      filterable: "text",
    },
    {
      key: "field",
      header: "Field",
      sortAccessor: (g) => g.field,
    },
    {
      key: "message",
      header: "Issue",
      render: (g) => <span>{g.message}</span>,
    },
    {
      key: "gap_type",
      header: "Type",
      sortable: false,
      render: (g) => (
        <span className={`eq-tidy__gap-badge eq-tidy__gap-badge--${g.gap_type}`}>
          {GAP_TYPE_LABELS[g.gap_type] ?? g.gap_type}
        </span>
      ),
    },
  ];

  const flagColumns: TableColumn<ReviewFlag>[] = [
    {
      key: "row_label",
      header: "Record",
      sortAccessor: (r) => r.row_label,
      filterable: "text",
    },
    {
      key: "field",
      header: "Field",
      sortAccessor: (r) => r.field,
    },
    {
      key: "message",
      header: "Note",
      render: (r) => <span>{r.message}</span>,
    },
    {
      key: "flag_type",
      header: "Flag",
      sortable: false,
      render: (r) => (
        <span className="eq-tidy__flag-badge">
          {FLAG_TYPE_LABELS[r.flag_type] ?? r.flag_type}
        </span>
      ),
    },
  ];

  const allClean =
    auto_fixes.length === 0 && gaps.length === 0 && review_flags.length === 0;

  return (
    <div className="eq-tidy">
      {/* Summary strip */}
      <div className="eq-tidy__summary">
        <span className="eq-tidy__summary-label">
          {summary.total_rows_scanned.toLocaleString()} {entityLabel.toLowerCase()} scanned
        </span>
        {auto_fixes.length > 0 && (
          <span className="eq-tidy__count eq-tidy__count--fix">
            {auto_fixes.length} auto-fixable
          </span>
        )}
        {gaps.length > 0 && (
          <span className="eq-tidy__count eq-tidy__count--gap">
            {gaps.length} gap{gaps.length !== 1 ? "s" : ""}
          </span>
        )}
        {review_flags.length > 0 && (
          <span className="eq-tidy__count eq-tidy__count--flag">
            {review_flags.length} need review
          </span>
        )}
        {allClean && (
          <span className="eq-tidy__count eq-tidy__count--ok">All clean</span>
        )}
      </div>

      {/* Auto-fixes */}
      {auto_fixes.length > 0 && (
        <div className="eq-tidy__section">
          <div className="eq-tidy__section-header">
            <h3 className="eq-tidy__section-title">Auto-fixes</h3>
            <p className="eq-tidy__section-hint">
              These values can be normalised automatically. Select the ones to apply.
            </p>
          </div>

          <Table<TidyFix>
            columns={fixColumns}
            rows={auto_fixes}
            getRowId={(f) => `${f.row_id}:${f.field}`}
            selectable
            selectedIds={selectedFixKeys}
            onSelectionChange={onSelectionChange}
            emptyMessage="No auto-fixes found."
            className="eq-tidy__table"
          />

          <div className="eq-tidy__apply-bar">
            {commitResult && (
              <span
                className={`eq-tidy__commit-result${commitResult.errors.length > 0 ? " eq-tidy__commit-result--warn" : " eq-tidy__commit-result--ok"}`}
              >
                {commitResult.applied > 0 && `${commitResult.applied} applied`}
                {commitResult.skipped > 0 && ` · ${commitResult.skipped} skipped`}
                {commitResult.errors.length > 0 &&
                  ` · ${commitResult.errors.length} error${commitResult.errors.length !== 1 ? "s" : ""}`}
              </span>
            )}
            <button
              className="eq-intake-btn-primary"
              type="button"
              onClick={onApply}
              disabled={selectedFixKeys.size === 0 || committing}
            >
              {committing
                ? "Applying…"
                : `Apply ${selectedFixKeys.size} fix${selectedFixKeys.size !== 1 ? "es" : ""}`}
            </button>
          </div>
        </div>
      )}

      {/* Format gaps */}
      {gaps.length > 0 && (
        <div className="eq-tidy__section">
          <div className="eq-tidy__section-header">
            <h3 className="eq-tidy__section-title">Data gaps</h3>
            <p className="eq-tidy__section-hint">
              Missing required fields or invalid formats. Use Download → Reconcile to fix in bulk.
            </p>
          </div>
          <Table<GapItem>
            columns={gapColumns}
            rows={gaps}
            getRowId={(g) => `${g.row_id}:${g.field}`}
            emptyMessage="No gaps."
            className="eq-tidy__table"
          />
        </div>
      )}

      {/* Review flags */}
      {review_flags.length > 0 && (
        <div className="eq-tidy__section">
          <div className="eq-tidy__section-header">
            <h3 className="eq-tidy__section-title">Needs review</h3>
            <p className="eq-tidy__section-hint">
              These could not be auto-fixed — a human should check them.
            </p>
          </div>
          <Table<ReviewFlag>
            columns={flagColumns}
            rows={review_flags}
            getRowId={(r) => `${r.row_id}:${r.field}`}
            emptyMessage="Nothing to review."
            className="eq-tidy__table"
          />
        </div>
      )}
    </div>
  );
}

// ── SuggestPanel ──────────────────────────────────────────────────────────────

interface SuggestPanelProps {
  rowLabel: string;
  loading: boolean;
  result: GapSuggestResult | null;
  error: string | null;
  onAccept: (field: string, value: string) => void;
  onClose: () => void;
}

function SuggestPanel({ rowLabel, loading, result, error, onAccept, onClose }: SuggestPanelProps): JSX.Element {
  return (
    <div className="eq-suggest-panel" role="region" aria-label="Gap suggestions">
      <div className="eq-suggest-panel__header">
        <span className="eq-suggest-panel__title">Suggestions for {rowLabel}</span>
        <button type="button" className="eq-suggest-panel__close" onClick={onClose} aria-label="Close suggestions">
          ×
        </button>
      </div>

      {loading && (
        <div className="eq-suggest-panel__loading">
          <span className="eq-health-spinner" aria-hidden="true" />
          Asking Claude…
        </div>
      )}

      {error && (
        <div role="alert" className="eq-suggest-panel__error">{error}</div>
      )}

      {result && result.suggestions.length === 0 && !loading && (
        <p className="eq-suggest-panel__empty">
          No suggestions — not enough context to infer values for the missing fields.
        </p>
      )}

      {result && result.suggestions.length > 0 && (
        <div className="eq-suggest-panel__list">
          {result.suggestions.map((s: GapSuggestion) => (
            <div key={s.field} className="eq-suggest-panel__row">
              <div className="eq-suggest-panel__field-info">
                <span className="eq-suggest-panel__field-name">
                  {fieldLabel(s.field)}
                </span>
                <span className={`eq-suggest-panel__confidence eq-suggest-panel__confidence--${s.confidence}`}>
                  {s.confidence}
                </span>
                <span className="eq-suggest-panel__reasoning">{s.reasoning}</span>
              </div>
              <div className="eq-suggest-panel__value-row">
                {s.suggested_value !== null ? (
                  <>
                    <code className="eq-suggest-panel__value">{s.suggested_value}</code>
                    <button
                      type="button"
                      className="eq-intake-btn-primary eq-suggest-panel__accept"
                      onClick={() => onAccept(s.field, s.suggested_value!)}
                    >
                      Accept
                    </button>
                  </>
                ) : (
                  <span className="eq-suggest-panel__no-value">No suggestion</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
