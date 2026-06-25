/**
 * Asset duplicate detection.
 *
 * Two passes, both pure of any DB dependency:
 *
 *   detectDuplicates(rows)        — within-batch: two rows in the same import
 *                                   that share a serial_number, or an
 *                                   external_id within the same site_id.
 *   findExistingDuplicates(rows)  — against the DB: a row whose serial_number
 *                                   (or external_id+site_id) already exists.
 *                                   The host supplies the lookup (a Supabase
 *                                   query in production), like fkLookup — the
 *                                   intake package stays DB-free.
 *
 * Findings are surfaced pre-commit so the user chooses skip-or-upsert. For an
 * existing-row match the finding carries the existing asset_id so "update"
 * can stamp it onto the row and let the commit RPC's ON CONFLICT (asset_id)
 * upsert in place instead of inserting a second copy.
 *
 * external_id is only deduped within a site_id — the same equipment number is
 * routinely reused across sites, so a bare external_id collision is not a dup.
 */

export interface DedupRow {
  /** Source row index — preserved through the finding so the caller can match. */
  index: number;
  canonical: Record<string, unknown>;
}

export type DuplicateReason = "serial" | "external_id_site";

export interface DuplicateFinding {
  index: number;
  reason: DuplicateReason;
  matchType: "within_batch" | "existing";
  /** within_batch only: the earlier row index this one duplicates. */
  duplicateOf?: number;
  /** existing only: the asset_id of the DB row to upsert onto. */
  existingAssetId?: string;
  /** The colliding key value (serial number, or external_id), for display. */
  key: string;
}

/** Keys the host should look up against the existing assets table. */
export interface ExistingAssetKey {
  serialNumbers: string[];
  externalIdsBySite: Array<{ site_id: string; external_id: string }>;
}

export interface ExistingAssetMatch {
  asset_id: string;
  serial_number?: string | null;
  external_id?: string | null;
  site_id?: string | null;
}

/** Host-supplied lookup of existing assets matching the given keys. */
export type DupLookup = (keys: ExistingAssetKey) => Promise<ExistingAssetMatch[]>;

function norm(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s.toLowerCase();
}

/** site-scoped external_id key, or null when either part is missing. */
function extKey(siteId: unknown, externalId: unknown): string | null {
  const s = norm(siteId);
  const e = norm(externalId);
  if (s === null || e === null) return null;
  return `${s}::${e}`;
}

/**
 * Within-batch duplicates. Each later row that collides with an earlier one
 * gets a finding pointing back at the first occurrence. The first occurrence
 * itself is never flagged.
 */
export function detectDuplicates(rows: DedupRow[]): DuplicateFinding[] {
  const findings: DuplicateFinding[] = [];
  const serialSeen = new Map<string, number>();
  const extSeen = new Map<string, number>();

  for (const row of rows) {
    const serial = norm(row.canonical["serial_number"]);
    if (serial !== null) {
      const first = serialSeen.get(serial);
      if (first !== undefined) {
        findings.push({
          index: row.index,
          reason: "serial",
          matchType: "within_batch",
          duplicateOf: first,
          key: String(row.canonical["serial_number"]),
        });
        continue; // one within-batch finding per row; serial is the stronger signal
      }
      serialSeen.set(serial, row.index);
    }

    const ext = extKey(row.canonical["site_id"], row.canonical["external_id"]);
    if (ext !== null) {
      const first = extSeen.get(ext);
      if (first !== undefined) {
        findings.push({
          index: row.index,
          reason: "external_id_site",
          matchType: "within_batch",
          duplicateOf: first,
          key: String(row.canonical["external_id"]),
        });
        continue;
      }
      extSeen.set(ext, row.index);
    }
  }

  return findings;
}

/**
 * Against-existing duplicates. Collects the distinct keys present in the batch,
 * asks the host to look them up, and matches each row back. Serial wins over
 * external_id when a row matches both (it's the more specific identity).
 */
export async function findExistingDuplicates(
  rows: DedupRow[],
  lookup: DupLookup,
): Promise<DuplicateFinding[]> {
  const serials = new Set<string>();
  const extPairs = new Map<string, { site_id: string; external_id: string }>();

  for (const row of rows) {
    const serialRaw = row.canonical["serial_number"];
    const serial = norm(serialRaw);
    if (serial !== null) serials.add(String(serialRaw).trim());

    const siteRaw = row.canonical["site_id"];
    const extRaw = row.canonical["external_id"];
    if (extKey(siteRaw, extRaw) !== null) {
      const key = extKey(siteRaw, extRaw)!;
      extPairs.set(key, {
        site_id: String(siteRaw).trim(),
        external_id: String(extRaw).trim(),
      });
    }
  }

  if (serials.size === 0 && extPairs.size === 0) return [];

  const matches = await lookup({
    serialNumbers: Array.from(serials),
    externalIdsBySite: Array.from(extPairs.values()),
  });

  const bySerial = new Map<string, string>();
  const byExt = new Map<string, string>();
  for (const m of matches) {
    const serial = norm(m.serial_number);
    if (serial !== null) bySerial.set(serial, m.asset_id);
    const ext = extKey(m.site_id, m.external_id);
    if (ext !== null) byExt.set(ext, m.asset_id);
  }

  const findings: DuplicateFinding[] = [];
  for (const row of rows) {
    const serial = norm(row.canonical["serial_number"]);
    if (serial !== null && bySerial.has(serial)) {
      findings.push({
        index: row.index,
        reason: "serial",
        matchType: "existing",
        existingAssetId: bySerial.get(serial)!,
        key: String(row.canonical["serial_number"]),
      });
      continue;
    }
    const ext = extKey(row.canonical["site_id"], row.canonical["external_id"]);
    if (ext !== null && byExt.has(ext)) {
      findings.push({
        index: row.index,
        reason: "external_id_site",
        matchType: "existing",
        existingAssetId: byExt.get(ext)!,
        key: String(row.canonical["external_id"]),
      });
    }
  }

  return findings;
}
