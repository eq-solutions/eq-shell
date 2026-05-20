// SKS Smartsheet tender XLSX parser + DB diff helper.
//
// TypeScript port of eq-solves-field/scripts/tender-parser.js (vanilla
// IIFE, ~346 lines). Behaviour is identical — only the module boundary
// changes (window.EQ_TENDER_PARSER → ESM exports) and types are added.
//
// SheetJS via the `xlsx` npm package (bundled). The vanilla loads it
// from cdnjs at 0.18.5; here it ships in the lazy Import chunk.
//
// Reference (vanilla):
//   eq-solves-field/scripts/tender-parser.js  (whole file)

import * as XLSX from 'xlsx';

// ============================================================================
// Types
// ============================================================================

export type PipelineStage = 'tracked' | 'watch' | 'likely' | 'won' | 'lost';

export interface TenderRow {
  external_ref: string;
  job_name: string | null;
  client: string | null;
  estimator: string | null;
  vertical: string | null;
  department: string | null;
  entity: string | null;
  site_address: string | null;
  quote_value: number | null;
  due_date: string | null;
  tender_status: string | null;
  probability_pct: number | null;
  probability_label: string | null;
  stage: PipelineStage;
  below_threshold: boolean;
  _row_index: number;
}

export interface ExistingTender {
  external_ref: string;
  probability_pct: number | null;
  quote_value: number | null;
  // Optional fields the diff doesn't read but consumers may pass through.
  stage?: PipelineStage;
  job_name?: string | null;
}

export interface RowWithPrevious extends TenderRow {
  previous: ExistingTender;
}

export interface ImportDiff {
  new: TenderRow[];
  stageChanged: RowWithPrevious[];
  valueChanged: RowWithPrevious[];
  unchanged: TenderRow[];
  missing: ExistingTender[];
}

export interface ImportSummary {
  rows_total: number;
  rows_new: number;
  rows_stage_changed: number;
  rows_value_changed: number;
  rows_missing: number;
  rows_below_threshold: number;
}

export interface ParseError {
  severity: 'fatal' | 'warning';
  message: string;
  rowIndex?: number;
}

export interface ParseResult {
  rows: TenderRow[];
  errors: ParseError[];
}

export interface ParseOptions {
  valueFloor?: number;
}

// ============================================================================
// Column mapping — column header → tender field
// Fatal error if any required column missing.
// ============================================================================

export const COLUMN_MAP: Record<string, keyof TenderRow | '_probability_raw'> = {
  'SITE / JOB NAME':      'job_name',
  'SKS Quote No':         'external_ref',
  'Due Date':             'due_date',
  'Status':               'tender_status',
  'Project $ Amount':     'quote_value',
  'SKS Estimator':        'estimator',
  'Builder/Client Name':  'client',
  'Market Vertical':      'vertical',
  'SKS Dept':             'department',
  'Site Address':         'site_address',
  'SKS Entity':           'entity',
  'Probability':          '_probability_raw',
};

export const REQUIRED_COLUMNS: readonly string[] = Object.keys(COLUMN_MAP);

// ============================================================================
// probabilityToStage — probability % → pipeline_stage enum value
// ============================================================================

export function probabilityToStage(pct: number | null | undefined): PipelineStage {
  if (pct === null || pct === undefined) return 'tracked';
  if (pct === 100) return 'won';
  if (pct >= 70)   return 'likely';
  if (pct >= 50)   return 'watch';
  return 'tracked';
}

// ============================================================================
// parseProbability — "70% - In Negotiation" → { pct: 70, label: "..." }
// ============================================================================

export function parseProbability(raw: unknown): { pct: number | null; label: string | null } {
  if (raw === null || raw === undefined || raw === '') {
    return { pct: null, label: null };
  }
  const str = String(raw).trim();
  const match = str.match(/^(\d{1,3})\s*%/);
  if (!match) return { pct: null, label: str };
  const pct = parseInt(match[1], 10);
  if (pct < 0 || pct > 100) return { pct: null, label: str };
  return { pct, label: str };
}

// ============================================================================
// excelSerialToIsoDate — Excel serial / Date / ISO string → "YYYY-MM-DD"
// Excel epoch is 1899-12-30 (accounts for the 1900 leap-year bug).
// SheetJS with cellDates:true returns Date objects, but Smartsheet
// exports often arrive as raw serial numbers — handle both.
// ============================================================================

export function excelSerialToIsoDate(serial: unknown): string | null {
  if (serial === null || serial === undefined || serial === '') return null;
  if (serial instanceof Date && !isNaN(serial.getTime())) {
    return serial.toISOString().slice(0, 10);
  }
  if (typeof serial === 'string') {
    const d = new Date(serial);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  if (typeof serial === 'number' && serial > 0) {
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + serial * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

// ============================================================================
// parseQuoteValue — handles blanks, "0", "$65,000", numeric strings
// ============================================================================

export function parseQuoteValue(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return raw === 0 ? null : raw;
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[$,\s]/g, '');
    if (cleaned === '' || cleaned === '0') return null;
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }
  return null;
}

// ============================================================================
// normaliseExternalRef — "SKS - 16404" → "SKS-16404"
// Strip whitespace, uppercase, single dash. Idempotent join key.
// ============================================================================

export function normaliseExternalRef(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  return String(raw).trim().toUpperCase().replace(/\s*-\s*/g, '-');
}

// ============================================================================
// parseTenderXlsx — xlsx file (or ArrayBuffer) → { rows, errors }
// ============================================================================

function trimOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export async function parseTenderXlsx(
  file: File | Blob | ArrayBuffer,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const valueFloor = options.valueFloor ?? 100_000;
  const errors: ParseError[] = [];
  const rows: TenderRow[] = [];

  let buffer: ArrayBuffer;
  if (file instanceof ArrayBuffer) {
    buffer = file;
  } else if (file && typeof (file as Blob).arrayBuffer === 'function') {
    buffer = await (file as Blob).arrayBuffer();
  } else {
    return {
      rows: [],
      errors: [{ severity: 'fatal', message: 'parseTenderXlsx expected a File, Blob, or ArrayBuffer.' }],
    };
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { cellDates: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      rows: [],
      errors: [{ severity: 'fatal', message: `Could not read xlsx: ${message}` }],
    };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errors: [{ severity: 'fatal', message: 'No sheets found in file' }] };
  }
  const sheet = workbook.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });

  if (jsonRows.length === 0) {
    return { rows: [], errors: [{ severity: 'fatal', message: 'Sheet is empty' }] };
  }

  // Validate required columns
  const firstRow = jsonRows[0];
  const presentColumns = Object.keys(firstRow);
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !presentColumns.includes(c));
  if (missingColumns.length > 0) {
    return {
      rows: [],
      errors: [{ severity: 'fatal', message: `Missing required columns: ${missingColumns.join(', ')}` }],
    };
  }

  jsonRows.forEach((row, index) => {
    const externalRef = normaliseExternalRef(row['SKS Quote No']);
    if (!externalRef) {
      errors.push({
        severity: 'warning',
        rowIndex: index,
        message: `Row ${index + 2}: missing SKS Quote No, skipping`,
      });
      return;
    }

    const prob = parseProbability(row['Probability']);
    const quoteValue = parseQuoteValue(row['Project $ Amount']);
    const dueDate = excelSerialToIsoDate(row['Due Date']);

    rows.push({
      external_ref:      externalRef,
      job_name:          trimOrNull(row['SITE / JOB NAME']),
      client:            trimOrNull(row['Builder/Client Name']),
      estimator:         trimOrNull(row['SKS Estimator']),
      vertical:          trimOrNull(row['Market Vertical']),
      department:        trimOrNull(row['SKS Dept']),
      entity:            trimOrNull(row['SKS Entity']),
      site_address:      trimOrNull(row['Site Address']),
      quote_value:       quoteValue,
      due_date:          dueDate,
      tender_status:     trimOrNull(row['Status']),
      probability_pct:   prob.pct,
      probability_label: prob.label,
      stage:             probabilityToStage(prob.pct),
      below_threshold:   quoteValue === null || quoteValue < valueFloor,
      _row_index:        index + 2,
    });
  });

  return { rows, errors };
}

// ============================================================================
// diffAgainstExisting — parsed rows vs DB rows
// ============================================================================

export function diffAgainstExisting(
  parsedRows: TenderRow[],
  existing: ExistingTender[],
): ImportDiff {
  const existingByRef = new Map<string, ExistingTender>();
  existing.forEach((e) => existingByRef.set(e.external_ref, e));

  const parsedRefs = new Set<string>();
  parsedRows.forEach((r) => parsedRefs.add(r.external_ref));

  const diff: ImportDiff = {
    new: [],
    stageChanged: [],
    valueChanged: [],
    unchanged: [],
    missing: [],
  };

  parsedRows.forEach((row) => {
    const prev = existingByRef.get(row.external_ref);
    if (!prev) {
      diff.new.push(row);
      return;
    }

    const prevPct = prev.probability_pct ?? null;
    const rowPct  = row.probability_pct  ?? null;
    const prevVal = prev.quote_value     ?? null;
    const rowVal  = row.quote_value      ?? null;

    const stageChanged = prevPct !== rowPct;
    const valueChanged = prevVal !== rowVal;

    if (stageChanged && valueChanged) {
      diff.stageChanged.push({ ...row, previous: prev });
      diff.valueChanged.push({ ...row, previous: prev });
    } else if (stageChanged) {
      diff.stageChanged.push({ ...row, previous: prev });
    } else if (valueChanged) {
      diff.valueChanged.push({ ...row, previous: prev });
    } else {
      diff.unchanged.push(row);
    }
  });

  existing.forEach((prev) => {
    if (!parsedRefs.has(prev.external_ref)) {
      diff.missing.push(prev);
    }
  });

  return diff;
}

// ============================================================================
// summariseImport — counts for the tender_import_runs row
// ============================================================================

export function summariseImport(diff: ImportDiff, parsedRows: TenderRow[]): ImportSummary {
  return {
    rows_total:            parsedRows.length,
    rows_new:              diff.new.length,
    rows_stage_changed:    diff.stageChanged.length,
    rows_value_changed:    diff.valueChanged.length,
    rows_missing:          diff.missing.length,
    rows_below_threshold:  parsedRows.filter((r) => r.below_threshold).length,
  };
}
