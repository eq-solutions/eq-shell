/**
 * QuickExportSection — the MVP "drop one file, pick a destination, download"
 * surface. Intentionally simple: no joins, no required-roles complexity,
 * no "orphan handling" toggles. If a destination column maps to a source
 * column you don't have, it stays blank.
 *
 * Sits at the top of IntakeModule as the primary surface. The richer
 * RollupDropZone (multi-file joins, Xero/MYOB denormalised templates)
 * sits below for power users who need the cross-file logic.
 */

import { useState, useRef, useMemo, type DragEvent, type JSX } from "react";
import { parseFile, classifySheet, type ParsedSheet } from "@eq/intake";
import {
  CUSTOMER_SCHEMA,
  CONTACT_SCHEMA,
  SITE_SCHEMA,
} from "../simpro-schemas.js";
import type { RoleName } from "../rollup/roles.js";
import { QUICK_DESTINATIONS, encodeCsv } from "./destinations.js";

const ROLE_REGISTRY: Record<RoleName, Record<string, unknown>> = {
  customer: CUSTOMER_SCHEMA,
  contact: CONTACT_SCHEMA,
  site: SITE_SCHEMA,
};

interface FileSlot {
  file: File;
  role: RoleName | "unknown";
  sheet?: ParsedSheet;
  confidence?: number;
  error?: string;
}

function roleLabel(role: RoleName | "unknown"): string {
  if (role === "customer") return "customers";
  if (role === "site") return "sites";
  if (role === "contact") return "contacts";
  return "unknown";
}

export function QuickExportSection(): JSX.Element {
  const [slots, setSlots] = useState<FileSlot[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [destId, setDestId] = useState<string>(QUICK_DESTINATIONS[0]!.id);
  const [downloaded, setDownloaded] = useState<{ filename: string; rowCount: number } | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const dest = useMemo(
    () => QUICK_DESTINATIONS.find((d) => d.id === destId) ?? QUICK_DESTINATIONS[0]!,
    [destId],
  );

  // Find the source sheet that matches the chosen destination's role.
  const matchedSlot = useMemo(
    () => slots.find((s) => s.role === dest.needsRole),
    [slots, dest],
  );

  const ingestFiles = async (files: File[]) => {
    setError(null);
    setDownloaded(null);
    setBusy(true);
    try {
      const next: FileSlot[] = [];
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        try {
          const parsed = await parseFile({ bytes, fileName: file.name });
          const sheet = parsed.sheets[0];
          if (!sheet) {
            next.push({ file, role: "unknown", error: "Couldn't read this file" });
            continue;
          }
          const classification = await classifySheet({
            schemas: ROLE_REGISTRY,
            sheet,
          });
          const role =
            classification.entity === "customer" ||
            classification.entity === "contact" ||
            classification.entity === "site"
              ? (classification.entity as RoleName)
              : "unknown";
          next.push({ file, role, sheet, confidence: classification.confidence });
        } catch (e) {
          next.push({
            file,
            role: "unknown",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      setSlots((prev) => [...prev, ...next]);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) void ingestFiles(files);
  };

  const download = () => {
    setError(null);
    if (!matchedSlot?.sheet) {
      setError(
        `This needs a ${roleLabel(dest.needsRole)} file. Drop one above first.`,
      );
      return;
    }
    const headers = dest.columns.map((c) => c.name);
    const rows = matchedSlot.sheet.rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const col of dest.columns) {
        out[col.name] = col.value(r as Record<string, unknown>);
      }
      return out;
    });
    const csv = encodeCsv(headers, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = dest.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded({ filename: dest.filename, rowCount: rows.length });
  };

  const reset = () => {
    setSlots([]);
    setError(null);
    setDownloaded(null);
  };

  return (
    <section
      style={{
        padding: "24px 0",
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        color: "#1A1A2E",
      }}
    >
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>
        Quick export
      </h2>
      <p style={{ fontSize: 14, color: "#1A1A2E", opacity: 0.7, marginBottom: 16 }}>
        Drop a SimPRO file, pick where it's going, download. One file in, one
        file out — no faff.
      </p>

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
          padding: 24,
          borderRadius: 4,
          textAlign: "center",
          cursor: "pointer",
          marginBottom: 12,
        }}
      >
        {busy
          ? "Working..."
          : slots.length === 0
            ? "Drop a file here, or click to pick"
            : `${slots.length} file${slots.length === 1 ? "" : "s"} ready`}
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
                alignItems: "center",
              }}
            >
              <span>
                <strong>{slot.file.name}</strong>{" "}
                <span style={{ color: "#1A1A2E", opacity: 0.6 }}>
                  {slot.role === "unknown"
                    ? "— couldn't tell what this is"
                    : `— looks like ${roleLabel(slot.role)}`}
                </span>
              </span>
              {slot.error && (
                <span style={{ color: "#B33A3A", fontSize: 12 }}>{slot.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div
        style={{
          marginBottom: 16,
          padding: 12,
          background: "#EAF5FB",
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <label style={{ fontSize: 14, fontWeight: 500 }}>
          Send to:{" "}
          <select
            value={dest.id}
            onChange={(e) => {
              setDestId(e.target.value);
              setDownloaded(null);
              setError(null);
            }}
            style={{
              fontFamily: "inherit",
              fontSize: 14,
              padding: "6px 10px",
              borderRadius: 4,
              border: "1px solid #2986B4",
              background: "white",
            }}
          >
            {QUICK_DESTINATIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <span style={{ fontSize: 13, color: "#1A1A2E", opacity: 0.7, flex: 1 }}>
          {dest.description}
        </span>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: 12,
            background: "#FBEAEA",
            border: "1px solid #B33A3A",
            borderRadius: 4,
            color: "#B33A3A",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={download}
          disabled={busy || slots.length === 0}
          style={{
            padding: "10px 18px",
            background: !busy && slots.length > 0 ? "#3DA8D8" : "#BFD4DF",
            color: "white",
            border: "none",
            borderRadius: 4,
            fontWeight: 500,
            cursor: !busy && slots.length > 0 ? "pointer" : "not-allowed",
            fontSize: 14,
          }}
        >
          Download
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          style={{
            padding: "10px 18px",
            background: "white",
            color: "#1A1A2E",
            border: "1px solid #EAF5FB",
            borderRadius: 4,
            cursor: busy ? "not-allowed" : "pointer",
            fontSize: 14,
          }}
        >
          Start over
        </button>
      </div>

      {downloaded && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "#EAF5FB",
            border: "1px solid #2986B4",
            borderRadius: 4,
            fontSize: 14,
            color: "#1A1A2E",
          }}
        >
          ✓ Downloaded <strong>{downloaded.filename}</strong> — {downloaded.rowCount}{" "}
          row{downloaded.rowCount === 1 ? "" : "s"}. Open it in Outlook to import.
        </div>
      )}
    </section>
  );
}
