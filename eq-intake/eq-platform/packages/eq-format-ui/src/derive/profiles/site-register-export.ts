/**
 * `site-register-export` profile — canonical site rows → site register.
 *
 * Takes canonical `site` rows and produces a clean site register — the
 * document that captures every physical location a crew might visit.
 *
 * Before: coordinator extracts sites from SimPRO, strips internal columns,
 * formats addresses and contact details by hand for each client report.
 *
 * After: drop the site list into EQ Format, select this profile, get a
 * formatted site register in seconds.
 *
 * ── Input shape (canonical site rows) ───────────────────────────────────────
 * Expects validated canonical `site` rows from @eq/schemas site.schema.json.
 * Key fields used: name, external_id, customer_id, address (street, suburb,
 * state, postcode), site_type, access_instructions, emergency_contact_name,
 * emergency_contact_phone, notes.
 *
 * ── Output shape (site register) ─────────────────────────────────────────────
 * One row per site. Columns:
 *   Site ID, Site Name, Customer, Type,
 *   Address, Suburb, State, Postcode,
 *   Access Instructions, Emergency Contact, Emergency Phone, Notes
 *
 * ── Sorting ──────────────────────────────────────────────────────────────────
 * Sorted by customer name then site name — matches the grouping operators
 * expect when reviewing a multi-client site register.
 */

import type { DeriveProfile, DeriveOutput } from '../types';

const COLUMNS = [
  'Site ID',
  'Site Name',
  'Customer',
  'Type',
  'Street Address',
  'Suburb',
  'State',
  'Postcode',
  'Access Instructions',
  'Emergency Contact',
  'Emergency Phone',
  'Notes',
];

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

export const siteRegisterExportProfile: DeriveProfile = {
  id: 'site-register-export',
  label: 'Site Register Export',
  description:
    'Produces a formatted site register from canonical site rows. ' +
    'Includes addresses, access instructions, and emergency contacts. ' +
    'Sorted by customer then site name.',
  inputShape: 'canonical',

  derive(rows: Record<string, unknown>[]): DeriveOutput {
    const mapped = rows.map((r) => {
      // Address can arrive as a nested object or as flat fields
      const addrObj = r.address as Record<string, unknown> | undefined;
      const street  = str(addrObj?.street)  || str(r.street_address) || str(r.address_line_1) || str(r.street);
      const suburb  = str(addrObj?.suburb)  || str(r.suburb)         || str(r.city);
      const state   = str(addrObj?.state)   || str(r.state);
      const postcode = str(addrObj?.postcode) || str(r.postcode)     || str(r.zip);

      // Emergency contact can be a compound string or split fields
      const emergencyName  = str(r.emergency_contact_name)  || str(r.emergency_contact);
      const emergencyPhone = str(r.emergency_contact_phone) || str(r.emergency_phone);

      // Customer name — canonical stores customer_id (UUID), but a denormalised
      // customer_name alias is common in pre-commit rows. Use whichever is available.
      const customer = str(r.customer_name) || str(r.customer) || str(r.company_name) || str(r.customer_id);

      return {
        'Site ID':              str(r.external_id) || str(r.simpro_site_id) || str(r.site_id).slice(0, 8),
        'Site Name':            str(r.name) || str(r.site_name),
        'Customer':             customer,
        'Type':                 str(r.site_type) || str(r.type) || '',
        'Street Address':       street,
        'Suburb':               suburb,
        'State':                state,
        'Postcode':             postcode,
        'Access Instructions':  str(r.access_instructions) || str(r.access_notes) || '',
        'Emergency Contact':    emergencyName,
        'Emergency Phone':      emergencyPhone,
        'Notes':                str(r.notes) || '',
        // Sort keys
        _customer: customer.toLowerCase(),
        _name: (str(r.name) || str(r.site_name)).toLowerCase(),
      };
    });

    const sorted = [...mapped].sort((a, b) => {
      const cust = (a._customer as string).localeCompare(b._customer as string);
      if (cust !== 0) return cust;
      return (a._name as string).localeCompare(b._name as string);
    });

    const outRows = sorted.map(({ _customer: _c, _name: _n, ...rest }) => rest);
    return { columns: COLUMNS, rows: outRows };
  },
};
