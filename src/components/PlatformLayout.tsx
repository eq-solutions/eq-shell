import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowLeft, Building2, Users } from 'lucide-react';
import { useSession } from '../session';
import { EqLogo } from './EqLogo';

// Tenant-less chrome for the platform-operator console (/_platform/*).
//
// HubLayout can't be reused here — its sidebar is tenant-scoped (it shows one
// tenant's modules + counts), but the platform console spans every tenant. So
// this is a deliberately minimal shell: a top bar (logo + "Platform operator"
// + a link back to the operator's own tenant) and a left nav sidebar with
// platform-level tools (Tenants, Workers).
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
      <div style={{ display: 'flex', minHeight: 'calc(100svh - 53px)' }}>
        {/* Left nav */}
        <nav
          style={{
            width: 200,
            flexShrink: 0,
            borderRight: '1px solid var(--eq-border, #e5e7eb)',
            background: 'var(--eq-surface, #fafafa)',
            padding: '16px 0',
          }}
        >
          <PlatformNavItem to="/_platform/tenants" icon={<Building2 size={15} />} label="Tenants" />
          <PlatformNavItem to="/_platform/workers" icon={<Users size={15} />} label="Workers" />
        </nav>
        <main className="eq-hub-content" style={{ flex: 1 }}>{children}</main>
      </div>
    </div>
  );
}

function PlatformNavItem({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: isActive ? 600 : 400,
        color: isActive ? 'var(--eq-deep, #2986B4)' : 'var(--eq-ink, #1A1A2E)',
        background: isActive ? 'var(--eq-ice, #EAF5FB)' : 'transparent',
        textDecoration: 'none',
        borderRadius: 0,
      })}
    >
      {icon}
      {label}
    </NavLink>
  );
}
