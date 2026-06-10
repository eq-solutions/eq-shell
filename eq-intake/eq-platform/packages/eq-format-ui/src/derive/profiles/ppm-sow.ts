/**
 * `ppm-sow` profile — PPM Statement of Work generator.
 *
 * Takes canonical asset rows and generates a formatted Statement of Work (SOW)
 * asset schedule — the document that coordinators currently build by hand each
 * month to tell field crews what to service at each site.
 *
 * Before: coordinator copies asset register into an Excel template, fills in
 * the scheduled tasks for each asset, sends it to the crew.
 *
 * After: drop the asset register into EQ Format, select this profile, get
 * the SOW asset schedule in 30 seconds.
 *
 * ── Input shape (canonical asset rows) ────────────────────────────────────
 * Expects validated canonical `asset` rows from @eq/schemas asset.schema.json.
 * Key fields used: name, external_id, asset_type, location_in_site, make,
 * model, serial_number, ppm_frequency, last_service_date, next_service_due,
 * criticality, notes.
 *
 * ── Output shape (SOW asset schedule) ─────────────────────────────────────
 * One row per asset, with columns matching a standard SKS NSW SOW template:
 *   Tag, Asset, Type, Location, Make, Model, Serial, Frequency,
 *   Last Service, Next Due, Criticality, Tasks, Status, Tech Initials, Notes
 *
 * "Tasks" is pre-populated based on asset_type: switchboards get
 * "Annual DB Maint + Thermal", generators get "Run Start + Load Test", etc.
 *
 * ── Sorting ─────────────────────────────────────────────────────────────────
 * Sorted by criticality (critical → high → medium → low) then asset type
 * then tag number. This puts the most important assets first so field crew
 * see them at the top of the page.
 */

import type { DeriveProfile, DeriveOutput } from '../types';

const COLUMNS = [
  'Tag',
  'Asset',
  'Type',
  'Location',
  'Make / Model',
  'Serial',
  'Frequency',
  'Last Service',
  'Next Due',
  'Criticality',
  'Scheduled Tasks',
  'Status',
  'Initials',
  'Notes',
];

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

const CRITICALITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Pre-populate the scheduled tasks column based on asset type.
 * Field crews know the full procedure for each task code — these are
 * shorthand codes that match the SOW document standard.
 */
function defaultTasksForType(assetType: string): string {
  const t = assetType.toLowerCase();
  if (t.includes('switchboard') || t.includes('msb') || t.includes('db') || t === 'switchboard') {
    return 'Annual DB Maint · Thermal Scan · Visual Inspection';
  }
  if (t.includes('ups')) {
    return 'UPS Service · Battery Check · Load Test';
  }
  if (t.includes('generator') || t.includes('genset')) {
    return 'Run Start · Load Test · Log Reading';
  }
  if (t.includes('battery')) {
    return 'Battery Load Test · Specific Gravity · Visual Check';
  }
  if (t.includes('ats') || t.includes('transfer switch')) {
    return 'ATS Function Test · Visual Inspection · Log Reading';
  }
  if (t.includes('rpp') || t.includes('pdu')) {
    return 'Visual Inspection · Breaker Check · Load Reading';
  }
  if (t.includes('rcd')) {
    return 'RCD Trip Time Test · Label Check';
  }
  if (t.includes('transformer')) {
    return 'Visual Inspection · Thermal Scan · Load Reading';
  }
  if (t.includes('ahu') || t.includes('air handling') || t.includes('crac')) {
    return 'Filter Service · Belt Check · Coil Inspection';
  }
  if (t.includes('chiller')) {
    return 'Visual Inspection · Refrigerant Check · Log Reading';
  }
  if (t.includes('fire pump')) {
    return 'Pump Run Test · Pressure Check · Log Reading';
  }
  if (t.includes('fire panel') || t.includes('smoke')) {
    return 'Function Test · Battery Check · Visual Inspection';
  }
  if (t.includes('thermal imaging') || t.includes('earth test')) {
    return 'Test · Record Result';
  }
  return 'Service · Visual Inspection';
}

export const ppmSowProfile: DeriveProfile = {
  id: 'ppm-sow',
  label: 'PPM Statement of Work',
  description:
    'Generates a PPM Statement of Work (SOW) asset schedule from a canonical asset register. ' +
    'One row per asset. Scheduled tasks pre-populated by asset type. ' +
    'Sorted by criticality then type — critical assets appear first.',
  inputShape: 'canonical',

  derive(rows: Record<string, unknown>[]): DeriveOutput {
    // Include all assets — SOW covers everything, active or not (team needs to
    // know about decommissioned assets to confirm skip-over).
    const mapped = rows.map((r) => {
      const assetType = str(r.asset_type) || str(r.type) || str(r.category);
      const makeModel = [str(r.make) || str(r.manufacturer), str(r.model)]
        .filter(Boolean)
        .join(' / ');

      return {
        'Tag':               str(r.external_id) || str(r.tag) || str(r.asset_id).slice(0, 8),
        'Asset':             str(r.name) || str(r.description) || str(r.asset_name),
        'Type':              assetType,
        'Location':          str(r.location_in_site) || str(r.location) || str(r.room),
        'Make / Model':      makeModel,
        'Serial':            str(r.serial_number) || str(r.serial),
        'Frequency':         str(r.ppm_frequency) || str(r.frequency) || '',
        'Last Service':      str(r.last_service_date) || str(r.last_pm) || '',
        'Next Due':          str(r.next_service_due) || str(r.next_pm) || '',
        'Criticality':       str(r.criticality) || 'medium',
        'Scheduled Tasks':   defaultTasksForType(assetType),
        'Status':            str(r.active) === 'false' ? 'Decommissioned' : '',
        'Initials':          '',
        'Notes':             str(r.notes) || str(r.defects_summary) || '',
        // Used for sorting only — not in output.
        _critOrder: CRITICALITY_ORDER[str(r.criticality).toLowerCase()] ?? 2,
        _type: assetType.toLowerCase(),
      };
    });

    const sorted = [...mapped].sort((a, b) => {
      const crit = (a._critOrder as number) - (b._critOrder as number);
      if (crit !== 0) return crit;
      const type = (a._type as string).localeCompare(b._type as string);
      if (type !== 0) return type;
      return (a['Tag'] as string).localeCompare(b['Tag'] as string);
    });

    // Strip sorting keys from output.
    const outRows = sorted.map(({ _critOrder: _c, _type: _t, ...rest }) => rest);

    return { columns: COLUMNS, rows: outRows };
  },
};
