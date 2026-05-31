/**
 * MappingPreviewPanel — pre-commit column mapping preview.
 *
 * Lifted out of CanonicalCommitSection so the one-screen IntakeModule can show
 * the user how their source columns line up with EQ fields BEFORE they hit
 * "Save into EQ". Reuses inferMapping from commit-canonical (the same matcher
 * the commit itself uses) — no second copy of the alias logic.
 *
 * Unmatched columns (null) are highlighted amber so the user can spot gaps
 * before saving. Renders as a collapsible panel so it doesn't crowd the screen.
 */

import { type JSX } from "react";
import { inferMapping } from "../canonical/commit-canonical.js";
import type { FileSlot } from "./intake-bundle.js";
import { entityLabel } from "./entity-label.js";

export interface MappingPreviewPanelProps {
  slots: FileSlot[];
  /** role → JSON schema. The shared ROLE_REGISTRY from intake-bundle fits. */
  registry: Record<string, Record<string, unknown>>;
}

export function MappingPreviewPanel({ slots, registry }: MappingPreviewPanelProps): JSX.Element | null {
  const knowns = slots.filter((s) => s.role !== "unknown" && s.sheet);
  if (knowns.length === 0) return null;

  return (
    <details style={{ marginBottom: 12 }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 500,
          color: "#2986B4",
          userSelect: "none",
        }}
      >
        Preview column mapping
        <span style={{ fontWeight: 400, opacity: 0.7, marginLeft: 4 }}>
          — see how your columns match EQ fields before saving
        </span>
      </summary>
      <div style={{ marginTop: 10 }}>
        {knowns.map((slot, idx) => {
          const schema = registry[slot.role as string] as Record<string, unknown> | undefined;
          if (!schema || !slot.sheet) return null;

          const mapping = inferMapping(
            slot.sheet.headerRow,
            schema as unknown as Parameters<typeof inferMapping>[1],
          );
          const mapped = Object.values(mapping).filter(Boolean).length;
          const total = slot.sheet.headerRow.length;
          const unmappedCount = total - mapped;

          return (
            <div
              key={idx}
              style={{
                marginBottom: 12,
                border: "1px solid #EAF5FB",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "6px 10px",
                  background: "#EAF5FB",
                  fontSize: 12,
                  fontWeight: 600,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>
                  {slot.file.name}
                  {slot.sheet.sheetName && slot.sheet.sheetName !== "Sheet1" && (
                    <span style={{ color: "#2986B4", marginLeft: 6 }}>[{slot.sheet.sheetName}]</span>
                  )}
                  {" — "}
                  {entityLabel(slot.role)}
                </span>
                <span style={{ fontWeight: 400, color: unmappedCount > 0 ? "#d97706" : "#2986B4" }}>
                  {mapped}/{total} columns matched
                  {unmappedCount > 0 ? ` · ${unmappedCount} unmatched` : ""}
                </span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#F8FCFE" }}>
                      <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 500, borderBottom: "1px solid #EAF5FB" }}>
                        Your column
                      </th>
                      <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 500, borderBottom: "1px solid #EAF5FB" }}>
                        EQ field
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {slot.sheet.headerRow.map((col, ci) => {
                      const canonicalField = mapping[col];
                      return (
                        <tr key={ci} style={{ borderBottom: "1px solid #F4F4F8" }}>
                          <td style={{ padding: "3px 8px", fontFamily: "monospace", fontSize: 11 }}>
                            {col}
                          </td>
                          <td
                            style={{
                              padding: "3px 8px",
                              color: canonicalField ? "#2986B4" : "#d97706",
                              fontFamily: canonicalField ? "monospace" : "inherit",
                              fontSize: canonicalField ? 11 : 12,
                            }}
                          >
                            {canonicalField ?? (
                              <span style={{ opacity: 0.7 }}>not matched — will be skipped</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
