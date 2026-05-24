import { useSession, moduleEnabled } from '../session';
import { HubSidebar, HUB_APP_ICONS, type HubApp } from './HubSidebar';

const HUB_APPS = [
  { key: 'field',   label: 'EQ Field',   to: 'field',   isBeta: false },
  { key: 'service', label: 'EQ Service', to: 'service', isBeta: false },
  { key: 'quotes',  label: 'EQ Quotes',  to: 'quotes',  isBeta: false },
  { key: 'cards',   label: 'EQ Cards',   to: 'cards',   isBeta: true  },
];

export function HubLayout({ children }: { children: React.ReactNode }) {
  const { session } = useSession();

  const sidebarApps: HubApp[] = HUB_APPS
    .filter((a) => session ? moduleEnabled(session, a.key) : false)
    .map((a) => ({
      key: a.key, label: a.label, to: a.to, isBeta: a.isBeta,
      count: null, hasAlert: false, icon: HUB_APP_ICONS[a.key],
    }));

  return (
    <div className="eq-hub">
      <HubSidebar apps={sidebarApps} />
      <div className="eq-hub__content">
        <main className="eq-hub-content">
          {children}
        </main>
      </div>
    </div>
  );
}
