/**
 * RowsDisclosure — collapsible per-row drill-down for a commit result.
 *
 * Lifted out of CanonicalCommitSection so the one-screen IntakeModule can show
 * the same flagged-rows / rejected-rows tables after a save. Two call sites use
 * it today:
 *   - "saved but need checking" (flagged rows) — amber accent, no download
 *   - "couldn't save — and why"  (rejected rows) — ink accent, CSV download
 *
 * Rows flatten across entities (one line per reason), with a free-text filter
 * and a click-to-toggle row-number sort. EQ palette, no shadows/gradients.
 *
 * NOTE: accentColor and hintColor are dynamic props — they must stay as inline
 * styles. Everything else uses CSS classes.
 */

import { useMemo, useState, type JSX } from "react";
import type { EntityCommitResult } from "../canonical/commit-canonical.js";
import { entityLabel } from "./entity-label.js";

export interface RowsDisclosureProps {
  label: string;
  hint?: string;
  accentColor: string;
  hintColor?: string;
  /** Show a "Download as CSV" button to export the rows. */
  showDownload?: boolean;
  /** Filename for the downloaded CSV. Default: "eq-rows.csv". */
  downloadFilename?: string;
  perEntity: Array<{
    entity: EntityCommitResult["entity"];
    rows: Array<{ source_row_index: number; reasons: string[] }>;
  }>;
}

/** Trigger a browser CSV download from an array of flat string objects. */
function downloadCsv(filename: string, columns: string[], rows: Array<Record<string, string>>): void {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    columns.map(escape).join(","),
    ...rows.map((r) => columns.map((c) => escape(r[c] ?? "")).join(",")),
  ];
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function RowsDisclosure({
  label,
  hint,
  accentColor,
  hintColor,
  perEntity,
  showDownload,
  downloadFilename,
}: RowsDisclosureProps): JSX.Element {
  const [filter, setFilter] = useState("");
  const [sortAsc, setSortAsc] = useState(true);

  // Flatten all rows across entities with entity label prepended to reason.
  const allRows = useMemo(() => {
    const out: Array<{ rowNum: number; entity: string; reason: string }> = [];
    for (const { entity, rows } of perEntity) {
      const lbl = entityLabel(entity);
      for (const r of rows) {
        for (const reason of r.reasons) {
          out.push({ rowNum: r.source_row_index + 1, entity: lbl, reason });
        }
      }
    }
    return out;
  }, [perEntity]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    const rows = q
      ? allRows.filter(
          (r) =>
            r.entity.toLowerCase().includes(q) ||
            r.reason.toLowerCase().includes(q) ||
            String(r.rowNum).includes(q),
        )
      : allRows;
    return [...rows].sort((a, b) =>
      sortAsc ? a.rowNum - b.rowNum : b.rowNum - a.rowNum,
    );
  }, [allRows, filter, sortAsc]);

  return (
    <details className="eq-rows-disclosure">
      {/* accentColor is a dynamic prop — must stay inline */}
      <summary style={{ color: accentColor }}>
        {label}{" "}
        <span className="eq-rows-disclosure__count">({allRows.length})</span>
      </summary>
      {hint && (
        /* hintColor is also dynamic */
        <p className="eq-rows-disclosure__hint" style={{ color: hintColor ?? accentColor }}>
          {hint}
        </p>
      )}
      {showDownload && allRows.length > 0 && (
        <button
          type="button"
          className="eq-rows-disclosure__download"
          onClick={() =>
            downloadCsv(
              downloadFilename ?? "eq-rows.csv",
              ["Row", "Type", "Reason"],
              allRows.map((r) => ({
                Row: String(r.rowNum),
                Type: r.entity,
                Reason: r.reason,
              })),
            )
          }
        >
          ↓ Download as CSV ({allRows.length} rows)
        </button>
      )}
      <div className="eq-rows-disclosure__body">
        <input
          type="text"
          className="eq-rows-disclosure__filter"
          placeholder="Filter by row number, entity, or reason…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="eq-rows-disclosure__table-wrap">
          <table className="eq-rows-disclosure__table">
            <thead>
              <tr>
                <th
                  className="eq-sortable"
                  onClick={() => setSortAsc((a) => !a)}
                >
                  Row {sortAsc ? "↑" : "↓"}
                </th>
                <th>Type</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} className="eq-rows-disclosure__empty">
                    No rows match
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <tr key={i}>
                    <td className="eq-monospace">{r.rowNum}</td>
                    <td className="eq-nowrap">{r.entity}</td>
                    <td>{r.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length < allRows.length && (
          <div className="eq-rows-disclosure__showing">
            Showing {filtered.length} of {allRows.length} rows
          </div>
        )}
      </div>
    </details>
  );
}
