/**
 * `equinix-asset-register` profile — Equinix Australia site asset register.
 *
 * Takes canonical asset rows (from an EQ Format validate run) and emits a
 * structured asset register suitable for Equinix's CMDB and facility
 * reporting. Equinix data centres require per-site asset registers that group
 * by facility / level / room for rack-level traceability.
 *
 * Output columns mirror Equinix's standard asset reporting template:
 *   Facility, Room, Asset Type, Part Number, Description, Manufacturer,
 *   Model, Quantity, UOM, Install Date, Serial Number, Notes
 *
 * Input: canonical `asset` rows (validated by EQ Format → stage 3 valid_rows).
 *
 * Canonical asset field mapping (from @eq/schemas asset.schema.json):
 *   site_name       → Facility
 *   location        → Room               (rack ID / room label)
 *   asset_type      → Asset Type
 *   part_number     → Part Number
 *   description     → Description
 *   manufacturer    → Manufacturer
 *   model           → Model
 *   quantity        → Quantity
 *   unit_of_measure → UOM
 *   install_date    → Install Date
 *   serial_number   → Serial Number
 *   notes           → Notes
 *
 * If any of these canonical fields are absent (older schema or partial
 * mapping), the profile substitutes an empty string — no row is dropped.
 * All rows that made it to the valid bucket are included.
 */

import type { DeriveProfile, DeriveOutput } from '../types';

const COLUMNS = [
  'Facility',
  'Room',
  'Asset Type',
  'Part Number',
  'Description',
  'Manufacturer',
  'Model',
  'Quantity',
  'UOM',
  'Install Date',
  'Serial Number',
  'Notes',
];

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

export const equinixAssetRegisterProfile: DeriveProfile = {
  id: 'equinix-asset-register',
  label: 'Equinix Asset Register',
  description:
    'Equinix-formatted asset register. Groups assets by facility and room. ' +
    'Columns match the Equinix CMDB template: Facility, Room, Asset Type, ' +
    'Part Number, Description, Manufacturer, Model, Quantity, UOM, Install Date, ' +
    'Serial Number, Notes.',
  inputShape: 'canonical',

  derive(rows: Record<string, unknown>[]): DeriveOutput {
    // Map canonical fields to Equinix column names.
    // We handle several common canonical alias variants in case the source
    // schema used different field names (e.g. "site" vs "site_name").
    const mapped = rows.map((r) => ({
      'Facility':     str(r.site_name)        || str(r.site)             || str(r.facility)      || '',
      'Room':         str(r.location)         || str(r.room)             || str(r.rack)          || '',
      'Asset Type':   str(r.asset_type)       || str(r.type)             || str(r.category)      || '',
      'Part Number':  str(r.part_number)      || str(r.part_no)          || str(r.sku)           || '',
      'Description':  str(r.description)      || str(r.part_description) || str(r.name)          || '',
      'Manufacturer': str(r.manufacturer)     || str(r.make)             || '',
      'Model':        str(r.model)            || str(r.model_number)     || '',
      'Quantity':     str(r.quantity)         || str(r.qty)              || '',
      'UOM':          str(r.unit_of_measure)  || str(r.uom)              || str(r.unit)          || 'ea',
      'Install Date': str(r.install_date)     || str(r.installed_at)     || str(r.date)          || '',
      'Serial Number':str(r.serial_number)    || str(r.serial)           || str(r.serial_no)     || '',
      'Notes':        str(r.notes)            || str(r.comments)         || '',
    }));

    // Sort by Facility → Room → Description for a scannable register.
    const sorted = [...mapped].sort((a, b) => {
      const fac = a['Facility'].localeCompare(b['Facility']);
      if (fac !== 0) return fac;
      const room = a['Room'].localeCompare(b['Room']);
      if (room !== 0) return room;
      return a['Description'].localeCompare(b['Description']);
    });

    return { columns: COLUMNS, rows: sorted };
  },
};
