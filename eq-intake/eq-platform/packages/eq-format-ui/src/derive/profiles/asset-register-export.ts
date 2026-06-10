/**
 * `asset-register-export` profile — canonical asset register → operational export.
 *
 * Takes canonical `asset` rows and produces a clean, human-readable asset
 * register — the document that coordinators, clients, and auditors use as the
 * single source of truth for what's on-site and in what state.
 *
 * Before: coordinator exports from SimPRO, re-formats manually for each client,
 * strips internal columns, adds condition and defect summary by hand.
 *
 * After: drop the asset register into EQ Format, select this profile, get a
 * client-ready asset register in 30 seconds.
 *
 * ── Input shape (canonical asset rows) ──────────────────────────────────────
 * Expects validated canonical `asset` rows from @eq/schemas asset.schema.json.
 * Key fields used: name, external_id, asset_type, location_in_site, make,
 * model, serial_number, condition, ppm_frequency, last_service_date,
 * next_service_due, criticality, active, defects_summary, notes.
 *
 * ── Output shape (operational asset register) ───────────────────────────────
 * One row per asset. Columns:
 *   Tag, Asset Name, Type, Location, Make / Model, Serial,
 *   Condition, Criticality, PPM Frequency, Last Service, Next Due,
 *   Status, Open Defects, Notes
 *
 * ── Sorting ──────────────────────────────────────────────────────────────────
 * Sorted by criticality (critical → high → medium → low) then asset type
 * then tag — mirrors the PPM SOW ordering so both documents line up when
 * used side-by-side.
 *
 * ── Active vs decommissioned ─────────────────────────────────────────────────
 * Decommissioned assets (active = false) are included but flagged in the
 * Status column. Clients need to see them to confirm skip-over on site.
 */

import type { DeriveProfile, DeriveOutput } from '../types';

const COLUMNS = [
  'Tag',
  'Asset Name',
  'Type',
  'Location',
  'Make / Model',
  'Serial',
  'Condition',
  'Criticality',
  'PPM Frequency',
  'Last Service',
  'Next Due',
  'Status',
  'Open Defects',
  'Notes',
];

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const CRITICALITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const CONDITION_LABELS: Record<string, string> = {
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  needs_replacement: 'Needs Replacement',
  unknown: '',
};

export const assetRegisterExportProfile: DeriveProfile = {
  id: 'asset-register-export',
  label: 'Asset Register Export',
  description:
    'Produces a client-ready asset register from canonical asset rows. ' +
    'Includes condition, criticality, PPM frequency, open defects, and status. ' +
    'Sorted by criticality then type — mirrors PPM SOW ordering for side-by-side use.',
  inputShape: 'canonical',

  derive(rows: Record<string, unknown>[]): DeriveOutput {
    const mapped = rows.map((r) => {
      const assetType    = str(r.asset_type) || str(r.type) || str(r.category);
      const makeModel    = [str(r.make) || str(r.manufacturer), str(r.model)]
        .filter(Boolean)
        .join(' / ');
      const conditionRaw = str(r.condition).toLowerCase();
      const condition    = CONDITION_LABELS[conditionRaw] ?? titleCase(conditionRaw);
      const critRaw      = str(r.criticality).toLowerCase();
      const active       = str(r.active);
      const status       = active === 'false' ? 'Decommissioned' : 'Active';

      return {
        'Tag':           str(r.external_id) || str(r.tag) || str(r.asset_id).slice(0, 8),
        'Asset Name':    str(r.name) || str(r.description) || str(r.asset_name),
        'Type':          assetType,
        'Location':      str(r.location_in_site) || str(r.location) || str(r.room),
        'Make / Model':  makeModel,
        'Serial':        str(r.serial_number) || str(r.serial),
        'Condition':     condition,
        'Criticality':   titleCase(critRaw) || 'Medium',
        'PPM Frequency': str(r.ppm_frequency) || str(r.frequency) || '',
        'Last Service':  str(r.last_service_date) || str(r.last_pm) || '',
        'Next Due':      str(r.next_service_due) || str(r.next_pm) || '',
        'Status':        status,
        'Open Defects':  str(r.defects_summary) || '',
        'Notes':         str(r.notes) || '',
        // Sort keys — stripped from output
        _critOrder: CRITICALITY_ORDER[critRaw] ?? 2,
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

    const outRows = sorted.map(({ _critOrder: _c, _type: _t, ...rest }) => rest);
    return { columns: COLUMNS, rows: outRows };
  },
};
