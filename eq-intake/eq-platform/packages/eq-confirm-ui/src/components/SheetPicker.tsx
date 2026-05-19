/**
 * SheetPicker — confirm_sheet screen.
 *
 * Multi-sheet XLSX workbooks land here. Real SimPRO exports come in with
 * five tabs — staff, jobs, materials, labour, summary — and only one of
 * them is what the bookkeeper wanted to drag in. This screen lists every
 * sheet with its row count + the first few headers so the right one is
 * obvious without opening Excel.
 */

import type { JSX } from "react";
import type { UseBoundStore, StoreApi } from "zustand";
import type { FlowState } from "../types.js";
import type { FlowDriver } from "../store.js";

export interface SheetPickerProps {
  store: UseBoundStore<StoreApi<FlowState>>;
  driver: FlowDriver;
}

export function SheetPicker(props: SheetPickerProps): JSX.Element {
  const workbook = props.store((s) => s.parsedWorkbook);

  if (!workbook || workbook.sheets.length === 0) {
    return (
      <div className="eq-confirm-empty">
        No multi-sheet workbook in state. Drop a file above to start.
      </div>
    );
  }

  const sheets = workbook.sheets;

  return (
    <div className="eq-sheet-picker">
      <header className="eq-sheet-picker__header">
        <h2>Pick the sheet to import</h2>
        <p>
          This workbook has {sheets.length} sheets. Choose the one that holds
          the rows you want to bring across.
        </p>
      </header>
      <ul className="eq-sheet-picker__list">
        {sheets.map((sheet, index) => {
          const sampleHeaders = sheet.headerRow.slice(0, 5).join(", ");
          const more = sheet.headerRow.length - 5;
          return (
            <li key={`${sheet.sheetName}-${index}`} className="eq-sheet-picker__item">
              <button
                type="button"
                className="eq-sheet-picker__button"
                onClick={() => void props.driver.pickSheet(index)}
                aria-label={`Use sheet ${sheet.sheetName}`}
              >
                <span className="eq-sheet-picker__name">
                  <strong>{sheet.sheetName}</strong>
                </span>
                <span className="eq-sheet-picker__meta">
                  {sheet.rows.length} row{sheet.rows.length === 1 ? "" : "s"} ·{" "}
                  {sheet.headerRow.length} column
                  {sheet.headerRow.length === 1 ? "" : "s"}
                </span>
                <span className="eq-sheet-picker__headers" title={sheet.headerRow.join(", ")}>
                  {sampleHeaders}
                  {more > 0 ? ` … +${more} more` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
