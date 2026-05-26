import { useEffect, useState } from 'react';
import { useSession, moduleEnabled } from '../session';
import { HubSidebar, HUB_APP_ICONS, type HubApp } from './HubSidebar';

const HUB_APPS = [
  { key: 'field',   label: 'EQ Field',   to: 'field',   isBeta: false },
  { key: 'service', label: 'EQ Service', to: 'service', isBeta: false },
  { key: 'quotes',  label: 'EQ Quotes',  to: 'quotes',  isBeta: false },
  { key: 'cards',   label: 'EQ Cards',   to: 'cards',   isBeta: true  },
];

interface DashboardCounts {
  field: number | null;
  service: number | null;
  cards: number | null;
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
  const counts: DashboardCounts = { field: null, service: null, cards: null };
  if (!data.ok || !data.counts) return counts;
  for (const row of data.counts) {
    // 'staff' entity from the tenant DB → Field staff count badge
    if (row.entity === 'staff' && typeof row.count_total === 'number') {
      counts.field = row.count_total;
    }
    // 'work_orders' entity → Service WO count badge
    if (row.entity === 'work_orders' && typeof row.count_total === 'number') {
      counts.service = row.count_total;
    }
    // 'cards' entity → Cards issued count badge
    if (row.entity === 'cards' && typeof row.count_total === 'number') {
      counts.cards = row.count_total;
    }
  }
  return counts;
}

export function HubLayout({
  children,
  iframe = false,
}: {
  children: React.ReactNode;
  iframe?: boolean;
}) {
  const { session } = useSession();
  const [liveCounts, setLiveCounts] = useState<DashboardCounts>({
    field: null,
    service: null,
    cards: null,
  });

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
      <HubSidebar apps={sidebarApps} />
      {iframe ? (
        <div className="eq-hub__iframe-content">{children}</div>
      ) : (
        <div className="eq-hub__content">
          <main className="eq-hub-content">
            {children}
          </main>
        </div>
      )}
    </div>
  );
}
