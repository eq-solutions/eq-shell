/**
 * useIntakeBundle — the shared "drop a file, parse it, work out what it is"
 * state, lifted out of the individual sections so ONE drop zone can feed
 * BOTH the export path and the Into-EQ commit path.
 *
 * This is the piece IntakeModule's old comment flagged as "the next step":
 * QuickExportSection and CanonicalCommitSection each used to wire up
 * parseFile() + classifySheet() independently, forcing the bookkeeper to
 * drop files twice. Now they drop once; this hook holds the classified
 * slots and every destination reads from the same set.
 */

import { useState, useCallback } from "react";
import { parseFile, classifySheet, type ParsedSheet } from "@eq/intake";
import {
  CUSTOMER_SCHEMA,
  CONTACT_SCHEMA,
  SITE_SCHEMA,
  STAFF_SCHEMA,
} from "../simpro-schemas.js";
import type { RoleName } from "../rollup/roles.js";

/** The four roles a SimPRO-shaped sheet gets classified into. */
export const ROLE_REGISTRY: Record<RoleName, Record<string, unknown>> = {
  customer: CUSTOMER_SCHEMA,
  contact: CONTACT_SCHEMA,
  site: SITE_SCHEMA,
  staff: STAFF_SCHEMA,
};

/** One dropped sheet, after parse + classification. */
export interface FileSlot {
  file: File;
  role: RoleName | "unknown";
  sheet?: ParsedSheet;
  confidence?: number;
  error?: string;
}

/** Plain-English plural for a role, for UI copy. */
export function roleLabel(role: RoleName | "unknown"): string {
  switch (role) {
    case "customer":
      return "customers";
    case "site":
      return "sites";
    case "contact":
      return "contacts";
    case "staff":
      return "staff";
    default:
      return "unknown";
  }
}

function toRole(entity: string): RoleName | "unknown" {
  return entity === "customer" ||
    entity === "contact" ||
    entity === "site" ||
    entity === "staff"
    ? (entity as RoleName)
    : "unknown";
}

export interface IntakeBundle {
  slots: FileSlot[];
  busy: boolean;
  /** Parse + classify dropped files and append them as slots. */
  ingestFiles: (files: File[]) => Promise<void>;
  removeSlot: (idx: number) => void;
  reset: () => void;
  /** Distinct non-unknown roles present across the current slots. */
  availableRoles: Set<RoleName>;
  /** The first readable slot for a given role, or undefined. */
  slotForRole: (role: RoleName) => FileSlot | undefined;
}

export function useIntakeBundle(): IntakeBundle {
  const [slots, setSlots] = useState<FileSlot[]>([]);
  const [busy, setBusy] = useState(false);

  const ingestFiles = useCallback(async (files: File[]) => {
    setBusy(true);
    try {
      const next: FileSlot[] = [];
      for (const file of files) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const parsed = await parseFile({ bytes, fileName: file.name });
          if (!parsed.sheets.length) {
            next.push({ file, role: "unknown", error: "Couldn't read this file" });
            continue;
          }
          // One slot per sheet, so multi-tab workbooks classify each tab.
          for (const sheet of parsed.sheets) {
            const classification = await classifySheet({
              schemas: ROLE_REGISTRY,
              sheet,
            });
            next.push({
              file,
              role: toRole(classification.entity),
              sheet,
              confidence: classification.confidence,
            });
          }
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
  }, []);

  const removeSlot = useCallback((idx: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const reset = useCallback(() => setSlots([]), []);

  const availableRoles = new Set<RoleName>(
    slots
      .filter((s) => s.role !== "unknown" && s.sheet)
      .map((s) => s.role as RoleName),
  );

  const slotForRole = useCallback(
    (role: RoleName): FileSlot | undefined =>
      slots.find((s) => s.role === role && s.sheet),
    [slots],
  );

  return { slots, busy, ingestFiles, removeSlot, reset, availableRoles, slotForRole };
}
