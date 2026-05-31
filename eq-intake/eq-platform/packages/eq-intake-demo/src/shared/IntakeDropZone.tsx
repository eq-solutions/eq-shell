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

  return (
    <div>
      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "#3DA8D8" : "#EAF5FB"}`,
          background: dragOver ? "#EAF5FB" : "white",
          padding: 28,
          borderRadius: 4,
          textAlign: "center",
          cursor: "pointer",
          marginBottom: 12,
          fontSize: 15,
        }}
      >
        {busy && slots.length === 0 ? (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span className="eq-spinner__dot" />
            Reading file…
          </span>
        ) : slots.length === 0 ? (
          "Drop a file here, or click to pick — we'll work out what it is"
        ) : (
          `${slots.length} file${slots.length === 1 ? "" : "s"} ready — drop more, or pick a destination below`
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

      {slots.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, marginBottom: 16 }}>
          {slots.map((slot, i) => (
            <li
              key={i}
              style={{
                padding: "6px 8px",
                borderBottom: "1px solid #F4F4F8",
                fontSize: 13,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <span style={{ flex: 1 }}>
                <strong>{slot.file.name}</strong>
                {slot.sheet?.sheetName && slot.sheet.sheetName !== "Sheet1" && (
                  <span style={{ color: "#2986B4", fontSize: 11, marginLeft: 6 }}>
                    [{slot.sheet.sheetName}]
                  </span>
                )}{" "}
                <span style={{ color: "#1A1A2E", opacity: 0.6 }}>
                  {slot.role === "unknown"
                    ? "— couldn't tell what this is"
                    : `— looks like ${roleLabel(slot.role)}`}
                  {slot.confidence != null && slot.role !== "unknown"
                    ? ` (${Math.round(slot.confidence * 100)}% sure)`
                    : ""}
                </span>
                {slot.confidence != null && slot.confidence < 0.7 && slot.role !== "unknown" && (
                  <span style={{ display: "block", color: "#d97706", fontSize: 11, marginTop: 2, fontWeight: 500 }}>
                    Low confidence — does this look right?
                  </span>
                )}
                {slot.error && (
                  <span style={{ display: "block", color: "#B33A3A", fontSize: 12, marginTop: 2 }}>
                    {slot.error}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => removeSlot(i)}
                disabled={busy}
                aria-label={`Remove ${slot.file.name}`}
                style={{
                  padding: "2px 8px",
                  fontSize: 12,
                  flexShrink: 0,
                  background: "white",
                  color: "#1A1A2E",
                  border: "1px solid #EAF5FB",
                  borderRadius: 4,
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
