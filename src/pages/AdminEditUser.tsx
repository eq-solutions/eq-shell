// Admin form: edit one user in the current tenant.
//
// Reads `/<tenant>/admin/users/:userId`. Loads the target via the
// eq_get_tenant_user RPC (added 2026-05-21) because shell_control.users
// is not exposed by PostgREST after the Phase 1.F schema split.
//
// Allows the admin to change role or toggle active/inactive. POSTs to
// /.netlify/functions/edit-user (which writes to shell_control via the
// service-role client).
//
// Gated by useCan('admin.edit_user'). Self-edit is server-side
// rejected; the UI hides the form when the target is the current user.

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@eq-solutions/ui';
import { useSession } from '../session';
import { Gate } from '../permissions/Gate';
import { HubLayout } from '../components/HubLayout';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';
import { createSupabaseClient } from '../lib/supabaseJwt';
import type { EqRole } from '../session';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: EqRole;
  is_platform_admin: boolean;
  active: boolean;
}

const ROLE_OPTIONS: { value: EqRole; label: string }[] = [
  { value: 'manager',     label: 'Manager' },
  { value: 'supervisor',  label: 'Supervisor' },
  { value: 'employee',    label: 'Employee' },
  { value: 'apprentice',  label: 'Apprentice' },
  { value: 'labour_hire', label: 'Labour Hire' },
];

function AdminEditUserInner() {
  const { tenantSlug, userId } = useParams<{ tenantSlug: string; userId: string }>();
  const navigate = useNavigate();
  const { session } = useSession();

  const [target, setTarget] = useState<UserRow | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [role, setRole] = useState<EqRole>('employee');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  const load = async () => {
    if (!userId) return;
    setLoadErr(null);
    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb.rpc('eq_get_tenant_user', { p_user_id: userId });
      if (error) {
        setLoadErr(error.message);
        return;
      }
      const rows = (data as UserRow[] | null) ?? [];
      if (rows.length === 0) {
        setLoadErr('User not found.');
        return;
      }
      const row = rows[0];
      setTarget(row);
      setRole(row.role);
      setActive(row.active);
    } catch (e) {
      setLoadErr((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, [userId]);

  if (loadErr) {
    return (
      <HubLayout>
        <EqError title="Could not load user" message={loadErr} onRetry={load} />
        <p style={{ marginTop: 16 }}>
          <Link to={`/${tenantSlug}/admin/users`}>← Back to users</Link>
        </p>
      </HubLayout>
    );
  }

  if (!target) {
    return (
      <HubLayout>
        <Skeleton variant="card" />
      </HubLayout>
    );
  }

  if (target.id === session?.user.id) {
    return (
      <HubLayout>
        <div className="eq-empty">
          <p className="eq-empty__title">Can't edit yourself</p>
          <p>
            Ask another manager to change your role or deactivate your account.
            This rule prevents accidental lockouts.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link to={`/${tenantSlug}/admin/users`}>← Back to users</Link>
          </p>
        </div>
      </HubLayout>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setSaveErr(null);
    setBusy(true);
    try {
      const patch: { role?: EqRole; active?: boolean } = {};
      if (role !== target.role) patch.role = role;
      if (active !== target.active) patch.active = active;
      if (Object.keys(patch).length === 0) {
        navigate(`/${tenantSlug}/admin/users`, { replace: true });
        return;
      }
      const res = await fetch('/.netlify/functions/edit-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ user_id: target.id, patch }),
      });
      const body = (await res.json()) as
        | { ok: true }
        | { ok: false; error?: string };
      if (!body.ok) {
        const map: Record<string, string> = {
          'unauthorized':              'Sign in again to edit users.',
          'forbidden':                 'Only managers can edit users.',
          'self-edit-forbidden':       'Can\'t edit yourself.',
          'cannot-edit-platform-admin':'Can\'t edit a platform admin.',
          'user-not-found':            'User not found.',
          'bad-role':                  'Pick a valid role.',
          'server-error':              'Something went wrong server-side — try again.',
        };
        setSaveErr(map[body.error ?? ''] ?? 'Save failed. Try again.');
        setBusy(false);
        return;
      }
      navigate(`/${tenantSlug}/admin/users`, { replace: true });
    } catch {
      setSaveErr('Network error — please try again.');
      setBusy(false);
    }
  }

  return (
    <HubLayout>
      <div className="eq-page__header">
        <h1 className="eq-page__title">
          {target.name ?? target.email.split('@')[0]}
        </h1>
        <p className="eq-page__lede">
          {target.email}
          {target.is_platform_admin && (
            <span className="eq-pill eq-pill--info" style={{ marginLeft: 8 }}>
              Platform admin
            </span>
          )}
        </p>
      </div>

      <form onSubmit={onSubmit} style={{ maxWidth: 480 }}>
        <label htmlFor="edit-role" style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--eq-grey)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Role
        </label>
        <select
          id="edit-role"
          value={role}
          onChange={(e) => setRole(e.target.value as EqRole)}
          disabled={busy}
          style={{
            width: '100%',
            height: 40,
            padding: '0 12px',
            border: '1px solid var(--gray-300)',
            borderRadius: 6,
            marginBottom: 20,
            background: 'var(--eq-bg)',
            color: 'var(--eq-ink)',
          }}
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 24,
            fontSize: 14,
          }}
        >
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            disabled={busy}
          />
          Active (uncheck to deactivate)
        </label>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button
            type="submit"
            variant="primary"
            disabled={busy}
            style={{ padding: '0 20px' }}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
          <Link to={`/${tenantSlug}/admin/users`} className="eq-btn eq-btn--ghost eq-btn--md" style={{ textDecoration: 'none' }}>
            Cancel
          </Link>
        </div>

        {saveErr && (
          <div className="eq-err" role="alert" style={{ marginTop: 16 }}>
            {saveErr}
          </div>
        )}

        <p style={{ marginTop: 24, fontSize: 12, color: 'var(--eq-grey)' }}>
          Role and status changes take effect immediately on the user's next
          page load. Deactivating a user blocks their next request.
        </p>
      </form>

      <section className="eq-section" style={{ marginTop: 40, maxWidth: 480 }}>
        <h2 className="eq-section__heading">PIN reset</h2>
        <p style={{ fontSize: 14, color: 'var(--eq-grey)', marginBottom: 16 }}>
          Generates a one-time reset link valid for 24 hours. Share it with
          the user — they'll set a new PIN and be signed straight in.
        </p>
        <Button
          type="button"
          variant="ghost"
          disabled={resetBusy}
          style={{ padding: '0 20px' }}
          onClick={async () => {
            if (!target) return;
            setResetErr(null);
            setResetUrl(null);
            setResetBusy(true);
            try {
              const res = await fetch('/.netlify/functions/reset-user-pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ user_id: target.id }),
              });
              const body = (await res.json()) as
                | { ok: true; reset_url: string; email_delivered: boolean }
                | { ok: false; error?: string };
              if (!body.ok) {
                setResetErr('Could not generate reset link. Try again.');
              } else {
                setResetUrl(body.reset_url);
              }
            } catch {
              setResetErr('Network error — please try again.');
            } finally {
              setResetBusy(false);
            }
          }}
        >
          {resetBusy ? 'Generating…' : 'Generate reset link'}
        </Button>

        {resetErr && (
          <div className="eq-err" role="alert" style={{ marginTop: 12 }}>
            {resetErr}
          </div>
        )}

        {resetUrl && (
          <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--eq-ice)', borderRadius: 6, border: '1px solid var(--eq-border)' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--eq-grey)', marginBottom: 8 }}>
              RESET LINK — share with {target?.email}
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                readOnly
                value={resetUrl}
                style={{ flex: 1, fontSize: 12, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', padding: '6px 10px', border: '1px solid var(--eq-border)', borderRadius: 4, background: 'var(--eq-bg)' }}
                onFocus={(e) => e.target.select()}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => void navigator.clipboard.writeText(resetUrl)}
              >
                Copy
              </Button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--eq-grey)', marginTop: 8 }}>
              Expires in 24 hours. One use only.
            </p>
          </div>
        )}
      </section>
    </HubLayout>
  );
}

export default function AdminEditUser() {
  return (
    <Gate
      perm="admin.edit_user"
      fallback={
        <HubLayout>
          <div className="eq-empty">
            <p className="eq-empty__title">Not allowed</p>
            <p>Only managers can edit users.</p>
          </div>
        </HubLayout>
      }
    >
      <AdminEditUserInner />
    </Gate>
  );
}
