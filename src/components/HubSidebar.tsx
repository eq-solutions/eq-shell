import { useParams, useLocation } from 'react-router-dom';
import {
  Users, Wrench, FileText, CreditCard, Building2, MapPin, User, Settings,
  Download, Users2, ClipboardList, Gauge, BarChart2, ShieldCheck, Database,
  ListChecks, BadgeCheck, ToggleLeft, Network,
} from 'lucide-react';
import { AppSidebar, type AppSidebarSection } from '@eq-solutions/ui';
import { useSession } from '../session';
import { useCan } from '../permissions';
import { useDensity } from '../lib/useDensity';
import { EqLogo } from './EqLogo';
import { TenantSwitcher } from './TenantSwitcher';

export interface HubApp {
  key: string;
  label: string;
  to: string;
  count: number | null;
  hasAlert: boolean;
  isBeta: boolean;
  icon: React.ReactNode;
}

export interface RecordLink {
  key: string;
  label: string;
  entity: string;
  count: number | null;
  to?: string;
  muted?: boolean;
  warn?: boolean;
}

export const HUB_APP_ICONS: Record<string, React.ReactNode> = {
  field:   <Users size={16} aria-hidden="true" />,
  service: <Wrench size={16} aria-hidden="true" />,
  quotes:  <FileText size={16} aria-hidden="true" />,
  cards:   <CreditCard size={16} aria-hidden="true" />,
  comms:   <Network size={16} aria-hidden="true" />,
};

const RECORD_ICONS: Record<string, React.ReactNode> = {
  customer:  <Building2 size={16} aria-hidden="true" />,
  site:      <MapPin size={16} aria-hidden="true" />,
  contact:   <User size={16} aria-hidden="true" />,
  staff:     <Users2 size={16} aria-hidden="true" />,
  licence:   <BadgeCheck size={16} aria-hidden="true" />,
  equipment: <Gauge size={16} aria-hidden="true" />,
};

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(' ');
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

interface Props {
  apps: HubApp[];
  records?: RecordLink[];
}

export function HubSidebar({ apps, records }: Props) {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const location = useLocation();
  const { session, logout } = useSession();
  const canEquipment = useCan('equipment.view');
  const canIntake = useCan('intake.view');
  const canReports = useCan('reports.view');
  const canAdmin = useCan('admin.list_users');
  const { compact, toggle: toggleDensity } = useDensity();

  if (!session || !tenantSlug) return null;

  function active(href: string): boolean {
    return location.pathname === href || location.pathname.startsWith(href + '/');
  }

  const userInitials = initials(session.user.name, session.user.email);
  const userName = session.user.name ?? session.user.email.split('@')[0].replace('.', ' ');
  const roleLabel = session.user.role.replace(/_/g, ' ').toUpperCase();

  const visibleRecords = (records ?? []).filter((r) => r.key !== 'equipment' || canEquipment);

  const sections: AppSidebarSection[] = [];

  if (visibleRecords.length > 0) {
    sections.push({
      key: 'records',
      label: 'Records',
      items: visibleRecords.map((r) => {
        const href = `/${tenantSlug}/${r.to ?? `data/${r.entity}`}`;
        return {
          key: r.key,
          label: r.label,
          href,
          icon: RECORD_ICONS[r.key],
          isActive: active(href),
          count: r.count ?? undefined,
          muted: r.muted,
          warn: r.warn,
          arrow: true,
        };
      }),
    });
  }

  sections.push({
    key: 'apps',
    label: 'Apps',
    items: apps.map((app) => {
      const href = `/${tenantSlug}/${app.to}`;
      return {
        key: app.key,
        label: app.label,
        href,
        icon: app.icon,
        isActive: active(href),
        count: app.count ?? undefined,
        badge: app.isBeta ? 'BETA' : undefined,
        hasAlert: app.hasAlert,
        arrow: true,
      };
    }),
  });

  if (canReports) {
    const href = `/${tenantSlug}/reports`;
    sections.push({
      key: 'reports',
      label: 'Reports',
      items: [{ key: 'reports', label: 'Reports', href, icon: <BarChart2 size={16} aria-hidden="true" />, isActive: active(href), arrow: true }],
    });
  }

  if (canAdmin || canIntake) {
    const adminItems = [];
    if (canAdmin) {
      adminItems.push(
        { key: 'users',          label: 'Users',           href: `/${tenantSlug}/admin/users`,          icon: <Users2 size={16} aria-hidden="true" />,       isActive: active(`/${tenantSlug}/admin/users`) },
        { key: 'audit',          label: 'Audit log',       href: `/${tenantSlug}/admin/audit`,          icon: <ClipboardList size={16} aria-hidden="true" />, isActive: active(`/${tenantSlug}/admin/audit`) },
        { key: 'migration',      label: 'Migration',       href: `/${tenantSlug}/admin/migration`,      icon: <ListChecks size={16} aria-hidden="true" />,    isActive: active(`/${tenantSlug}/admin/migration`) },
        { key: 'access-control', label: 'Security groups', href: `/${tenantSlug}/admin/access-control`, icon: <ShieldCheck size={16} aria-hidden="true" />,   isActive: active(`/${tenantSlug}/admin/access-control`) },
        { key: 'data-activation', label: 'App activation',   href: `/${tenantSlug}/admin/data-activation`, icon: <ToggleLeft size={16} aria-hidden="true" />,    isActive: active(`/${tenantSlug}/admin/data-activation`) },
        { key: 'settings',       label: 'Settings',        href: `/${tenantSlug}/admin/settings`,       icon: <Settings size={16} aria-hidden="true" />,      isActive: active(`/${tenantSlug}/admin/settings`) },
      );
    }
    if (canIntake) {
      adminItems.push({ key: 'import', label: 'Import', href: `/${tenantSlug}/intake`, icon: <Download size={16} aria-hidden="true" />, isActive: active(`/${tenantSlug}/intake`), arrow: true as const });
    }
    sections.push({ key: 'admin', label: 'Admin', items: adminItems });
  }

  sections.push({
    key: 'security',
    label: 'Security',
    items: [{
      key: '2fa', label: 'Two-factor security',
      href: `/${tenantSlug}/settings/2fa`,
      icon: <ShieldCheck size={16} aria-hidden="true" />,
      isActive: active(`/${tenantSlug}/settings/2fa`),
      arrow: true,
    }],
  });

  if (session.user.is_platform_admin) {
    sections.push({
      key: 'platform',
      label: 'Platform',
      items: [{ key: 'tenants', label: 'Tenants', href: '/_platform/tenants', icon: <Database size={16} aria-hidden="true" />, isActive: active('/_platform/tenants') }],
    });
  }

  return (
    <AppSidebar
      homeHref={`/${tenantSlug}`}
      logo={<EqLogo size={28} />}
      brandLabel="CORE"
      live
      tenantSwitcher={session.memberships && session.memberships.length > 1 ? <TenantSwitcher /> : undefined}
      sections={sections}
      user={{
        initials: userInitials,
        name: userName,
        meta: `${roleLabel} · ${session.tenant.name}`,
      }}
      compact={compact}
      onToggleCompact={toggleDensity}
      onLogout={() => void logout()}
      storageKey="eq-shell-sidebar-collapsed"
    />
  );
}
