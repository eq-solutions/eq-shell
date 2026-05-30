import { useCallback, useEffect, useState } from 'react';
import { useSession, moduleEnabled } from '../session';
import { HubSidebar, HUB_APP_ICONS, type HubApp } from './HubSidebar';

const HUB_APPS = [
  { key: 'field',   label: 'EQ Field',   to: 'field',   isBeta: false },
  { key: 'service', label: 'EQ Service', to: 'service', isBeta: false },
  { key: 'quotes',  label: 'EQ Quotes',  to: 'quotes',  isBeta: false },
  { key: 'cards',   label: 'EQ Cards',   to: 'cards',   isBeta: false },
];

interface DashboardCounts {
  field:   number | null;
  service: number | null;
  quotes:  number | null;
  cards:   number | null;
}

interface DashboardCount {
  entity: string;
  count_total: number;
}

interface DashboardResponse {
  ok: boolean;
  counts?: DashboardCount[];
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
}: {
  children: React.ReactNode;
  iframe?: boolean;
  /** Skip the eq-hub-content max-width wrapper. Use for full-bleed dashboard modules. */
  fullWidth?: boolean;
}) {
  const { session } = useSession();
  const [liveCounts, setLiveCounts] = useState<DashboardCounts>({
    field: null,
    service: null,
    quotes: null,
    cards: null,
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Fetch live counts once on mount. No polling — the hub sidebar is a
  // lightweight nav aid, not a realtime dashboard.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/tenant-dashboard', {
          credentials: 'include',
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as DashboardResponse;
        if (!cancelled) {
          setLiveCounts(extractCounts(data));
        }
      } catch {
        // Sidebar counts are best-effort — swallow errors silently.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

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
      {iframe && sidebarOpen && (
        <div
          className="eq-hub__mobile-backdrop"
          aria-hidden="true"
          onClick={closeSidebar}
        />
      )}
      <div className={
        iframe
          ? sidebarOpen
            ? 'eq-hub__sidebar-rail-wrap eq-hub__sidebar-overlay'
            : 'eq-hub__sidebar-rail-wrap'
          : undefined
      }>
        <HubSidebar apps={sidebarApps} />
      </div>
      {iframe ? (
        <div className="eq-hub__iframe-content">
          <button
            className="eq-hub__mobile-toggle"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M3 4.5h12M3 9h12M3 13.5h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          {children}
        </div>
      ) : (
        <div className="eq-hub__content" style={fullWidth ? { overflow: 'hidden' } : undefined}>
          {fullWidth ? children : (
            <main className="eq-hub-content">
              {children}
            </main>
          )}
        </div>
      )}
    </div>
  );
}
