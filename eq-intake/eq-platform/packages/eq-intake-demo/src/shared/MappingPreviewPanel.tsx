/**
 * MappingPreviewPanel — pre-commit column mapping preview.
 *
 * Lifted out of CanonicalCommitSection so the one-screen IntakeModule can show
 * the user how their source columns line up with EQ fields BEFORE they hit
 * "Save into EQ". Reuses inferMapping from commit-canonical (the same matcher
 * the commit itself uses) — no second copy of the alias logic.
 *
 * Unmatched columns are highlighted in the warn colour so the user can spot
 * gaps before saving. Renders as a collapsible panel so it doesn't crowd the
 * screen.
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
    <details className="eq-mapping-panel">
      <summary>
        Preview column mapping
        <span className="eq-mapping-panel__hint">
          — see how your columns match EQ fields before saving
        </span>
      </summary>
      <div className="eq-mapping-panel__body">
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
            <div key={idx} className="eq-mapping-panel__entity">
              <div className="eq-mapping-panel__entity-header">
                <span>
                  <span className="eq-mapping-panel__entity-name">
                    {slot.file.name}
                  </span>
                  {slot.sheet.sheetName && slot.sheet.sheetName !== "Sheet1" && (
                    <span className="eq-mapping-panel__entity-sheet">
                      [{slot.sheet.sheetName}]
                    </span>
                  )}
                  {" — "}
                  {entityLabel(slot.role)}
                </span>
                <span className={`eq-mapping-panel__match-count${unmappedCount > 0 ? " eq-mapping-panel__match-count--warn" : ""}`}>
                  {mapped}/{total} columns matched
                  {unmappedCount > 0 ? ` · ${unmappedCount} unmatched` : ""}
                </span>
              </div>
              <div className="eq-mapping-panel__table-wrap">
                <table className="eq-mapping-panel__table">
                  <thead>
                    <tr>
                      <th>Your column</th>
                      <th>EQ field</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slot.sheet.headerRow.map((col, ci) => {
                      const canonicalField = mapping[col];
                      return (
                        <tr key={ci}>
                          <td className="eq-mapping-panel__col-source">{col}</td>
                          <td>
                            {canonicalField ? (
                              <span className="eq-mapping-panel__col-field">{canonicalField}</span>
                            ) : (
                              <span className="eq-mapping-panel__col-unmatched">
                                not matched — will be skipped
                              </span>
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
