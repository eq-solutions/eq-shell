import { Link, useParams } from 'react-router-dom';
import { Users2, ShieldCheck, Settings, ClipboardList } from 'lucide-react';
import { HubLayout } from '../components/HubLayout';
import { Gate } from '../permissions/Gate';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

const TILES = [
  {
    key: 'people',
    to: 'admin/users',
    icon: <Users2 size={18} aria-hidden="true" />,
    title: 'People',
    desc: 'Manage users, set roles, and send worker invite links.',
  },
  {
    key: 'security',
    to: 'admin/access-control',
    icon: <ShieldCheck size={18} aria-hidden="true" />,
    title: 'Security groups',
    desc: 'Role permissions and what each person can access.',
  },
  {
    key: 'settings',
    to: 'admin/settings',
    icon: <Settings size={18} aria-hidden="true" />,
    title: 'Settings',
    desc: 'Workspace name, branding, and which apps are active.',
  },
  {
    key: 'audit',
    to: 'admin/audit',
    icon: <ClipboardList size={18} aria-hidden="true" />,
    title: 'Audit log',
    desc: 'Sign-in history and a record of every data import.',
  },
];

function AdminHubInner() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <div className="eq-page__header">
        <h1 className="eq-page__title">Admin</h1>
        <p className="eq-page__lede">Manage your workspace, users, and security settings.</p>
      </div>

      <div className="eq-modules">
        {TILES.map((tile) => (
          <Link
            key={tile.key}
            to={`/${tenantSlug}/${tile.to}`}
            className="eq-module-card"
          >
            <div className="eq-module-card__head">
              <h3>{tile.title}</h3>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'var(--eq-ice, #EAF5FB)',
                  color: 'var(--eq-sky, #3DA8D8)',
                  flexShrink: 0,
                }}
              >
                {tile.icon}
              </span>
            </div>
            <p>{tile.desc}</p>
          </Link>
        ))}
      </div>
    </HubLayout>
  );
}

export default function AdminHub() {
  return (
    <Gate
      perm="admin.list_users"
      fallback={
        <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
          <div className="eq-empty">
            <p className="eq-empty__title">Admin area requires manager access</p>
            <p>Talk to your manager if you need this.</p>
          </div>
        </HubLayout>
      }
    >
      <AdminHubInner />
    </Gate>
  );
}
