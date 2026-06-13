import { useParams, useMatch } from 'react-router-dom';
import { Users, Wrench, FileText, CreditCard } from 'lucide-react';
import { AppRail, type AppRailItem } from '@eq-solutions/ui';
import { useSession, type EqTier } from '../session';
import { EqLogo } from './EqLogo';
import { MobileTabBar } from './MobileTabBar';

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(' ');
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

const TRIAL_TIERS: EqTier[] = ['trial'];

interface RailItemDef {
  key: string;
  label: string;
  icon: React.ReactNode;
  to: string;
  hideForTier?: EqTier[];
}

const RAIL_ITEMS: RailItemDef[] = [
  { key: 'field',   label: 'EQ Field',   icon: <Users size={20} strokeWidth={2} aria-hidden="true" />,      to: 'field'   },
  { key: 'service', label: 'EQ Service', icon: <Wrench size={20} strokeWidth={2} aria-hidden="true" />,     to: 'service' },
  { key: 'quotes',  label: 'EQ Ops',     icon: <FileText size={20} strokeWidth={2} aria-hidden="true" />,   to: 'quotes',  hideForTier: TRIAL_TIERS },
  { key: 'cards',   label: 'EQ Cards',   icon: <CreditCard size={20} strokeWidth={2} aria-hidden="true" />, to: 'cards'   },
];

export function IconRail() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session, logout } = useSession();
  const match = useMatch('/:tenantSlug/:module/*');
  const activeModule = match?.params?.module ?? null;

  if (!session || !tenantSlug) return null;

  const tier: EqTier = session.tenant.tier;
  const isAdmin = (session.user.role as string) === 'manager' || session.user.is_platform_admin;
  const userInitials = initials(session.user.name, session.user.email);
  const userName = session.user.name ?? session.user.email.split('@')[0].replace('.', ' ');

  const railItems: AppRailItem[] = RAIL_ITEMS.map((item) => {
    const isDisabled = item.hideForTier?.includes(tier) ?? false;
    return {
      key: item.key,
      label: item.label,
      icon: item.icon,
      href: `/${tenantSlug}/${item.to}`,
      isActive: activeModule === item.key,
      isDisabled,
      disabledTitle: isDisabled ? `Upgrade to access ${item.label}` : undefined,
    };
  });

  return (
    <>
      <AppRail
        homeHref={`/${tenantSlug}`}
        logo={<EqLogo size={28} onDark variant="mark" />}
        items={railItems}
        settingsHref={isAdmin ? `/${tenantSlug}/admin/settings` : undefined}
        settingsActive={activeModule === 'admin'}
        user={{ initials: userInitials, name: userName }}
        onLogout={() => void logout()}
      />
      <MobileTabBar />
    </>
  );
}
