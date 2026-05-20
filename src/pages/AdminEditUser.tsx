// Admin form: edit one user in the current tenant.
//
// Reads `/<tenant>/admin/users/:userId`. Loads the target user via
// createSupabaseClient() (RLS enforces tenant scope). Allows the
// admin to change role, toggle active/inactive, or revoke. POSTs to
// /.netlify/functions/edit-user.
//
// Gated by useCan('admin.edit_user'). Self-edit is server-side
// rejected; the UI hides the form when the target is the current
// user.

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../session';
import { Gate } from '../permissions/Gate';
import { createSupabaseClient } from '../lib/supabaseJwt';
import type { EqRole } from '../session';

interface UserRow {
  id: string;
  email: string;
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

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const sb = await createSupabaseClient();
        const { data, error } = await sb
          .from('users')
          .select('id, email, role, is_platform_admin, active')
          .eq('id', userId)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          setLoadErr(error.message);
          return;
        }
        if (!data) {
          setLoadErr('User not found.');
          return;
        }
        const row = data as UserRow;
        setTarget(row);
        setRole(row.role);
        setActive(row.active);
      } catch (e) {
        if (!cancelled) setLoadErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loadErr) {
    return (
      <div className="eq-shell">
        <div className="eq-login">
          <h1>Could not load user</h1>
          <p className="lede">{loadErr}</p>
        </div>
      </div>
    );
  }
  if (!target) {
    return (
      <div className="eq-shell">
        <div className="eq-login">
          <p className="lede">Loading…</p>
        </div>
      </div>
    );
  }
  if (target.id === session?.user.id) {
    return (
      <div className="eq-shell">
        <div className="eq-login">
          <h1>Can't edit yourself</h1>
          <p className="lede">
            Ask another manager to change your role or deactivate your
            account. This rule prevents accidental lockouts.
          </p>
        </div>
      </div>
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
        // No-op save — go back to list.
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
    <div className="eq-shell">
      <form className="eq-login" onSubmit={onSubmit}>
        <h1>Edit user</h1>
        <p className="lede">
          {target.email}
          {target.is_platform_admin && (
            <span style={{ marginLeft: 8, color: 'var(--eq-deep)' }}>(platform admin)</span>
          )}
        </p>

        <label htmlFor="edit-role">Role</label>
        <select
          id="edit-role"
          value={role}
          onChange={(e) => setRole(e.target.value as EqRole)}
          disabled={busy}
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px solid var(--eq-border)',
            borderRadius: 6,
            marginBottom: 16,
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
            marginBottom: 16,
            fontSize: 14,
            fontWeight: 400,
          }}
        >
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            disabled={busy}
            style={{ width: 'auto', margin: 0 }}
          />
          Active (uncheck to deactivate)
        </label>

        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>

        {saveErr && (
          <div className="err" role="alert">
            {saveErr}
          </div>
        )}

        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--eq-mute)' }}>
          Role changes take effect on the user's next login. Deactivating
          a user logs them out on their next request.
        </p>
      </form>
    </div>
  );
}

export default function AdminEditUser() {
  return (
    <Gate
      perm="admin.edit_user"
      fallback={
        <div className="eq-shell">
          <div className="eq-login">
            <h1>Not allowed</h1>
            <p className="lede">Only managers can edit users.</p>
          </div>
        </div>
      }
    >
      <AdminEditUserInner />
    </Gate>
  );
}
