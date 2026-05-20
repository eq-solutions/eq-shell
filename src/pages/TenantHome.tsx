import { Link, useParams } from 'react-router-dom';
import { useSession, moduleEnabled } from '../session';
import { useBrand } from '../brand';

interface ModuleDef {
  key: string;
  label: string;
  description: string;
  to: string;
}

// Source of truth for which modules can ever be shown. Entitlements
// table on canonical Supabase decides which of these light up per
// tenant. New modules appended here.
const MODULES: ModuleDef[] = [
  { key: 'field', label: 'EQ Field', description: 'Roster, timesheets, sites.', to: 'field' },
  { key: 'cards', label: 'Cards', description: 'Tradie wallet — licences + tap-to-copy.', to: 'cards' },
  { key: 'intake', label: 'Intake', description: 'Coming soon.', to: 'intake' },
  { key: 'quotes', label: 'Quotes', description: 'Coming soon.', to: 'quotes' },
  { key: 'service', label: 'Service', description: 'Coming soon.', to: 'service' },
  {
    key: 'tender_pipeline',
    label: 'Tender Pipeline',
    description: 'Coming soon.',
    to: 'tender-pipeline',
  },
];

export default function TenantHome() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session, logout } = useSession();
  const brand = useBrand();

  if (!session) return null;

  const enabledModules = MODULES.filter((m) => moduleEnabled(session, m.key));

  return (
    <div className="eq-shell">
      <div className="eq-topbar">
        <div className="brand">
          <span className="swatch" aria-hidden="true" />
          {brand.name}
        </div>
        <div className="who">
          {session.user.email} <button onClick={logout} style={{ marginLeft: 12 }}>Sign out</button>
        </div>
      </div>
      <div className="eq-tenant-home">
        <h1>{brand.name}</h1>
        <p className="lede">Pick a module to get started.</p>
        {enabledModules.length === 0 ? (
          <p>No modules enabled for this tenant yet. Talk to your EQ admin.</p>
        ) : (
          <div className="eq-modules">
            {enabledModules.map((m) => (
              <Link
                key={m.key}
                to={`/${tenantSlug}/${m.to}`}
                className="eq-module-card"
              >
                <h3>{m.label}</h3>
                <p>{m.description}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
