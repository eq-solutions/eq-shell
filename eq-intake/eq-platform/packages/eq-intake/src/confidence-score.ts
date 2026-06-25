/**
 * @eq/intake — per-row confidence scoring
 *
 * scoreRow() returns a 0–1 confidence score for a single canonical record.
 * Deductions come from two sources:
 *   - Missing required / quality fields (completeness)
 *   - Invalid format for ABN, phone, state, postcode (format validation)
 *
 * scoreRows() aggregates across a full entity set.
 */

import {
  isValidAbn,
  isValidAuPhone,
  isValidAuState,
  isValidAuPostcode,
} from './normalize.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RowConfidence {
  score:  number;    // 0–1
  issues: string[];  // human-readable reasons for deductions
}

export interface EntityConfidenceSummary {
  entity:          string;
  avg_score:       number;
  low_confidence:  number;  // rows with score < 0.70
  scores:          RowConfidence[];
}

// ---------------------------------------------------------------------------
// Field maps (verified against app_data schema 2026-06-24)
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: Record<string, string[]> = {
  staff:     ['first_name', 'last_name'],
  customers: ['company_name'],
  sites:     ['name'],
  contacts:  ['first_name', 'last_name'],
  assets:    ['name', 'asset_type'],
  licences:  ['licence_type'],
};

const QUALITY_FIELDS: Record<string, string[]> = {
  staff:     ['email', 'phone', 'trade', 'emergency_contact_name'],
  customers: ['email', 'primary_phone', 'abn', 'suburb', 'state'],
  sites:     ['address_line_1', 'suburb', 'state', 'postcode', 'customer_id'],
  contacts:  ['email', 'work_phone'],
  assets:    ['serial_number', 'make', 'model', 'site_id'],
  licences:  ['licence_number', 'expiry_date', 'staff_id'],
};

// Phone field name varies per entity
const PHONE_FIELD: Record<string, string> = {
  customers: 'primary_phone',
  contacts:  'work_phone',
  staff:     'phone',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  return typeof v === 'string' && v.trim() === '';
}

// ---------------------------------------------------------------------------
// Public: scoreRow
// ---------------------------------------------------------------------------

export function scoreRow(
  entity: string,
  row: Record<string, unknown>,
): RowConfidence {
  const issues: string[] = [];
  let score = 1.0;

  // Required fields: 0.20 deduction each, no cap
  for (const f of REQUIRED_FIELDS[entity] ?? []) {
    if (isBlank(row[f])) {
      score -= 0.20;
      issues.push(`Required field "${f}" is missing`);
    }
  }

  // Quality fields: 0.05 deduction each, max 0.30 total
  let qualityHit = 0;
  for (const f of QUALITY_FIELDS[entity] ?? []) {
    if (isBlank(row[f])) {
      if (qualityHit < 0.30) {
        qualityHit += 0.05;
        score -= 0.05;
      }
      issues.push(`"${f}" is empty`);
    }
  }

  // Format: ABN checksum (-0.15)
  const abn = row['abn'];
  if (!isBlank(abn) && typeof abn === 'string' && !isValidAbn(abn)) {
    score -= 0.15;
    issues.push(`ABN "${abn}" fails checksum`);
  }

  // Format: phone (-0.10)
  const phoneField = PHONE_FIELD[entity];
  if (phoneField) {
    const phone = row[phoneField];
    if (!isBlank(phone) && typeof phone === 'string' && !isValidAuPhone(phone)) {
      score -= 0.10;
      issues.push(`Phone "${phone}" is not a valid Australian number`);
    }
  }

  // Format: state (-0.05)
  const state = row['state'];
  if (!isBlank(state) && typeof state === 'string' && !isValidAuState(state)) {
    score -= 0.05;
    issues.push(`State "${state}" is not a recognised Australian state code`);
  }

  // Format: postcode (-0.05)
  const postcode = row['postcode'];
  if (!isBlank(postcode) && typeof postcode === 'string' && !isValidAuPostcode(postcode)) {
    score -= 0.05;
    issues.push(`Postcode "${postcode}" is not a valid 4-digit code`);
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

// ---------------------------------------------------------------------------
// Public: scoreRows (aggregate)
// ---------------------------------------------------------------------------

export function scoreRows(
  entity: string,
  rows: Record<string, unknown>[],
): EntityConfidenceSummary {
  const scores = rows.map((r) => scoreRow(entity, r));
  const avg_score =
    scores.length > 0
      ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
      : 1;
  const low_confidence = scores.filter((s) => s.score < 0.7).length;
  return { entity, avg_score, low_confidence, scores };
}
