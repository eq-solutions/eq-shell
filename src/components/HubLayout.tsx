import { useEffect, useState } from 'react';
import { AppShell } from '@eq-solutions/ui';
import { useSession, moduleEnabled } from '../session';
import { HubSidebar, HUB_APP_ICONS, type HubApp, type RecordLink } from './HubSidebar';
import { IconRail } from './IconRail';

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

const HUB_APPS: Array<{ key: string; label: string; to: string; isBeta: boolean; alwaysShow?: boolean; platformOnly?: boolean }> = [
  { key: 'field',     label: 'EQ Field',   to: 'field',     isBeta: false },
  { key: 'service',   label: 'EQ Service', to: 'service',   isBeta: false },
  // EQ Quotes — the standalone tool the team uses today (external redirect).
  { key: 'eq-quotes', label: 'EQ Quotes',  to: 'eq-quotes', isBeta: false, alwaysShow: true },
  // EQ Ops — in-shell replacement; gated on the `ops` module entitlement (per-tenant) + platform admins.
  { key: 'ops',       label: 'EQ Ops',     to: 'ops',       isBeta: false, platformOnly: true },
  { key: 'cards',     label: 'EQ Cards',   to: 'cards',     isBeta: true  },
  { key: 'comms',     label: 'NSW Comms',  to: 'comms',     isBeta: true  },
];

interface DashboardCounts {
  field:   number | null;
  service: number | null;
  quotes:  number | null;
}

function extractCounts(data: DashboardResponse): DashboardCounts {
  const counts: DashboardCounts = { field: null, service: null, quotes: null };
  if (!data.ok || !data.counts) return counts;
  for (const row of data.counts) {
    if (typeof row.count_total !== 'number') continue;
    switch (row.entity) {
      case 'staff':    counts.field   = row.count_total; break;
      case 'incident': counts.service = row.count_total || null; break;
      case 'quote':    counts.quotes  = row.count_total || null; break;
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
  fullWidth?: boolean;
  /** @deprecated Use `iframe` instead. */
  hideMainSidebar?: boolean;
  sidebarRecords?: RecordLink[];
}) {
  const { session } = useSession();
  const [liveCounts, setLiveCounts] = useState<DashboardCounts>({
    field: null, service: null, quotes: null,
  });

  useEffect(() => {
    if (!session || iframe || hideMainSidebar) return;
    const cacheKey = `dashboard:${session.tenant.slug ?? 'default'}`;
    const cached = getCachedDashboard(cacheKey);
    if (cached) { setLiveCounts(extractCounts(cached)); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/tenant-dashboard', { credentials: 'include' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as DashboardResponse;
        if (!cancelled) { setCachedDashboard(cacheKey, data); setLiveCounts(extractCounts(data)); }
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [session, iframe, hideMainSidebar]);

  if (iframe || hideMainSidebar) {
    return (
      <AppShell mode="rail" rail={<IconRail />}>
        {children}
      </AppShell>
    );
  }

  const sidebarApps: HubApp[] = HUB_APPS
    .filter((a) => a.platformOnly
      ? ((session?.user.is_platform_admin ?? false) || (session ? moduleEnabled(session, a.key) : false))
      : (a.alwaysShow || (session ? moduleEnabled(session, a.key) : false)))
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
    <AppShell
      sidebar={<HubSidebar apps={sidebarApps} records={sidebarRecords} />}
      fullWidth={fullWidth}
    >
      {children}
    </AppShell>
  );
}
