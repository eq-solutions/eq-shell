import { useEffect, useState, useCallback } from 'react';
import { Menu, X } from 'lucide-react';
import { useSession, moduleEnabled } from '../session';
import { HubSidebar, HUB_APP_ICONS, type HubApp, type RecordLink } from './HubSidebar';
import { IconRail } from './IconRail';

// Module-level cache for tenant-dashboard counts.
// Sidebar counts are best-effort — 1-minute TTL is fine.
interface DashboardCount {
  entity: string;
  count_total: number;
}

interface DashboardResponse {
  ok: boolean;
  counts?: DashboardCount[];
}

const _dashboardCache = new Map<string, { data: DashboardResponse; ts: number }>();
const DASHBOARD_TTL_MS = 60_000;

function getCachedDashboard(key: string): DashboardResponse | null {
  const entry = _dashboardCache.get(key);
  if (entry && Date.now() - entry.ts < DASHBOARD_TTL_MS) return entry.data;
  return null;
}
function setCachedDashboard(key: string, data: DashboardResponse): void {
  _dashboardCache.set(key, { data, ts: Date.now() });
}

const HUB_APPS = [
  { key: 'field',   label: 'EQ Field',   to: 'field',   isBeta: false },
  { key: 'service', label: 'EQ Service', to: 'service', isBeta: true  },
  { key: 'quotes',  label: 'EQ Quotes',  to: 'quotes',  isBeta: false },
  { key: 'cards',   label: 'EQ Cards',   to: 'cards',   isBeta: true  },
];

interface DashboardCounts {
  field:   number | null;
  service: number | null;
  quotes:  number | null;
  cards:   number | null;
}

function extractCounts(data: DashboardResponse): DashboardCounts {
  const counts: DashboardCounts = { field: null, service: null, quotes: null, cards: null };
  if (!data.ok || !data.counts) return counts;
  for (const row of data.counts) {
    if (typeof row.count_total !== 'number') continue;
    switch (row.entity) {
      // Field — active staff total
      case 'staff':       counts.field   = row.count_total; break;
      // Service — open incidents in canonical (populated via Intake or Service writes)
      case 'incident':    counts.service = row.count_total || null; break;
      // Quotes — all quotes in canonical (populated via Intake sync or canonical-native)
      case 'quote':       counts.quotes  = row.count_total || null; break;
      // Cards — staff licences held (proxy until issued-card entity exists)
      case 'licence':     counts.cards   = row.count_total || null; break;
    }
  }
  return counts;
}

export function HubLayout({
  children,
  iframe = false,
  fullWidth = false,
  hideMainSidebar = false,
  sidebarRecords,
}: {
  children: React.ReactNode;
  iframe?: boolean;
  /** Skip the eq-hub-content max-width wrapper. Use for full-bleed dashboard modules. */
  fullWidth?: boolean;
  /**
   * @deprecated Equivalent to `iframe`. Both props render IconRail.
   * Kept for backward-compat — prefer `iframe` alone on new call sites.
   */
  hideMainSidebar?: boolean;
  /** Records links rendered in HubSidebar. Unused in iframe mode (icon rail has no records section). */
  sidebarRecords?: RecordLink[];
}) {
  const { session } = useSession();
  const [liveCounts, setLiveCounts] = useState<DashboardCounts>({
    field: null,
    service: null,
    quotes: null,
    cards: null,
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Close drawer on Escape
  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [drawerOpen, closeDrawer]);

  // Fetch live counts once on mount — only used by the full HubSidebar path.
  // Uses a module-level cache (1-minute TTL) to avoid refetching on every non-iframe page load.
  useEffect(() => {
    if (!session || iframe || hideMainSidebar) return;
    const cacheKey = `dashboard:${session.tenant.slug ?? 'default'}`;
    const cached = getCachedDashboard(cacheKey);
    if (cached) {
      setLiveCounts(extractCounts(cached));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/tenant-dashboard', {
          credentials: 'include',
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as DashboardResponse;
        if (!cancelled) {
          setCachedDashboard(cacheKey, data);
          setLiveCounts(extractCounts(data));
        }
      } catch {
        // Sidebar counts are best-effort — swallow errors silently.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, iframe, hideMainSidebar]);

  // Iframe module pages (Field, Service, Cards, Quotes) — render the icon rail
  // instead of the full sidebar. The rail is 48px wide and fixed to the left
  // edge; content is offset by the same amount.
  if (iframe || hideMainSidebar) {
    return (
      <>
        <IconRail />
        <div className="eq-icon-rail-offset" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          {children}
        </div>
      </>
    );
  }

  const sidebarApps: HubApp[] = HUB_APPS
    .filter((a) => session ? moduleEnabled(session, a.key) : false)
    .map((a) => ({
      key: a.key,
      label: a.label,
      to: a.to,
      isBeta: a.isBeta,
      count: liveCounts[a.key as keyof DashboardCounts] ?? null,
      hasAlert: false,
      icon: HUB_APP_ICONS[a.key],
    }));

  return (
    <div className="eq-hub">
      {/* Mobile hamburger — only visible < 768px */}
      <button
        className="eq-hub-hamburger"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open navigation"
        aria-expanded={drawerOpen}
      >
        <Menu size={20} aria-hidden="true" />
      </button>

      {/* Mobile drawer sidebar */}
      {drawerOpen && (
        <div
          className="eq-hub-drawer-backdrop"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}
      <div className={`eq-hub-drawer${drawerOpen ? ' eq-hub-drawer--open' : ''}`} aria-hidden={!drawerOpen}>
        <button
          className="eq-hub-drawer__close"
          onClick={closeDrawer}
          aria-label="Close navigation"
        >
          <X size={20} aria-hidden="true" />
        </button>
        <HubSidebar apps={sidebarApps} records={sidebarRecords} />
      </div>

      {/* Desktop sidebar — hidden on mobile via CSS */}
      <HubSidebar apps={sidebarApps} records={sidebarRecords} />

      <div className="eq-hub__content" style={fullWidth ? { overflow: 'hidden' } : undefined}>
        {fullWidth ? children : (
          <main className="eq-hub-content">
            {children}
          </main>
        )}
      </div>
    </div>
  );
}
