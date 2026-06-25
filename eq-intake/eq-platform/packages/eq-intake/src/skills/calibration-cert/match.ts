/**
 * match.ts — link a calibration cert to an existing register asset.
 *
 * Tiered, most-specific-first. Tolerates the serial drift that exact string
 * matching misses (e.g. a 'C'-prefixed serial on the cert vs the bare serial
 * in the register), and falls back to make+model when the cert carries no
 * usable serial.
 *
 *   1. external_id (asset tag) exact      → high   → update
 *   2. serial exact (normalised)          → high   → update
 *   3. serial fuzzy (prefix/suffix drift) → high   → update
 *   4. make + model present in asset name → medium → confirm
 *   else                                  → —      → create
 *
 * Tier 1 rarely hits on the first batch (the register has no tags stored yet)
 * but is the durable key once the importer backfills external_id — every
 * later cert for the same instrument then matches on it directly.
 *
 * This is the calibration-cert counterpart to `dedup.findExistingDuplicates`,
 * which only does exact serial / external_id+site matching; the fuzzy-serial
 * and make+model tiers here are what calibration reconciliation additionally
 * needs.
 */
import { normaliseSerial } from "./to-canonical.js";
import type {
  CalCertAssetCandidate,
  CalCertMatch,
  CanonicalAssetRef,
} from "./types.js";

const MIN_SERIAL_LEN = 6;
const MIN_MODEL_LEN = 4;
/** Max length delta for a fuzzy serial hit — keeps a short serial from
 *  coincidentally sitting inside an unrelated longer one. Drift is normally a
 *  1–2 char prefix/suffix. */
const MAX_FUZZY_LEN_DELTA = 3;

export function matchCertToAssets(
  candidate: CalCertAssetCandidate,
  assets: CanonicalAssetRef[],
): CalCertMatch {
  // 1. Asset tag (external_id) exact.
  const tag = normaliseSerial(candidate.external_id);
  if (tag) {
    const hit = assets.find((a) => normaliseSerial(a.external_id) === tag);
    if (hit) return mk(hit, "external_id", "high", "update");
  }

  // 2/3. Serial — exact, then fuzzy (prefix/suffix drift).
  const cser = normaliseSerial(candidate.serial_number);
  if (cser.length >= MIN_SERIAL_LEN) {
    const exact = assets.find((a) => {
      const r = normaliseSerial(a.serial_number);
      return r.length >= MIN_SERIAL_LEN && r === cser;
    });
    if (exact) return mk(exact, "serial_exact", "high", "update");

    const fuzzy = assets.find((a) => {
      const r = normaliseSerial(a.serial_number);
      if (r.length < MIN_SERIAL_LEN) return false;
      if (Math.abs(r.length - cser.length) > MAX_FUZZY_LEN_DELTA) return false;
      return r.includes(cser) || cser.includes(r);
    });
    if (fuzzy) return mk(fuzzy, "serial_fuzzy", "high", "update");
  }

  // 4. make + model both present in the asset's free-text name.
  const model = normaliseSerial(candidate.model);
  const make = normaliseSerial(candidate.make);
  if (model.length >= MIN_MODEL_LEN) {
    const hit = assets.find((a) => {
      const n = normaliseSerial(a.name);
      return n.includes(model) && (make === "" || n.includes(make));
    });
    if (hit) return mk(hit, "make_model", "medium", "confirm");
  }

  return { asset_id: null, basis: "none", confidence: "low", action: "create" };
}

function mk(
  a: CanonicalAssetRef,
  basis: CalCertMatch["basis"],
  confidence: CalCertMatch["confidence"],
  action: CalCertMatch["action"],
): CalCertMatch {
  return {
    asset_id: a.asset_id,
    basis,
    confidence,
    action,
    matched_name: a.name ?? null,
    matched_serial: a.serial_number ?? null,
  };
}
