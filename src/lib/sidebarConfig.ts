// Shared sidebar records config — used by HubSidebar across all HubLayout consumers.
// Counts are fetched per-page; the config here defines the static shape.
// Import RecordLink type from HubSidebar.

import type { RecordLink } from '../components/HubSidebar';

// Static record links — counts are null by default; pages that fetch dashboard
// data should provide live counts when available.
export const SIDEBAR_RECORDS: Omit<RecordLink, 'count'>[] = [
  { key: 'customer',  label: 'Customers',         entity: 'customer'  },
  { key: 'site',      label: 'Sites',             entity: 'site'      },
  { key: 'contact',   label: 'Contacts',          entity: 'contact'   },
  { key: 'staff',     label: 'Staff',             entity: 'staff'     },
  { key: 'licence',   label: 'Licences',          entity: 'licence'   },
  // Plant & equipment is its own module route, not /data/:entity — folded into
  // Records (was its own EQUIPMENT group). Gated on equipment.view in HubSidebar.
  { key: 'equipment', label: 'Plant & equipment', entity: 'equipment', to: 'equipment' },
];

// Build a RecordLink array with null counts (for pages that don't fetch dashboard data).
export function defaultSidebarRecords(): RecordLink[] {
  return SIDEBAR_RECORDS.map((r) => ({ ...r, count: null }));
}
