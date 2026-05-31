import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession, type EqRole } from '../session';

const ROLE_LABELS: Record<EqRole, string> = {
  manager: 'Manager',
  supervisor: 'Supervisor',
  employee: 'Team member',
  apprentice: 'Apprentice',
  labour_hire: 'Labour hire',
};

export function TenantSwitcher() {
  const { session, refresh } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  if (!session) return null;
  if (session.memberships.length <= 1) return null;

  async function switchTo(tenantId: string): Promise<void> {
    if (busyId) return;
    setBusyId(tenantId);
    setErr(null);
    try {
      const res = await fetch('/.netlify/functions/switch-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const body = (await res.json()) as { valid: boolean; tenant?: { slug: string }; error?: string };
      if (!body.valid) {
        setErr('Could not switch — try again.');
        setBusyId(null);
        return;
      }
      void refresh();
      setOpen(false);
      navigate(`/${body.tenant?.slug ?? ''}`, { replace: true });
    } catch {
      setErr('Network error.');
      setBusyId(null);
    }
  }

  const others = session.memberships.filter((m) => m.tenant_id !== session.tenant.id);

  return (
    <div ref={ref} style={wrapStyle}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={triggerStyle}
        title="Switch workspace"
      >
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.tenant.name}
        </span>
        <span aria-hidden="true" style={{ marginLeft: 8, color: '#64748B' }}>
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        <div role="listbox" style={menuStyle}>
          <div style={menuHeadStyle}>Switch workspace</div>
          {others.map((m) => {
            const busy = busyId === m.tenant_id;
            const label = m.tenant_name ?? 'Workspace';
            return (
              <button
                key={m.tenant_id}
                type="button"
                onClick={() => void switchTo(m.tenant_id)}
                disabled={busyId !== null}
                style={busy ? { ...menuItemStyle, ...menuItemBusyStyle } : menuItemStyle}
              >
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div style={menuItemNameStyle}>{label}</div>
                  <div style={menuItemRoleStyle}>{ROLE_LABELS[m.role] ?? m.role}</div>
                </div>
                <span style={{ fontSize: 13, color: 'var(--eq-deep, #2986B4)' }}>{busy ? '…' : 'Enter →'}</span>
              </button>
            );
          })}
          {err && <div role="alert" style={menuErrStyle}>{err}</div>}
        </div>
      )}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
};

const triggerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: '8px 10px',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--eq-ink, #1A1A2E)',
};

const menuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  marginTop: 4,
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  padding: 6,
  zIndex: 50,
  maxHeight: 320,
  overflowY: 'auto',
};

const menuHeadStyle: React.CSSProperties = {
  padding: '6px 10px 8px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.04em',
  color: '#64748B',
  textTransform: 'uppercase',
};

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: '10px 10px',
  background: 'transparent',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  color: 'var(--eq-ink, #1A1A2E)',
};

const menuItemBusyStyle: React.CSSProperties = {
  opacity: 0.6,
  cursor: 'wait',
};

const menuItemNameStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
};

const menuItemRoleStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#64748B',
  marginTop: 1,
};

const menuErrStyle: React.CSSProperties = {
  margin: '6px 4px 2px',
  padding: '8px 10px',
  fontSize: 12,
  background: '#FEF2F2',
  border: '1px solid #FECACA',
  borderRadius: 6,
  color: '#B91C1C',
};
