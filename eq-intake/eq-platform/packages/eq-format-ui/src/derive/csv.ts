/**
 * CSV utilities shared by all derive profiles.
 *
 * The algorithm mirrors `demos/simpro-quote-781/parse.mjs`. If you change
 * the parsing or escape rules here, also review the demo for parity — the
 * demo deliberately has zero deps and reproduces the same logic in JS.
 */

/**
 * Parse CSV text into header + rows. Handles double-quoted fields with
 * embedded commas and `""` escape. Strips BOM if present. Discards
 * blank lines.
 */
export function parseCsv(text: string): {
  header: string[];
  rows: Record<string, string>[];
} {
  let body = text;
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);
  const lines = body
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { header: [], rows: [] };

  const parseRow = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') {
          inQ = false;
        } else {
          cur += c;
        }
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') {
          out.push(cur);
          cur = '';
        } else cur += c;
      }
    }
    out.push(cur);
    return out;
  };

  const header = parseRow(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = parseRow(line);
    const r: Record<string, string> = {};
    header.forEach((h, i) => {
      r[h] = (cells[i] ?? '').trim();
    });
    return r;
  });
  return { header, rows };
}

/**
 * Serialize columns + rows to RFC4180-style CSV with a UTF-8 BOM prefix.
 * The BOM (0xEF 0xBB 0xBF) tells Excel to open the file as UTF-8 instead
 * of Windows-1252, which otherwise mangles accented characters and em dashes.
 * Use this for any CSV that a human will open directly in Excel or Outlook.
 */
export function encodeCsv(columns: string[], rows: Record<string, unknown>[]): string {
  return '﻿' + toCsv(columns, rows);
}

/**
 * Serialize columns + rows to RFC4180-style CSV. Quotes any cell containing
 * a comma, double-quote, or newline; escapes embedded double-quotes by
 * doubling them. Trailing newline included.
 */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const escape = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const out: string[] = [columns.join(',')];
  for (const r of rows) out.push(columns.map((h) => escape(r[h])).join(','));
  return out.join('\n') + '\n';
}

/**
 * Parse a numeric string tolerantly. Strips currency markers ($), thousands
 * separators (,) and whitespace. Empty/null/unparseable inputs return 0,
 * matching the demo's behaviour.
 */
export function num(s: unknown): number {
  if (s == null || s === '') return 0;
  return Number(String(s).replace(/[$,\s]/g, '')) || 0;
}
