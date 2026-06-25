/**
 * @eq/intake — fuzzy duplicate detection
 *
 * detectDuplicates() clusters records within an entity that are too similar
 * to be distinct real-world entries. Uses Dice coefficient on character
 * bigrams — handles abbreviations, missing punctuation, and legal suffix
 * differences better than token overlap alone.
 *
 * Clusters are surfaced in the health home so operators can review before
 * committing further data. No auto-merge — that requires human confirmation.
 */

import {
  normaliseCompanyName,
  normalisePersonName,
  normaliseAbn,
} from './normalize.js';
import type { SupabaseLikeClient } from './canonical/commit-canonical.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DuplicateCluster {
  entity:      string;
  record_ids:  string[];    // PK values (e.g. staff_id, customer_id)
  labels:      string[];    // human-readable display names
  similarity:  number;      // highest pair-wise similarity (0–1)
  match_field: string;      // field that triggered the match
  confidence:  'high' | 'medium';
}

export interface DuplicateReport {
  entity:         string;
  clusters:       DuplicateCluster[];
  total_records:  number;
  affected:       number;  // distinct records appearing in at least one cluster
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const HIGH_SIM   = 0.85;
const MEDIUM_SIM = 0.65;

// ---------------------------------------------------------------------------
// Bigram Dice coefficient
// ---------------------------------------------------------------------------

function bigrams(s: string): Set<string> {
  const bg = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2));
  return bg;
}

function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bA = bigrams(a);
  const bB = bigrams(b);
  let matches = 0;
  bA.forEach((bg) => { if (bB.has(bg)) matches++; });
  return (2 * matches) / (bA.size + bB.size);
}

// ---------------------------------------------------------------------------
// Entity-specific normalisation and keying
// ---------------------------------------------------------------------------

type EntityRow = Record<string, unknown>;

const PK: Record<string, string> = {
  staff:     'staff_id',
  customers: 'customer_id',
  sites:     'site_id',
  contacts:  'first_name',   // contacts table has no clean single-col PK from RPC
  assets:    'name',
};

function labelFor(entity: string, row: EntityRow): string {
  if (entity === 'staff' || entity === 'contacts') {
    return `${row['first_name'] ?? ''} ${row['last_name'] ?? ''}`.trim();
  }
  if (entity === 'customers') return String(row['company_name'] ?? '');
  if (entity === 'sites' || entity === 'assets') return String(row['name'] ?? '');
  return String(row[PK[entity] ?? 'id'] ?? '');
}

type Candidate = {
  id:           string;
  label:        string;
  key_primary:  string;   // main comparison string
  key_abn?:     string;   // secondary: ABN (for customers)
  key_serial?:  string;   // secondary: serial number (for assets)
};

function buildCandidates(entity: string, rows: EntityRow[]): Candidate[] {
  return rows
    .filter((r) => r['active'] !== false)
    .map((row) => {
      const id    = String(row[PK[entity] ?? 'id'] ?? '');
      const label = labelFor(entity, row);

      if (entity === 'customers') {
        return {
          id,
          label,
          key_primary: normaliseCompanyName(String(row['company_name'] ?? '')),
          key_abn:     row['abn'] ? normaliseAbn(String(row['abn'])) : undefined,
        };
      }
      if (entity === 'staff' || entity === 'contacts') {
        return {
          id,
          label,
          key_primary: normalisePersonName(
            String(row['first_name'] ?? ''),
            String(row['last_name'] ?? ''),
          ),
        };
      }
      if (entity === 'sites') {
        const name    = String(row['name'] ?? '').toLowerCase().trim();
        const address = String(row['address_line_1'] ?? '').toLowerCase().trim();
        return {
          id,
          label,
          key_primary: address ? `${name} ${address}` : name,
        };
      }
      if (entity === 'assets') {
        return {
          id,
          label,
          key_primary: String(row['name'] ?? '').toLowerCase().trim(),
          key_serial:  row['serial_number']
            ? String(row['serial_number']).toLowerCase().replace(/\s/g, '')
            : undefined,
        };
      }
      return { id, label, key_primary: label.toLowerCase() };
    })
    .filter((c) => c.key_primary.length >= 2);
}

// ---------------------------------------------------------------------------
// Pair-wise clustering with union-find
// ---------------------------------------------------------------------------

function findCluster(parent: Map<string, string>, id: string): string {
  let root = id;
  while (parent.has(root)) root = parent.get(root)!;
  // Path compression
  let cur = id;
  while (parent.has(cur)) {
    const next = parent.get(cur)!;
    parent.set(cur, root);
    cur = next;
  }
  return root;
}

function union(parent: Map<string, string>, a: string, b: string): void {
  const ra = findCluster(parent, a);
  const rb = findCluster(parent, b);
  if (ra !== rb) parent.set(ra, rb);
}

// ---------------------------------------------------------------------------
// Public: detectDuplicates (one entity)
// ---------------------------------------------------------------------------

function detectForEntity(entity: string, rows: EntityRow[]): DuplicateReport {
  const candidates = buildCandidates(entity, rows);
  const parent     = new Map<string, string>();

  // Track highest similarity + matching field for each pair
  const pairSim   = new Map<string, number>();
  const pairField = new Map<string, string>();

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;

      let sim   = 0;
      let field = 'name';

      // ABN exact match — strongest signal for customers
      if (a.key_abn && b.key_abn && a.key_abn.length >= 11 && a.key_abn === b.key_abn) {
        sim   = 1.0;
        field = 'abn';
      }
      // Serial number exact match — strongest signal for assets
      else if (
        a.key_serial &&
        b.key_serial &&
        a.key_serial.length >= 3 &&
        a.key_serial === b.key_serial
      ) {
        sim   = 1.0;
        field = 'serial_number';
      }
      // Primary key fuzzy match
      else if (a.key_primary && b.key_primary) {
        sim   = dice(a.key_primary, b.key_primary);
        field = entity === 'customers' ? 'company_name' :
                entity === 'sites'     ? 'name+address' :
                'full_name';
      }

      if (sim >= MEDIUM_SIM) {
        const key = `${a.id}:${b.id}`;
        pairSim.set(key, sim);
        pairField.set(key, field);
        union(parent, a.id, b.id);
      }
    }
  }

  // Build clusters from union-find
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const root = findCluster(parent, c.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(c);
  }

  const clusters: DuplicateCluster[] = [];
  const affectedIds = new Set<string>();

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // Find highest similarity and match field among all pairs in the group
    let highestSim = 0;
    let matchField = '';

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const key = `${group[i]!.id}:${group[j]!.id}`;
        const s   = pairSim.get(key) ?? 0;
        if (s > highestSim) {
          highestSim = s;
          matchField = pairField.get(key) ?? '';
        }
      }
    }

    group.forEach((c) => affectedIds.add(c.id));

    clusters.push({
      entity,
      record_ids:  group.map((c) => c.id),
      labels:      group.map((c) => c.label),
      similarity:  highestSim,
      match_field: matchField,
      confidence:  highestSim >= HIGH_SIM ? 'high' : 'medium',
    });
  }

  // Sort by similarity desc (highest confidence duplicates first)
  clusters.sort((a, b) => b.similarity - a.similarity);

  return {
    entity,
    clusters,
    total_records: candidates.length,
    affected:      affectedIds.size,
  };
}

// ---------------------------------------------------------------------------
// Public: detectAllDuplicates
// ---------------------------------------------------------------------------

type RpcClient = {
  rpc: (name: string, params: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const ENTITIES = ['staff', 'customers', 'sites', 'contacts', 'assets'] as const;

export async function detectAllDuplicates(
  supabase: SupabaseLikeClient,
): Promise<DuplicateReport[]> {
  const client = supabase as unknown as RpcClient;

  const results = await Promise.all(
    ENTITIES.map((entity) =>
      client
        .rpc('eq_tidy_read_entity', { p_table: entity })
        .then((r) => ({ entity, ...r })),
    ),
  );

  return results.map(({ entity, data: rawData }) => {
    const rows = (rawData as EntityRow[] | null) ?? [];
    return detectForEntity(entity, rows);
  });
}
