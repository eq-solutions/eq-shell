import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession, type EqRole } from '../session';
import { EqLogo } from '../components/EqLogo';

export interface PendingTenantSelection {
  user_id: string;
  selection_token: string;
  memberships: Array<{
    tenant_id: string;
    role: EqRole;
    tenant_slug: string;
    tenant_name: string;
  }>;
  preferred_tenant_id: string | null;
}

const PENDING_KEY = 'eq_pending_tenant_selection';

export function storePendingSelection(p: PendingTenantSelection): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    // ignore storage errors
  }
}

export function readPendingSelection(): PendingTenantSelection | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingTenantSelection) : null;
  } catch {
    return null;
  }
}

export function clearPendingSelection(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

const ROLE_LABELS: Record<EqRole, string> = {
  manager: 'Manager',
  supervisor: 'Supervisor',
  employee: 'Team member',
  apprentice: 'Apprentice',
  labour_hire: 'Labour hire',
};

export default function TenantPicker() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [pending] = useState<PendingTenantSelection | null>(() => readPendingSelection());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) {
      navigate('/', { replace: true });
    }
  }, [pending, navigate]);

  if (!pending) return null;

  async function choose(tenantId: string, tenantSlug: string): Promise<void> {
    if (!pending) return;
    setBusyId(tenantId);
    setErr(null);
    try {
      const res = await fetch('/.netlify/functions/select-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          user_id: pending.user_id,
          tenant_id: tenantId,
          selection_token: pending.selection_token,
        }),
      });
      const body = (await res.json()) as { valid: boolean; tenant?: { slug: string }; error?: string };
      if (!body.valid) {
        if (body.error === 'invalid-selection-token') {
          setErr('Your sign-in attempt expired. Please sign in again.');
          clearPendingSelection();
          setTimeout(() => navigate('/', { replace: true }), 1500);
          return;
        }
        setErr('Could not enter that workspace. Try another, or sign in again.');
        setBusyId(null);
        return;
      }
      clearPendingSelection();
      void refresh();
      navigate(`/${body.tenant?.slug ?? tenantSlug}`, { replace: true });
    } catch {
      setErr('Network error — please try again.');
      setBusyId(null);
    }
  }

  const preferredId = pending.preferred_tenant_id;
  const ordered = [...pending.memberships].sort((a, b) => {
    if (a.tenant_id === preferredId) return -1;
    if (b.tenant_id === preferredId) return 1;
    return a.tenant_name.localeCompare(b.tenant_name);
  });

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ marginBottom: 24 }}>
          <EqLogo size={28} />
        </div>
        <h1 style={titleStyle}>Choose a workspace</h1>
        <p style={subtitleStyle}>
          You belong to more than one workspace. Pick the one you want to use right now — you can switch any time.
        </p>

        <ul style={listStyle}>
          {ordered.map((m) => {
            const busy = busyId === m.tenant_id;
            return (
              <li key={m.tenant_id} style={{ listStyle: 'none' }}>
                <button
                  type="button"
                  onClick={() => void choose(m.tenant_id, m.tenant_slug)}
                  disabled={busyId !== null}
                  style={busy ? { ...itemStyle, ...itemBusyStyle } : itemStyle}
                  onMouseEnter={(e) => { if (busyId === null) e.currentTarget.style.borderColor = '#3DA8D8'; }}
                  onMouseLeave={(e) => { if (busyId === null) e.currentTarget.style.borderColor = '#E2E8F0'; }}
                >
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={tenantNameStyle}>{m.tenant_name}</div>
                    <div style={tenantRoleStyle}>{ROLE_LABELS[m.role] ?? m.role}</div>
                  </div>
                  <span style={enterStyle}>{busy ? 'Entering…' : 'Enter →'}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {err && (
          <div role="alert" style={errStyle}>
            {err}
          </div>
        )}

        <p style={footStyle}>
          Wrong account?{' '}
          <button
            type="button"
            style={linkStyle}
            onClick={() => { clearPendingSelection(); navigate('/', { replace: true }); }}
          >
            Sign in as someone else
          </button>
        </p>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: '100svh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#EAF5FB',
  padding: 24,
  fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
  color: '#1A1A2E',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 460,
  background: '#FFFFFF',
  borderRadius: 12,
  border: '1px solid #E2E8F0',
  padding: 32,
};

const titleStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  margin: '0 0 8px',
  color: '#1A1A2E',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 14,
  color: '#475569',
  margin: '0 0 24px',
  lineHeight: 1.5,
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: '0 0 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  padding: '14px 16px',
  cursor: 'pointer',
  transition: 'border-color 120ms ease',
  fontFamily: 'inherit',
  color: 'inherit',
};

const itemBusyStyle: React.CSSProperties = {
  opacity: 0.6,
  cursor: 'wait',
};

const tenantNameStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: '#1A1A2E',
};

const tenantRoleStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#64748B',
  marginTop: 2,
};

const enterStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#2986B4',
};

const errStyle: React.CSSProperties = {
  marginTop: 16,
  padding: '10px 12px',
  borderRadius: 6,
  background: '#FEF2F2',
  border: '1px solid #FECACA',
  color: '#B91C1C',
  fontSize: 13,
};

const footStyle: React.CSSProperties = {
  marginTop: 24,
  fontSize: 13,
  color: '#64748B',
  textAlign: 'center',
};

const linkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#2986B4',
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
  textDecoration: 'underline',
};
