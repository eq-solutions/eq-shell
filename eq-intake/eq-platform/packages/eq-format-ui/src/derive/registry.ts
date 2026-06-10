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
import { equinixAssetRegisterProfile } from './profiles/equinix-asset-register';
import { equinixContractorProfile } from './profiles/equinix-contractor';
import { xeroPayrollTimesheetsProfile } from './profiles/xero-payroll-timesheets';
import { myobPayrollTimesheetsProfile } from './profiles/myob-payroll-timesheets';
import { equinixAuditSimproProfile } from './profiles/equinix-audit-simpro';
import { ppmSowProfile } from './profiles/ppm-sow';
import { assetRegisterExportProfile } from './profiles/asset-register-export';
import { siteRegisterExportProfile } from './profiles/site-register-export';
import { serviceVisitScheduleProfile } from './profiles/service-visit-schedule';

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
register(equinixAssetRegisterProfile);
register(equinixContractorProfile);
register(xeroPayrollTimesheetsProfile);
register(myobPayrollTimesheetsProfile);
register(equinixAuditSimproProfile);
register(ppmSowProfile);
register(assetRegisterExportProfile);
register(siteRegisterExportProfile);
register(serviceVisitScheduleProfile);

export function getProfile(id: string): DeriveProfile | undefined {
  return profiles.get(id);
}

export function listProfiles(): DeriveProfile[] {
  return [...profiles.values()];
}
