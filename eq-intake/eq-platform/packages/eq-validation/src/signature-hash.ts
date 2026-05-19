/**
 * @eq/validation — signature hash for intake template caching
 *
 * Produces a stable hash from the *shape* of a source file (column names +
 * representative sample values + target entity). Used by the orchestrator to
 * look up a previously-confirmed mapping in eq_intake_templates BEFORE invoking
 * AI mapping. Cache hit = zero AI cost, sub-second mapping.
 *
 * Design goals:
 *   1. Stable across re-imports of the same file shape (whitespace, casing,
 *      column order do NOT change the hash)
 *   2. Sensitive enough to detect genuine shape changes (new/missing columns,
 *      different sample-value patterns indicating a different source system)
 *   3. SHA-256 to make collisions astronomically unlikely
 *   4. No PII in the hash itself — only structural fingerprints
 *
 * Algorithm:
 *   1. Normalise column names: lowercase, trim, strip non-alphanumeric
 *   2. Sort normalised column names
 *   3. For each column, compute a "value pattern fingerprint" from the first
 *      N sample values (regex pattern, not the actual values — protects PII):
 *        - all numeric? → 'N'
 *        - all dates? → 'D'
 *        - all emails? → 'E'
 *        - all booleans? → 'B'
 *        - all short strings? → 'S'
 *        - mixed? → 'X'
 *        - empty? → '_'
 *   4. Concatenate: entity + '|' + sorted normalised columns + '|' + value patterns
 *   5. SHA-256 the result, return hex
 *
 * The resulting hash is stable for "same file shape from same source system"
 * and unstable for genuinely different shapes.
 */

// Node 18+ has crypto.subtle. For older runtimes, fall back to crypto module.
async function sha256Hex(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const data = new TextEncoder().encode(input);
    const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Node fallback
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(input).digest('hex');
}

interface SignatureInput {
  /** Target canonical entity name e.g. 'staff' */
  entity: string;
  /** Source columns in original order */
  columns: string[];
  /** Sample rows (object form, keyed by source column name) */
  sampleRows: Record<string, unknown>[];
  /** Number of sample rows to use for fingerprinting. Default 10. */
  sampleSize?: number;
}

const NORMALISE = /[^a-z0-9]/g;

const NUMERIC = /^-?\d+(?:[.,]\d+)?$/;
const DATE_AU = /^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})$/;
const DATE_ISO = /^\d{4}-\d{2}-\d{2}/;
const EXCEL_SERIAL = /^[1-9]\d{3,4}(?:\.\d+)?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOOLEAN = /^(true|false|yes|no|y|n|1|0|t|f|x|active|inactive)$/i;
const PHONE_AU = /^(\+?61|0)\d{9}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function classifyValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '_';
  const s = String(v).trim();
  if (s === '') return '_';
  if (UUID.test(s)) return 'U';
  if (EMAIL.test(s)) return 'E';
  if (DATE_ISO.test(s) || DATE_AU.test(s)) return 'D';
  if (PHONE_AU.test(s.replace(/[\s().\-]/g, ''))) return 'P';
  if (BOOLEAN.test(s)) return 'B';
  if (NUMERIC.test(s)) return 'N';
  if (EXCEL_SERIAL.test(s)) return 'N';
  if (s.length > 80) return 'L'; // long string
  return 'S';
}

function columnFingerprint(values: unknown[]): string {
  if (values.length === 0) return '_';
  const classes = values.map(classifyValue);
  // Find dominant class
  const counts: Record<string, number> = {};
  for (const c of classes) counts[c] = (counts[c] ?? 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1]! - a[1]!);
  const top = sorted[0]!;
  // If dominant class >70% of values, return it; else 'X' for mixed
  if (top[1] / classes.length >= 0.7) return top[0];
  return 'X';
}

export async function computeSignatureHash(input: SignatureInput): Promise<string> {
  const sampleSize = input.sampleSize ?? 10;
  const sample = input.sampleRows.slice(0, sampleSize);

  // Map original column → normalised column
  const normalised = input.columns.map((c) => ({
    original: c,
    normalised: c.toLowerCase().replace(NORMALISE, ''),
  }));

  // Sort by normalised name for stability across column-order changes
  normalised.sort((a, b) => a.normalised.localeCompare(b.normalised));

  // Compute fingerprint per column
  const parts: string[] = [];
  for (const { original, normalised: norm } of normalised) {
    const values = sample.map((row) => row[original]);
    const fp = columnFingerprint(values);
    parts.push(`${norm}:${fp}`);
  }

  const hashable = `${input.entity.toLowerCase()}|${parts.join('|')}`;
  return sha256Hex(hashable);
}

/** Convenience: returns the hash plus a debug-friendly representation of what went into it. */
export async function computeSignatureHashWithDebug(input: SignatureInput): Promise<{
  hash: string;
  fingerprint: string;
}> {
  const sampleSize = input.sampleSize ?? 10;
  const sample = input.sampleRows.slice(0, sampleSize);

  const normalised = input.columns.map((c) => ({
    original: c,
    normalised: c.toLowerCase().replace(NORMALISE, ''),
  }));
  normalised.sort((a, b) => a.normalised.localeCompare(b.normalised));

  const parts: string[] = [];
  for (const { original, normalised: norm } of normalised) {
    const values = sample.map((row) => row[original]);
    const fp = columnFingerprint(values);
    parts.push(`${norm}:${fp}`);
  }

  const fingerprint = `${input.entity.toLowerCase()}|${parts.join('|')}`;
  const hash = await sha256Hex(fingerprint);
  return { hash, fingerprint };
}
