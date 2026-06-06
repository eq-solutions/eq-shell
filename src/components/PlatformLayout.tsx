import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useSession } from '../session';
import { EqLogo } from './EqLogo';

// Tenant-less chrome for the platform-operator console (/_platform/*).
//
// HubLayout can't be reused here — its sidebar is tenant-scoped (it shows one
// tenant's modules + counts), but the platform console spans every tenant. So
// this is a deliberately minimal shell: a top bar (logo + "Platform operator"
// + a link back to the operator's own tenant) over the same `eq-hub-content`
// body wrapper the tenant pages use, so page markup (eq-page__header etc.)
// renders identically without restyling.
export function PlatformLayout({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const tenantSlug = session?.tenant.slug;
  const tenantName = session?.tenant.name ?? tenantSlug;

  return (
    <div className="eq-platform">
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '12px 20px',
          borderBottom: '1px solid var(--eq-border, #e5e7eb)',
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <EqLogo size={26} variant="wordmark" />
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--eq-deep, #2986B4)',
              background: 'var(--eq-ice, #EAF5FB)',
              padding: '3px 8px',
              borderRadius: 5,
            }}
          >
            Platform operator
          </span>
        </div>
        {tenantSlug && (
          <Link
            to={`/${tenantSlug}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: 'var(--eq-deep, #2986B4)',
              textDecoration: 'none',
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to {tenantName}
          </Link>
        )}
      </header>
      <main className="eq-hub-content">{children}</main>
    </div>
  );
}
