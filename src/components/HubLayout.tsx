import { useEffect, useState } from 'react';
import { useSession, moduleEnabled } from '../session';
import { HubSidebar, HUB_APP_ICONS, type HubApp, type RecordLink } from './HubSidebar';
import { IconRail } from './IconRail';

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

  // Fetch live counts once on mount — only used by the full HubSidebar path.
  useEffect(() => {
    if (!session || iframe || hideMainSidebar) return;
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
      <div>
        <HubSidebar apps={sidebarApps} records={sidebarRecords} />
      </div>
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
