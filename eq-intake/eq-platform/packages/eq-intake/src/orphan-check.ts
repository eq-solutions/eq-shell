/**
 * @eq/intake — orphan-check engine
 *
 * Calls eq_tidy_orphan_check RPC and maps the raw SQL result into
 * structured OrphanItem[] for the tidy UI.
 *
 * An "orphan" is a row with a broken FK: an asset pointing to a
 * non-existent site, a contact with no parent, etc. These can't be
 * auto-fixed — they need a human to pick the correct linked record.
 */

import type { SupabaseLikeClient } from './canonical/commit-canonical.js';
import type {
  OrphanCheckOpts,
  OrphanCheckResult,
  OrphanItem,
} from './tidy-types.js';

// ---------------------------------------------------------------------------
// Raw shape returned by eq_tidy_orphan_check RPC
// ---------------------------------------------------------------------------

interface RpcOrphanRow {
  id:              string;
  label:           string;
  external_id?:    string;
  bad_site_id?:    string;
  bad_staff_id?:   string;
  bad_customer_id?: string;
}

interface RpcOrphanResult {
  assets_no_site?:      RpcOrphanRow[] | null;
  contacts_no_parent?:  RpcOrphanRow[] | null;
  licences_no_staff?:   RpcOrphanRow[] | null;
  sites_no_customer?:   RpcOrphanRow[] | null;
  summary: {
    assets_no_site_count:       number;
    contacts_no_parent_count:   number;
    licences_no_staff_count:    number;
    sites_no_customer_count:    number;
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapAssetNoSite(rows: RpcOrphanRow[]): OrphanItem[] {
  return rows.map((r) => ({
    entity:      'asset' as const,
    table:       'assets',
    row_id:      r.id,
    row_label:   r.label,
    orphan_type: 'asset_no_site' as const,
    message:     `Asset links to site ${r.bad_site_id ?? '?'} which no longer exists.`,
    bad_fk_id:   r.bad_site_id,
  }));
}

function mapContactNoParent(rows: RpcOrphanRow[]): OrphanItem[] {
  return rows.map((r) => ({
    entity:      'contact' as const,
    table:       'contacts',
    row_id:      r.id,
    row_label:   r.label,
    orphan_type: 'contact_no_parent' as const,
    message:     'Contact has no customer or site — it is unlinked.',
  }));
}

function mapLicenceNoStaff(rows: RpcOrphanRow[]): OrphanItem[] {
  return rows.map((r) => ({
    entity:      'licence' as const,
    table:       'licences',
    row_id:      r.id,
    row_label:   r.label,
    orphan_type: 'licence_no_staff' as const,
    message:     `Licence links to staff ${r.bad_staff_id ?? '?'} who no longer exists.`,
    bad_fk_id:   r.bad_staff_id,
  }));
}

function mapSiteNoCustomer(rows: RpcOrphanRow[]): OrphanItem[] {
  return rows.map((r) => ({
    entity:      'site' as const,
    table:       'sites',
    row_id:      r.id,
    row_label:   r.label,
    orphan_type: 'site_no_customer' as const,
    message:     `Site links to customer ${r.bad_customer_id ?? '?'} which no longer exists.`,
    bad_fk_id:   r.bad_customer_id,
  }));
}

// ---------------------------------------------------------------------------
// Public: runOrphanCheck
// ---------------------------------------------------------------------------

export async function runOrphanCheck(opts: OrphanCheckOpts): Promise<OrphanCheckResult> {
  opts.onProgress?.('Running orphan check…');

  const { data, error } = await opts.supabase.rpc('eq_tidy_orphan_check', {});

  if (error) {
    throw new Error(`eq_tidy_orphan_check failed: ${error.message}`);
  }

  const raw = data as RpcOrphanResult | null;

  if (!raw) {
    return {
      orphans: [],
      summary: {
        assets_no_site_count:     0,
        contacts_no_parent_count: 0,
        licences_no_staff_count:  0,
        sites_no_customer_count:  0,
        total:                    0,
      },
    };
  }

  const orphans: OrphanItem[] = [
    ...mapAssetNoSite(raw.assets_no_site ?? []),
    ...mapContactNoParent(raw.contacts_no_parent ?? []),
    ...mapLicenceNoStaff(raw.licences_no_staff ?? []),
    ...mapSiteNoCustomer(raw.sites_no_customer ?? []),
  ];

  const s = raw.summary;
  const total =
    s.assets_no_site_count +
    s.contacts_no_parent_count +
    s.licences_no_staff_count +
    s.sites_no_customer_count;

  opts.onProgress?.(
    total === 0
      ? 'No orphaned records found.'
      : `Found ${total} orphaned record${total === 1 ? '' : 's'}.`,
  );

  return {
    orphans,
    summary: {
      assets_no_site_count:     s.assets_no_site_count,
      contacts_no_parent_count: s.contacts_no_parent_count,
      licences_no_staff_count:  s.licences_no_staff_count,
      sites_no_customer_count:  s.sites_no_customer_count,
      total,
    },
  };
}
