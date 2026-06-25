/**
 * @eq/intake — AI-powered gap filling suggestions
 *
 * suggestGaps() calls the eq-ai-assist Edge Function with a record's available
 * data and its missing fields. Claude Haiku infers likely values where possible
 * and explains why it cannot fill each field when it cannot.
 *
 * Results are guidance, not auto-fill — the operator reviews and applies them.
 */

import type { EdgeFnCaller } from './ai-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GapSuggestion {
  field:             string;
  suggested_value:   string | null;   // null = cannot infer
  confidence:        'high' | 'medium' | 'low';
  reasoning:         string;
}

export interface GapSuggestResult {
  entity:       string;
  record_label: string;
  suggestions:  GapSuggestion[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  return typeof v === 'string' && v.trim() === '';
}

/** Fields to include as context — present, non-blank values only. */
const CONTEXT_FIELDS: Record<string, string[]> = {
  staff:     ['first_name', 'last_name', 'email', 'phone', 'trade'],
  customers: ['company_name', 'first_name', 'last_name', 'email', 'abn', 'suburb', 'state'],
  sites:     ['name', 'address_line_1', 'suburb', 'postcode', 'state'],
  contacts:  ['first_name', 'last_name', 'email', 'company_name'],
  assets:    ['name', 'asset_type', 'make', 'model', 'serial_number'],
  licences:  ['licence_type', 'licence_number', 'state', 'issue_date'],
};

function buildContext(
  entity: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  for (const f of CONTEXT_FIELDS[entity] ?? []) {
    if (!isBlank(row[f])) ctx[f] = row[f];
  }
  return ctx;
}

function recordLabel(entity: string, row: Record<string, unknown>): string {
  if (entity === 'staff' || entity === 'contacts') {
    return `${row['first_name'] ?? ''} ${row['last_name'] ?? ''}`.trim();
  }
  if (entity === 'customers') return String(row['company_name'] ?? '');
  if (entity === 'sites' || entity === 'assets') return String(row['name'] ?? '');
  return entity;
}

// ---------------------------------------------------------------------------
// Public: suggestGaps
// ---------------------------------------------------------------------------

export async function suggestGaps(
  entity:       string,
  row:          Record<string, unknown>,
  missingFields: string[],
  callEdgeFn:   EdgeFnCaller,
): Promise<GapSuggestResult> {
  if (missingFields.length === 0) {
    return { entity, record_label: recordLabel(entity, row), suggestions: [] };
  }

  const context = buildContext(entity, row);

  const response = await callEdgeFn('suggest_gaps', {
    entity,
    context,
    missing_fields: missingFields,
  });

  if (response.error) {
    throw new Error(`Gap suggest failed: ${response.error.message}`);
  }

  const suggestions = response.data as GapSuggestion[] | null;

  return {
    entity,
    record_label: recordLabel(entity, row),
    suggestions:  suggestions ?? [],
  };
}
