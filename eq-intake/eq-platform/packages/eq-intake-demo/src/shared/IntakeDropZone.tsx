/**
 * IntakeDropZone — the ONE drop zone for the consolidated Intake screen.
 *
 * Drop (or click to pick) any SimPRO export. Each sheet is parsed +
 * classified by the shared useIntakeBundle hook; this component just renders
 * the zone and the list of what landed ("looks like customers — 92% sure").
 * The destination is chosen separately, below, so the same dropped files can
 * go Into EQ or out to Xero/MYOB/etc. without re-dropping.
 */

import { useRef, useState, type DragEvent, type JSX } from "react";
import { roleLabel, type IntakeBundle } from "./intake-bundle.js";

// ---------------------------------------------------------------------------
// Entity label map (role → human label)
// ---------------------------------------------------------------------------
const ENTITY_LABELS: Record<string, string> = {
  customer: "Customers",
  site:     "Sites",
  contact:  "Contacts",
  staff:    "Staff",
  licence:  "Licences",
  asset:    "Assets",
};

// ---------------------------------------------------------------------------
// Upload icon (inline SVG — no external icon dep needed here)
// ---------------------------------------------------------------------------
function UploadIcon({ size = 26 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--eq-deep)"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function IntakeDropZone({ bundle }: { bundle: IntakeBundle }): JSX.Element {
  const { slots, busy, ingestFiles, removeSlot } = bundle;
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) void ingestFiles(files);
  };

  const hasFiles = slots.length > 0;

  // Build drop zone class
  const zoneClass = [
    "eq-intake-dropzone",
    dragOver ? "eq-intake-dropzone--over" : "",
    hasFiles ? "eq-intake-dropzone--compact" : "",
  ].filter(Boolean).join(" ");

  return (
    <div>
      {/* Drop target */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a file or click to pick"
        className={zoneClass}
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
      >
        {busy && slots.length === 0 ? (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--eq-deep)", fontSize: 14 }}>
            <span className="eq-spinner__dot" />
            Reading file…
          </span>
        ) : hasFiles ? (
          <>
            <UploadIcon size={16} />
            <span>Drop another file, or click to pick</span>
          </>
        ) : (
          <>
            <div className="eq-intake-dropzone__icon">
              <UploadIcon size={26} />
            </div>
            <p className="eq-intake-dropzone__title">Drop a SimPRO file here</p>
            <p className="eq-intake-dropzone__hint">CSV or Excel · We work out what it is</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) void ingestFiles(files);
            e.target.value = "";
          }}
        />
      </div>

      {/* File slot cards */}
      {slots.length > 0 && (
        <ul className="eq-intake-slots" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {slots.map((slot, i) => {
            const isUnknown = slot.role === "unknown";
            const conf = slot.confidence != null && !isUnknown
              ? Math.round(slot.confidence * 100)
              : null;
            const lowConf = conf != null && conf < 70;

            const slotClass = [
              "eq-intake-slot",
              lowConf ? "eq-intake-slot--warn" : "",
              isUnknown || slot.error ? "eq-intake-slot--err" : "",
            ].filter(Boolean).join(" ");

            const entityLabel = ENTITY_LABELS[slot.role] ?? roleLabel(slot.role);

            return (
              <li key={i} className={slotClass}>
                {/* Classification chip */}
                <span className={`eq-entity-chip ${isUnknown ? "eq-entity-chip--unknown" : "eq-entity-chip--typed"}`}>
                  {isUnknown ? "Unknown" : entityLabel}
                </span>

                {/* File info */}
                <div className="eq-intake-slot__info">
                  <div className="eq-intake-slot__row">
                    <span className="eq-intake-slot__name" title={slot.file.name}>
                      {slot.file.name}
                    </span>
                    {slot.sheet?.sheetName && slot.sheet.sheetName !== "Sheet1" && (
                      <span className="eq-intake-slot__sheet">
                        [{slot.sheet.sheetName}]
                      </span>
                    )}
                    {slot.sheet && (
                      <span className="eq-intake-slot__meta">
                        {slot.sheet.rows.length.toLocaleString()} rows
                      </span>
                    )}
                    {conf != null && (
                      <span
                        className="eq-intake-slot__meta"
                        style={lowConf ? { color: "var(--eq-warn)", fontWeight: 600 } : undefined}
                      >
                        {conf}% confident
                      </span>
                    )}
                  </div>
                  {slot.error && (
                    <div className="eq-intake-slot__error">{slot.error}</div>
                  )}
                  {lowConf && !slot.error && (
                    <div className="eq-intake-slot__warning">
                      Low confidence — does this look right?
                    </div>
                  )}
                  {isUnknown && !slot.error && (
                    <div className="eq-intake-slot__error">
                      Couldn't classify this file — check the column headers.
                    </div>
                  )}
                </div>

                {/* Remove */}
                <button
                  type="button"
                  className="eq-intake-slot__remove"
                  onClick={() => removeSlot(i)}
                  disabled={busy}
                  aria-label={`Remove ${slot.file.name}`}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
