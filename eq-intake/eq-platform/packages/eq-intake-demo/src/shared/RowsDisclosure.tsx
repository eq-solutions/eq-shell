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
      const label = entityLabel(entity);
      for (const r of rows) {
        for (const reason of r.reasons) {
          out.push({ rowNum: r.source_row_index + 1, entity: label, reason });
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
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 500, color: accentColor }}>
        {label}{" "}
        <span style={{ fontWeight: 400, opacity: 0.7 }}>({allRows.length})</span>
      </summary>
      {hint && (
        <p style={{ fontSize: 12, color: hintColor ?? accentColor, margin: "6px 0 8px" }}>
          {hint}
        </p>
      )}
      {showDownload && allRows.length > 0 && (
        <button
          type="button"
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
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            fontSize: 12,
            background: "white",
            color: "#1A1A2E",
            border: "1px solid #EAF5FB",
            borderRadius: 4,
            cursor: "pointer",
            marginBottom: 8,
            fontFamily: "inherit",
          }}
        >
          ↓ Download as CSV ({allRows.length} rows)
        </button>
      )}
      <div style={{ marginTop: 8 }}>
        <input
          type="text"
          placeholder="Filter by row number, entity, or reason…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "5px 8px",
            fontSize: 12,
            border: "1px solid #EAF5FB",
            borderRadius: 4,
            fontFamily: "inherit",
            marginBottom: 6,
          }}
        />
        <div style={{ overflowX: "auto", border: "1px solid #EAF5FB", borderRadius: 4 }}>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#EAF5FB" }}>
                <th
                  style={{ padding: "4px 8px", textAlign: "left", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}
                  onClick={() => setSortAsc((a) => !a)}
                >
                  Row {sortAsc ? "↑" : "↓"}
                </th>
                <th style={{ padding: "4px 8px", textAlign: "left" }}>Type</th>
                <th style={{ padding: "4px 8px", textAlign: "left" }}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: "8px", color: "#1A1A2E", opacity: 0.5, textAlign: "center" }}>
                    No rows match
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #F4F4F8" }}>
                    <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{r.rowNum}</td>
                    <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{r.entity}</td>
                    <td style={{ padding: "4px 8px" }}>{r.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length < allRows.length && (
          <div style={{ fontSize: 11, color: "#1A1A2E", opacity: 0.5, marginTop: 4 }}>
            Showing {filtered.length} of {allRows.length} rows
          </div>
        )}
      </div>
    </details>
  );
}
