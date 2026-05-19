/**
 * `device-register` profile — addressable-device commissioning register
 * derived from a SimPRO-shaped quote.
 *
 * Logic ported from `demos/simpro-quote-781/parse.mjs`. Identifies line
 * items that look like addressable devices (KNX is the canonical example
 * but the pattern works for any line item that ships as discrete physical
 * units needing commissioning), expands each line into one row per
 * physical unit, auto-suggests sequential physical addresses, and emits
 * placeholder commissioning fields the field tech fills in later.
 *
 * The KNX-flavoured term list below is the starter set. Real KNX projects
 * use more (binary outputs, weather stations, room controllers, etc); a
 * later iteration will widen this when a real `.knxproj` lands. Other
 * device families (BACnet, DALI, Modbus) would be peer profiles, not
 * extensions of this one — different addressing schemes.
 */

import type { DeriveProfile, DeriveOutput } from '../types';
import { num } from '../csv';

const COLUMNS = [
  'device_id',
  'description',
  'part_number',
  'section',
  'cost_centre',
  'physical_address',
  'group_address_main',
  'group_address_middle',
  'group_address_sub',
  'function',
  'programmed',
  'tested_by',
  'tested_date',
  'status',
  'notes',
];

// Term patterns that identify a line item as an addressable device.
// Loose matching by design — false positives are easy to cull manually
// during commissioning, false negatives mean a device is missing entirely.
const DEVICE_TERMS: RegExp[] = [
  /\bactuator\b/i,
  /\bdimmer\b/i,
  /\bsensor\b/i,
  /\bbinary\s*input\b/i,
  /\bpresence\b/i,
  /\bthermostat\b/i,
  /\btouch\s*panel\b/i,
  /\bIP\s*router\b/i,
  /\bline\s*coupler\b/i,
  /\bpower\s*supply\b/i,
];

function isAddressableDevice(description: string, costCentre: string): boolean {
  const haystack = (description + ' ' + costCentre).toLowerCase();
  if (haystack.includes('knx')) return true;
  return DEVICE_TERMS.some((re) => re.test(haystack));
}

export const deviceRegisterProfile: DeriveProfile = {
  id: 'device-register',
  label: 'Device Commissioning Register',
  description:
    'One row per addressable physical device (e.g. KNX actuator, DALI dimmer) with auto-suggested sequential physical addresses (1.1.N) and placeholder commissioning fields (group address, function, programmed, tested-by, status). Field tech fills in the placeholders during commissioning.',
  inputShape: 'simpro-quote',
  derive(rows: Record<string, unknown>[]): DeriveOutput {
    const materials = rows.filter((r) => {
      const t = String(r['Item Type'] ?? '');
      return t === 'One off Item' || t === 'Prebuild';
    });

    const out: Record<string, unknown>[] = [];
    let physCounter = 1;

    for (const m of materials) {
      const description = String(m['Part Description'] ?? '');
      const costCentre = String(m['Cost Centre Name'] ?? '');
      if (!isAddressableDevice(description, costCentre)) continue;

      const qty = Math.max(1, Math.round(num(m['Quantity'])));
      for (let i = 0; i < qty; i++) {
        out.push({
          device_id: `D-${String(physCounter).padStart(3, '0')}`,
          description,
          part_number: String(m['Part Number'] ?? ''),
          section: String(m['Section Name'] ?? ''),
          cost_centre: costCentre,
          physical_address: `1.1.${physCounter}`,
          group_address_main: '',
          group_address_middle: '',
          group_address_sub: '',
          function: '',
          programmed: '',
          tested_by: '',
          tested_date: '',
          status: 'pending',
          notes: '',
        });
        physCounter++;
      }
    }

    return { columns: COLUMNS, rows: out };
  },
};
