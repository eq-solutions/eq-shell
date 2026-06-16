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
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';
import { createSupabaseClient } from '../lib/supabaseJwt';
import type { EqRole } from '../session';

interface SecurityGroup {
  id: string;
  name: string;
  description: string | null;
}

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

  const [name, setName] = useState('');
  const [role, setRole] = useState<EqRole>('employee');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  const [allGroups, setAllGroups] = useState<SecurityGroup[]>([]);
  const [userGroupIds, setUserGroupIds] = useState<Set<string>>(new Set());
  const [groupBusy, setGroupBusy] = useState<string | null>(null);
  const [groupErr, setGroupErr] = useState<string | null>(null);
  const [groupLoading, setGroupLoading] = useState(true);

  const isPlatformAdmin = session?.user.is_platform_admin ?? false;

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
      setName(row.name ?? '');
      setRole(row.role);
      setActive(row.active);
    } catch (e) {
      setLoadErr((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setGroupLoading(true);
    setGroupErr(null);
    void (async () => {
      try {
        const [allRes, userRes] = await Promise.all([
          fetch('/.netlify/functions/security-groups?action=list', { credentials: 'include' }),
          fetch(`/.netlify/functions/security-groups?action=user_groups&user_id=${userId}`, { credentials: 'include' }),
        ]);
        const allBody = (await allRes.json()) as { ok: boolean; groups?: SecurityGroup[] };
        const userBody = (await userRes.json()) as { ok: boolean; groups?: SecurityGroup[] };
        if (!allBody.ok || !userBody.ok) {
          setGroupErr('Could not load security groups. Try refreshing.');
        } else {
          setAllGroups(allBody.groups ?? []);
          setUserGroupIds(new Set((userBody.groups ?? []).map((g) => g.id)));
        }
      } catch {
        setGroupErr('Could not load security groups. Try refreshing.');
      } finally {
        setGroupLoading(false);
      }
    })();
  }, [userId]);

  if (loadErr) {
    return (
      <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
        <EqError title="Could not load user" message={loadErr} onRetry={load} />
        <p style={{ marginTop: 16 }}>
          <Link to={`/${tenantSlug}/admin/users`}>← Back to users</Link>
        </p>
      </HubLayout>
    );
  }

  if (!target) {
    return (
      <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
        <Skeleton variant="card" />
      </HubLayout>
    );
  }

  if (target.id === session?.user.id) {
    return (
      <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
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
      const patch: { name?: string; role?: EqRole; active?: boolean } = {};
      const trimmedName = name.trim();
      if (trimmedName && trimmedName !== (target.name ?? '')) patch.name = trimmedName;
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
          'cannot-edit-platform-admin': 'This account can\'t be edited here. Contact EQ support if you need to make changes.',
          'user-not-found':            'User not found.',
          'bad-name':                  'Enter a name (up to 120 characters).',
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
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <div className="eq-page__header">
        <h1 className="eq-page__title">
          {target.name ?? target.email.split('@')[0]}
        </h1>
        <p className="eq-page__lede">
          {target.email}
          {target.is_platform_admin && isPlatformAdmin && (
            <span className="eq-pill eq-pill--info" style={{ marginLeft: 8 }}>
              Managed by EQ
            </span>
          )}
        </p>
      </div>

      <form onSubmit={onSubmit} style={{ maxWidth: 480 }}>
        <label htmlFor="edit-name" style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--eq-grey)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Display name
        </label>
        <input
          id="edit-name"
          type="text"
          autoComplete="off"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
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
        />

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

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', rowGap: 8 }}>
          <Button
            type="submit"
            variant="primary"
            disabled={busy}
            style={{ padding: '0 20px' }}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
          <Link to={`/${tenantSlug}/admin/users`} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '6px 12px', borderRadius: 6, border: '1px solid var(--gray-200)', fontSize: 13, color: 'var(--eq-ink)', background: 'transparent' }}>
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

      <section className="eq-section" style={{ marginTop: 40, maxWidth: 480 }}>
        <h2 className="eq-section__heading">Security groups</h2>
        <p style={{ fontSize: 14, color: 'var(--eq-grey)', marginBottom: 16 }}>
          Extra permissions granted on top of this user's role. Changes take
          effect on their next page load.
        </p>

        {groupErr && (
          <div className="eq-err" role="alert" style={{ marginBottom: 12 }}>
            {groupErr}
          </div>
        )}

        {groupLoading ? (
          <Skeleton variant="row" count={2} />
        ) : allGroups.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--eq-grey)' }}>
            No security groups set up yet.{' '}
            <Link to={`/${tenantSlug}/admin/access-control`}>Go to Security groups</Link>{' '}
            to create one.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {allGroups.map((group) => {
              const isMember = userGroupIds.has(group.id);
              const isThisGroupBusy = groupBusy === group.id;
              return (
                <label
                  key={group.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 12px',
                    border: '1px solid var(--eq-border)',
                    borderRadius: 6,
                    cursor: isThisGroupBusy ? 'wait' : 'pointer',
                    background: isMember ? 'var(--eq-ice)' : 'var(--eq-bg)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isMember}
                    disabled={isThisGroupBusy}
                    style={{ marginTop: 2, flexShrink: 0 }}
                    onChange={async () => {
                      if (!target) return;
                      setGroupErr(null);
                      setGroupBusy(group.id);
                      try {
                        const action = isMember ? 'remove_member' : 'add_member';
                        const res = await fetch('/.netlify/functions/security-groups', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({ action, id: group.id, user_id: target.id }),
                        });
                        const body = (await res.json()) as { ok: boolean; error?: string };
                        if (!body.ok) {
                          setGroupErr(`Could not update group: ${body.error ?? 'unknown error'}`);
                        } else {
                          setUserGroupIds((prev) => {
                            const next = new Set(prev);
                            if (isMember) next.delete(group.id); else next.add(group.id);
                            return next;
                          });
                        }
                      } catch {
                        setGroupErr('Network error — please try again.');
                      } finally {
                        setGroupBusy(null);
                      }
                    }}
                  />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{group.name}</div>
                    {group.description && (
                      <div style={{ fontSize: 12, color: 'var(--eq-grey)', marginTop: 2 }}>
                        {group.description}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
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
        <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
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
