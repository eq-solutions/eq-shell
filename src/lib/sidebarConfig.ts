// Shared sidebar records config — used by HubSidebar across all HubLayout consumers.
// Counts are fetched per-page; the config here defines the static shape.
// Import RecordLink type from HubSidebar.

import type { RecordLink } from '../components/HubSidebar';

// Static record links — counts are null by default; pages that fetch dashboard
// data should provide live counts when available.
export const SIDEBAR_RECORDS: Omit<RecordLink, 'count'>[] = [
  // Sites and Contacts are tabs inside the Customers page — no separate nav entries needed.
  { key: 'customer',  label: 'Customers',         entity: 'customer',  to: 'customers'  },
  // Staff opens the list + training matrix page (licences folded in).
  { key: 'staff',     label: 'Staff',             entity: 'staff',     to: 'staff'      },
  // Plant & equipment is its own module route. Gated on equipment.view in HubSidebar.
  { key: 'equipment', label: 'Plant & equipment', entity: 'equipment', to: 'equipment'  },
];

// Build a RecordLink array with null counts (for pages that don't fetch dashboard data).
export function defaultSidebarRecords(): RecordLink[] {
  return SIDEBAR_RECORDS.map((r) => ({ ...r, count: null }));
}
