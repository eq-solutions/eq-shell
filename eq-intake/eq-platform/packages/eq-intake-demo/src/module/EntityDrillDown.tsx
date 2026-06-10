import { useState, useEffect, useCallback, type JSX } from "react";
import { fetchCanonicalRows } from "@eq/intake";
import type { CanonicalFetchClient } from "@eq/intake";

export interface EntityDrillDownProps {
  entity: string;
  supabase?: CanonicalFetchClient | null;
  onBack?: () => void;
  onBulkFix?: (csvBlob: Blob, filename: string) => void;
}

type Row = Record<string, unknown>;

const GAP_FIELDS: Record<string, string[]> = {
  staff: ["email", "phone"],
  sites: ["address", "suburb", "state", "postcode"],
  contacts: ["email", "phone"],
  customers: ["email", "phone", "abn"],
  assets: ["asset_type", "serial_number", "site_id"],
};

const DISPLAY_COLUMNS: Record<string, string[]> = {
  staff: ["first_name", "last_name", "email", "phone"],
  sites: ["site_name", "address", "suburb", "state", "postcode"],
  contacts: ["full_name", "email", "phone"],
  customers: ["company_name", "email", "phone", "abn"],
  assets: ["asset_name", "asset_type", "serial_number"],
};

const COLUMN_LABELS: Record<string, string> = {
  first_name: "First Name",
  last_name: "Last Name",
  email: "Email",
  phone: "Phone",
  site_name: "Site Name",
  address: "Address",
  suburb: "Suburb",
  state: "State",
  postcode: "Postcode",
  full_name: "Full Name",
  company_name: "Company",
  abn: "ABN",
  asset_name: "Asset Name",
  asset_type: "Asset Type",
  serial_number: "Serial Number",
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
  const header = columns.map((c) => `"${COLUMN_LABELS[c] ?? c}"`).join(",");
  const body = rows.map((row) =>
    columns
      .map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      })
      .join(",")
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
  rowIndex: number;
  field: string;
  value: string;
}

export function EntityDrillDown({
  entity,
  supabase,
  onBack,
  onBulkFix,
}: EntityDrillDownProps): JSX.Element {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGapsOnly, setShowGapsOnly] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [hasLocalEdits, setHasLocalEdits] = useState(false);

  const gapFields = GAP_FIELDS[entity] ?? [];
  const displayColumns = DISPLAY_COLUMNS[entity] ?? [];

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
        const data = await fetchCanonicalRows(supabase, entity);
        if (!cancelled) {
          setRows(data);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load records."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [entity, supabase]);

  const visibleRows = showGapsOnly
    ? rows.filter((r) => rowHasGap(r, gapFields))
    : rows;

  const handleDownloadCsv = useCallback(() => {
    const csv = buildCsvContent(visibleRows, displayColumns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const filename = `${entity}-${todayString()}.csv`;

    if (onBulkFix) {
      onBulkFix(blob, filename);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [visibleRows, displayColumns, entity, onBulkFix]);

  const startEdit = useCallback(
    (rowIndex: number, field: string) => {
      const current = visibleRows[rowIndex][field];
      setEditState({ rowIndex, field });
      setEditDraft(current === null || current === undefined ? "" : String(current));
    },
    [visibleRows]
  );

  const commitEdit = useCallback(() => {
    if (!editState) return;

    const { rowIndex, field } = editState;
    const targetRow = visibleRows[rowIndex];

    setRows((prev) =>
      prev.map((r) => {
        if (r === targetRow) {
          return { ...r, [field]: editDraft };
        }
        return r;
      })
    );

    setHasLocalEdits(true);
    setEditState(null);
    setEditDraft("");
  }, [editState, editDraft, visibleRows]);

  const cancelEdit = useCallback(() => {
    setEditState(null);
    setEditDraft("");
  }, []);

  if (loading) {
    return (
      <div className="eq-drill eq-drill--loading">
        <p className="eq-drill__loading-text">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="eq-drill eq-drill--error">
        {onBack && (
          <button className="eq-drill__back-btn" onClick={onBack} type="button">
            ← Back
          </button>
        )}
        <div className="eq-drill__error-alert" role="alert">
          <strong>Error:</strong> {error}
        </div>
      </div>
    );
  }

  const totalCount = rows.length;
  const gapCount = rows.filter((r) => rowHasGap(r, gapFields)).length;

  return (
    <div className="eq-drill">
      <div className="eq-drill__header">
        <div className="eq-drill__header-left">
          {onBack && (
            <button
              className="eq-drill__back-btn"
              onClick={onBack}
              type="button"
            >
              ← Back
            </button>
          )}
          <h2 className="eq-drill__title">
            {formatLabel(entity)} — {totalCount} record
            {totalCount !== 1 ? "s" : ""}
            {gapCount > 0 && (
              <span className="eq-drill__gap-badge">{gapCount} with gaps</span>
            )}
          </h2>
        </div>
        <div className="eq-drill__header-actions">
          <div className="eq-drill__filter-toggle" role="group" aria-label="Filter rows">
            <button
              className={`eq-drill__filter-btn${!showGapsOnly ? " eq-drill__filter-btn--active" : ""}`}
              onClick={() => setShowGapsOnly(false)}
              type="button"
              aria-pressed={!showGapsOnly}
            >
              All
            </button>
            <button
              className={`eq-drill__filter-btn${showGapsOnly ? " eq-drill__filter-btn--active" : ""}`}
              onClick={() => setShowGapsOnly(true)}
              type="button"
              aria-pressed={showGapsOnly}
            >
              Gaps only
            </button>
          </div>
          <button
            className="eq-drill__download-btn"
            onClick={handleDownloadCsv}
            type="button"
            disabled={visibleRows.length === 0}
          >
            Download as CSV
          </button>
        </div>
      </div>

      {hasLocalEdits && (
        <div className="eq-drill__local-edits-notice" role="status">
          Changes are local only — use Download to export and re-import via
          Reconcile.
        </div>
      )}

      {visibleRows.length === 0 ? (
        <div className="eq-drill__empty">
          {showGapsOnly ? (
            <p>No gaps found — all {formatLabel(entity).toLowerCase()} records are complete.</p>
          ) : (
            <p>
              No {entity} records found — import some via the Import tab.
            </p>
          )}
        </div>
      ) : (
        <div className="eq-drill__table-wrap">
          <table className="eq-drill__table">
            <thead>
              <tr className="eq-drill__head-row">
                {displayColumns.map((col) => (
                  <th key={col} className="eq-drill__th" scope="col">
                    {COLUMN_LABELS[col] ?? col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, rowIndex) => (
                <tr key={rowIndex} className="eq-drill__row">
                  {displayColumns.map((col) => {
                    const isGapField = gapFields.includes(col);
                    const blank = isGapField && isBlank(row[col]);
                    const isEditing =
                      editState?.rowIndex === rowIndex &&
                      editState?.field === col;

                    let cellClass = "eq-drill__cell";
                    if (blank) cellClass += " eq-drill__cell--gap";
                    if (isGapField && !blank) cellClass += " eq-drill__cell--filled";

                    return (
                      <td
                        key={col}
                        className={cellClass}
                        onClick={
                          isGapField && !isEditing
                            ? () => startEdit(rowIndex, col)
                            : undefined
                        }
                        title={
                          isGapField && !isEditing ? "Click to edit" : undefined
                        }
                      >
                        {isEditing ? (
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
                              aria-label={`Edit ${COLUMN_LABELS[col] ?? col}`}
                            />
                            <button
                              className="eq-drill__inline-save"
                              onClick={commitEdit}
                              type="button"
                            >
                              Save
                            </button>
                            <button
                              className="eq-drill__inline-cancel"
                              onClick={cancelEdit}
                              type="button"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span className="eq-drill__cell-value">
                            {isBlank(row[col]) ? (
                              <span className="eq-drill__cell-empty">—</span>
                            ) : (
                              String(row[col])
                            )}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
