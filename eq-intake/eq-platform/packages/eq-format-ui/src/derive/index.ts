/**
 * Derive (reshape-out) module — public API.
 *
 * Takes input rows in a known shape, dispatches to a registered profile,
 * returns columns + rows. CSV serialization is the caller's job (use
 * `toCsv` from `./csv` if needed).
 */

export type { DeriveProfile, DeriveOutput, DeriveInputShape } from './types';
export { getProfile, listProfiles } from './registry';
export { toCsv, parseCsv, num } from './csv';

import { getProfile } from './registry';
import type { DeriveOutput } from './types';

/** Run a derive profile by id. Throws if the profile is unknown. */
export function derive(profileId: string, rows: Record<string, unknown>[]): DeriveOutput {
  const profile = getProfile(profileId);
  if (!profile) {
    throw new Error(`Unknown derive profile: ${profileId}`);
  }
  return profile.derive(rows);
}
