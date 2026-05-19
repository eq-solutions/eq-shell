/**
 * Derive profile registry.
 *
 * Adding a new profile = create a single file under `profiles/` and register
 * it here. The HTTP layer in `../server.ts` dispatches by id.
 */

import type { DeriveProfile } from './types';
import { bomProfile } from './profiles/bom';
import { deviceRegisterProfile } from './profiles/device-register';
import { labourSummaryProfile } from './profiles/labour-summary';

const profiles: Map<string, DeriveProfile> = new Map();

function register(p: DeriveProfile): void {
  if (profiles.has(p.id)) {
    throw new Error(`Duplicate derive profile id: ${p.id}`);
  }
  profiles.set(p.id, p);
}

register(bomProfile);
register(deviceRegisterProfile);
register(labourSummaryProfile);
// Future: register(ppmSowProfile);           // item 7

export function getProfile(id: string): DeriveProfile | undefined {
  return profiles.get(id);
}

export function listProfiles(): DeriveProfile[] {
  return [...profiles.values()];
}
