/**
 * Confirm-flow store — Zustand state machine.
 *
 * Single createConfirmFlow() factory so each consumer instance gets its own
 * store (multiple parallel imports on the same page don't collide).
 *
 * The store is headless. React components subscribe to slices and call
 * actions. The high-level runFlow() driver coordinates parse → classify →
 * map → validate transitions but stays out of the store internals.
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import type {
  FlowState,
  FlowStatus,
  FlowConfig,
  FlagResolution,
  EffectiveMapping,
  CommitReady,
  CommittableRow,
} from "./types.js";
import {
  parseFile,
  classifySheet,
  type ParsedSheet,
} from "@eq/intake";
import { validate, type TransformSpec, type Flag } from "@eq/validation";

/**
 * Create a fresh confirm-flow store. Returns the Zustand hook + a driver
 * that runs the parse → classify → map → validate pipeline against config.
 */
export function createConfirmFlow(): {
  useStore: UseBoundStore<StoreApi<FlowState>>;
  driver: FlowDriver;
} {
  const useStore = create<FlowState>((set, get) => ({
    status: { kind: "idle" } as FlowStatus,
    userOverrides: {},
    transformations: {},
    clarificationAnswers: {},
    resolutions: {},

    setFile: (file) => set({ file }),
    setStatus: (status) => set({ status }),
    setParsedSheet: (parsedSheet) => set({ parsedSheet }),
    setParsedWorkbook: (parsedWorkbook) => set({ parsedWorkbook }),
    setClassification: (classification) => set({ classification }),
    setAiMapping: (aiMapping) =>
      set((s) => ({
        aiMapping,
        userOverrides: derivedOverrides(aiMapping, s.userOverrides),
      })),
    setUserOverride: (sourceCol, canonicalField) =>
      set((s) => ({
        userOverrides: { ...s.userOverrides, [sourceCol]: canonicalField },
      })),
    setTransform: (sourceCol, spec) =>
      set((s) => ({
        transformations: { ...s.transformations, [sourceCol]: spec },
      })),
    answerClarification: (questionId, answer) =>
      set((s) => ({
        clarificationAnswers: {
          ...s.clarificationAnswers,
          [questionId]: answer,
        },
      })),
    setValidationResult: (validationResult) => set({ validationResult }),
    resolveFlag: (rowIndex, resolution) =>
      set((s) => ({
        resolutions: { ...s.resolutions, [rowIndex]: resolution },
      })),
    resolveBulk: (flagKind, resolution) =>
      set((s) => {
        const next = { ...s.resolutions };
        const flagged = s.validationResult?.flagged_rows ?? [];
        for (const row of flagged) {
          if (row.flags.some((f) => f.kind === flagKind)) {
            next[row.source_row_index] = resolution;
          }
        }
        return { resolutions: next };
      }),
    setDestination: (destination, destinationSource) =>
      set({
        destination: destination ?? undefined,
        destinationSource: destination ? destinationSource : undefined,
      }),
    reset: () =>
      set({
        status: { kind: "idle" },
        file: undefined,
        fileHash: undefined,
        parsedSheet: undefined,
        parsedWorkbook: undefined,
        classification: undefined,
        aiMapping: undefined,
        userOverrides: {},
        transformations: {},
        clarificationAnswers: {},
        validationResult: undefined,
        resolutions: {},
        destination: undefined,
        destinationSource: undefined,
      }),
  }));

  const driver = new FlowDriverImpl(useStore);
  return { useStore, driver };
}

// ============================================================================
// DRIVER
// ============================================================================

export interface FlowDriver {
  /** Set config + reset for a fresh flow. */
  configure(config: FlowConfig): void;
  /** Parse the supplied file (CSV / XLSX detected from name + content). */
  parse(file: File | { name: string; bytes: Uint8Array }): Promise<void>;
  /**
   * Choose which sheet from a multi-sheet workbook to continue with, then
   * advance through classify + map to confirm_mapping. Only valid in the
   * confirm_sheet phase.
   */
  pickSheet(index: number): Promise<void>;
  /** Run classification against the schema registry. Optional — skip when target schema is fixed. */
  classify(): Promise<void>;
  /** Run AI column mapping. No-op if config.ai is absent. */
  map(): Promise<void>;
  /** Run @eq/validation against the effective mapping. */
  validate(): Promise<void>;
  /** Commit valid + resolved-flagged rows via the configured commit fn. */
  commit(): Promise<void>;
  /**
   * Run the full pipeline up to confirm_mapping. Useful for tests + simple
   * flows. If the file produces multiple sheets the driver stops at
   * confirm_sheet and the caller must invoke pickSheet() to continue.
   */
  runToConfirmMapping(file: File | { name: string; bytes: Uint8Array }): Promise<void>;
}

class FlowDriverImpl implements FlowDriver {
  private config?: FlowConfig;

  constructor(private useStore: UseBoundStore<StoreApi<FlowState>>) {}

  configure(config: FlowConfig): void {
    this.config = config;
    this.useStore.getState().reset();
  }

  async parse(file: File | { name: string; bytes: Uint8Array }): Promise<void> {
    const store = this.useStore.getState();
    store.setFile(file);
    store.setStatus({ kind: "parsing" });

    try {
      const sheets = await parseFileByName(file, this.config);
      if (sheets.length > 1) {
        // Multi-sheet workbook — stash the lot and hand off to the picker.
        store.setParsedWorkbook({ sheets });
        store.setStatus({ kind: "confirm_sheet" });
        return;
      }
      store.setParsedSheet(sheets[0]!);
      store.setStatus({ kind: "classifying" });
    } catch (e) {
      store.setStatus({
        kind: "error",
        error: errString(e),
        phase: "parsing",
      });
      throw e;
    }
  }

  async pickSheet(index: number): Promise<void> {
    const store = this.useStore.getState();
    const workbook = store.parsedWorkbook;
    if (!workbook) {
      throw new Error("pickSheet() called without a multi-sheet workbook in state.");
    }
    const chosen = workbook.sheets[index];
    if (!chosen) {
      throw new Error(
        `pickSheet(${index}) — workbook only has ${workbook.sheets.length} sheets.`,
      );
    }
    store.setParsedSheet(chosen);
    // Clear the workbook so re-entering the picker requires another parse.
    store.setParsedWorkbook(undefined);
    store.setStatus({ kind: "classifying" });
    await this.classify();
    await this.map();
  }

  async classify(): Promise<void> {
    const store = this.useStore.getState();
    const sheet = store.parsedSheet;
    if (!sheet) {
      throw new Error("classify() called before parse() — no parsed sheet in state.");
    }
    if (!this.config?.schemaRegistry) {
      // No registry — the consumer has a fixed schema. Skip classification.
      store.setStatus({ kind: "mapping" });
      return;
    }
    try {
      const result = await classifySheet({
        schemas: this.config.schemaRegistry,
        sheet,
        ai: this.config.ai,
      });
      store.setClassification(result);
      store.setStatus({ kind: "mapping" });
    } catch (e) {
      store.setStatus({
        kind: "error",
        error: errString(e),
        phase: "classifying",
      });
      throw e;
    }
  }

  async map(): Promise<void> {
    const store = this.useStore.getState();
    const sheet = store.parsedSheet;
    if (!sheet) throw new Error("map() called before parse().");
    if (!this.config) throw new Error("map() called before configure().");

    if (!this.config.ai) {
      // No AI — caller must populate userOverrides manually before validate().
      store.setStatus({ kind: "confirm_mapping" });
      return;
    }

    try {
      const result = await this.config.ai.map({
        targetSchema: this.config.schema,
        sourceColumns: sheet.headerRow,
        sampleRows: sheet.rows.slice(0, 10),
      });
      store.setAiMapping(result);
      store.setStatus({ kind: "confirm_mapping" });
    } catch (e) {
      store.setStatus({
        kind: "error",
        error: errString(e),
        phase: "mapping",
      });
      throw e;
    }
  }

  async validate(): Promise<void> {
    const store = this.useStore.getState();
    if (!this.config) throw new Error("validate() called before configure().");
    if (!store.parsedSheet) throw new Error("validate() called before parse().");

    store.setStatus({ kind: "validating" });

    try {
      const effective = computeEffectiveMapping(store);
      const result = await validate({
        schema: this.config.schema,
        mapping: effective.mapping,
        transformations: effective.transformations,
        rows: store.parsedSheet.rows,
        tenantId: this.config.tenantId,
        fkLookup: this.config.fkLookup,
      });
      store.setValidationResult(result);
      store.setStatus({ kind: "confirm_rows" });
    } catch (e) {
      store.setStatus({
        kind: "error",
        error: errString(e),
        phase: "validating",
      });
      throw e;
    }
  }

  async commit(): Promise<void> {
    const store = this.useStore.getState();
    if (!this.config) throw new Error("commit() called before configure().");
    const result = store.validationResult;
    if (!result) throw new Error("commit() called before validate().");

    const ready = computeCommitReady(store);
    const total = ready.committable.length;
    store.setStatus({ kind: "committing", committed: 0, total });

    try {
      const { committed, failed } = await this.config.commit(ready.committable);
      // "flagged" on the complete status means: rows that were originally
      // flagged AND survived the user's resolutions to land in committable
      // — i.e. flagged-then-committed-after-resolve. For a clean import
      // (zero validation flags) this is 0; the previous math conflated it
      // with the total committed count.
      const validCount = result.valid_rows.length;
      const flaggedCommitted = Math.max(0, ready.committable.length - validCount);
      store.setStatus({
        kind: "complete",
        committed,
        flagged: flaggedCommitted,
        rejected: ready.rejected.length + failed,
      });
    } catch (e) {
      store.setStatus({
        kind: "error",
        error: errString(e),
        phase: "committing",
      });
      throw e;
    }
  }

  async runToConfirmMapping(
    file: File | { name: string; bytes: Uint8Array },
  ): Promise<void> {
    await this.parse(file);
    // Multi-sheet input — wait for the caller to pickSheet(). pickSheet()
    // will continue through classify + map on its own.
    const status = this.useStore.getState().status;
    if (status.kind === "confirm_sheet") return;
    await this.classify();
    await this.map();
  }
}

// ============================================================================
// HELPERS — exported for tests + power users
// ============================================================================

export function computeEffectiveMapping(state: FlowState): EffectiveMapping {
  const fromAi: Record<string, string | null> = {};
  if (state.aiMapping) {
    for (const m of state.aiMapping.mappings) {
      fromAi[m.sourceColumn] = m.canonicalField;
    }
  }
  // User overrides win
  const mapping = { ...fromAi, ...state.userOverrides };
  return {
    mapping,
    transformations: state.transformations,
  };
}

/**
 * Build the commit-ready bucket from the validation result + user resolutions:
 *   - Every valid row goes in (no decision needed)
 *   - Every flagged row goes in unless explicitly skipped, with its resolution applied
 *   - Rejected rows are surfaced separately (user has to fix at source)
 */
export function computeCommitReady(state: FlowState): CommitReady {
  const result = state.validationResult;
  if (!result) return { committable: [], skipped: [], rejected: [] };

  const committable: CommittableRow[] = [];
  const skipped: number[] = [];

  for (const v of result.valid_rows) {
    committable.push({
      source_row_index: v.source_row_index,
      canonical: v.canonical,
    });
  }

  for (const f of result.flagged_rows) {
    const res = state.resolutions[f.source_row_index];
    if (!res) {
      // Unresolved — default behaviour is to commit as-is (canonical preserved)
      committable.push({
        source_row_index: f.source_row_index,
        canonical: f.canonical,
      });
      continue;
    }
    if (res.kind === "skip_row") {
      skipped.push(f.source_row_index);
      continue;
    }
    const canonical = applyResolution(f.canonical, f.flags, res);
    committable.push({
      source_row_index: f.source_row_index,
      canonical,
    });
  }

  const rejected = result.rejected_rows.map((r) => ({
    source_row_index: r.source_row_index,
    errors: r.errors,
  }));

  return { committable, skipped, rejected };
}

function applyResolution(
  canonical: Record<string, unknown>,
  flags: Flag[],
  res: FlagResolution,
): Record<string, unknown> {
  if (res.kind === "accept_canonical") return canonical;
  if (res.kind === "set_value") {
    return { ...canonical, [res.field]: res.value };
  }
  if (res.kind === "pick_candidate") {
    // Find the matching flag, replace its field with the chosen value.
    const match = flags.find((f) => f.kind === res.flagKind);
    if (!match) return canonical;
    if (match.kind === "fk_fuzzy_match") {
      return { ...canonical, [match.field]: res.chosen };
    }
    if (match.kind === "date_ambiguous") {
      return { ...canonical, [match.field]: res.chosen };
    }
    return canonical;
  }
  // create_missing_fk + skip_row handled by the orchestrator at commit time
  return canonical;
}

function derivedOverrides(
  aiMapping: import("@eq/ai").MapResult,
  existing: Record<string, string | null>,
): Record<string, string | null> {
  // Seed overrides from AI suggestions but keep any explicit user choices.
  const next: Record<string, string | null> = {};
  for (const m of aiMapping.mappings) {
    next[m.sourceColumn] = m.canonicalField;
  }
  return { ...next, ...existing };
}

/**
 * Route any of CSV / XLSX / PDF / image through the unified parseFile()
 * orchestrator. Format detection uses extension first, then magic bytes,
 * then printable-byte heuristic — see @eq/intake/parse-file.ts.
 *
 * Returns every sheet produced. CSVs always come back as a single-entry
 * array. Multi-sheet XLSX workbooks and multi-page PDFs return one entry
 * each — the driver routes those to confirm_sheet so the user picks one
 * before mapping kicks off. Real SimPRO exports have 5 tabs.
 *
 * Image / scanned-PDF inputs need config.ai + config.schema (the target
 * for vision extraction). parseFile() throws clearly if those are missing,
 * which surfaces to the user as an error-state badge.
 */
async function parseFileByName(
  file: File | { name: string; bytes: Uint8Array },
  config: FlowConfig | undefined,
): Promise<ParsedSheet[]> {
  const bytes = await readBytes(file);
  const result = await parseFile(
    {
      bytes,
      fileName: file.name,
    },
    {
      ai: config?.ai,
      visionTargetSchema: config?.schema,
    },
  );
  if (result.sheets.length === 0) {
    throw new Error(
      `Parser produced no sheets (format detected: ${result.format}). ` +
        `Try a different file or check the source for empty content.`,
    );
  }
  return result.sheets;
}

/**
 * Pull raw bytes from any of:
 *   - A browser File / Blob (uses arrayBuffer())
 *   - Our custom { name, bytes: Uint8Array } shape (test fixtures)
 *
 * Important: do NOT use `"bytes" in file` as a discriminator. Modern browsers
 * (Chrome 121+, Firefox 127+, Safari 17.4+) added a `bytes()` METHOD to Blob,
 * so `"bytes" in file` is true for a real File and `file.bytes` is the method
 * reference — not the actual bytes. Decoding the method as bytes silently
 * produces an empty buffer, which is the bug that made every dropped file
 * parse to zero columns.
 */
async function readBytes(
  file: File | { name: string; bytes: Uint8Array },
): Promise<Uint8Array> {
  // File / Blob always exposes arrayBuffer(). Our custom shape does not.
  const maybeAB = (file as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof maybeAB === "function") {
    return new Uint8Array(await maybeAB.call(file));
  }
  const ours = file as { bytes: unknown };
  // Accept Uint8Array, ArrayBuffer, typed array views, regular number[]
  // (SheetJS returns the latter under some configurations).
  if (ours.bytes instanceof Uint8Array) return ours.bytes;
  if (ours.bytes instanceof ArrayBuffer) return new Uint8Array(ours.bytes);
  if (ArrayBuffer.isView(ours.bytes)) {
    const view = ours.bytes as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Array.isArray(ours.bytes)) {
    return new Uint8Array(ours.bytes as number[]);
  }
  throw new Error(
    "Unsupported file input — expected a browser File/Blob or { name, bytes: Uint8Array | ArrayBuffer | number[] }.",
  );
}

function errString(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Build a CSV of the committable rows for download on the complete screen.
 *
 * The committed batch is the same shape the commit fn was handed —
 * canonical-field-keyed rows plus their original source_row_index so audit
 * matches the source file row-for-row. Returns null when nothing committable
 * is in state (no validation run, or computeCommitReady yields an empty list).
 */
export function buildCommittedCsv(
  state: FlowState,
): { filename: string; content: string } | null {
  const ready = computeCommitReady(state);
  if (ready.committable.length === 0) return null;

  // Collect every canonical field that appears in any row so the CSV header
  // is the union — keeps the output stable when some rows have nullable
  // fields that others fill in.
  const fieldSet = new Set<string>();
  for (const row of ready.committable) {
    for (const k of Object.keys(row.canonical)) fieldSet.add(k);
  }
  const fields = Array.from(fieldSet);
  const header = ["source_row_index", ...fields].map(csvEscape).join(",");

  const lines = [header];
  for (const row of ready.committable) {
    const cells = [
      String(row.source_row_index),
      ...fields.map((f) => stringifyCell(row.canonical[f])),
    ].map(csvEscape);
    lines.push(cells.join(","));
  }

  const sourceName = state.file?.name ?? "committed";
  const stem = sourceName.replace(/\.[^.]+$/, "");
  return {
    filename: `${stem || "committed"}-committed.csv`,
    content: lines.join("\n") + "\n",
  };
}

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** RFC-4180 escaping: wrap in quotes when the value contains comma, quote, or newline. */
function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Used in the spec/UI as a tag for unhandled state branches.
export type { TransformSpec };
