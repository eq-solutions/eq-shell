// Admin list of users in the current tenant.
//
// Gated by useCan('admin.list_users') — manager + platform_admin only.
// Calls the eq_list_tenant_users RPC (added 2026-05-21) because after
// the Phase 1.F schema split, shell_control.users is not on the
// PostgREST exposed-schemas list. The RPC lives in public, gates on
// JWT app_metadata role + platform_admin, and tenant-scopes server-side.
//
// Each row links to /<tenant>/admin/users/<id> for edit. The list
// page itself has an "Invite a user" button that routes to
// /<tenant>/admin/users/invite.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UsersRound } from 'lucide-react';
import { useSession } from '../session';
import { Gate } from '../permissions/Gate';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();
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
  last_login_at: string | null;
}

function roleLabel(role: EqRole): string {
  return role
    .split('_')
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(' ');
}

function formatLastLogin(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

function AdminUserListInner() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session } = useSession();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setErr(null);
    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb.rpc('eq_list_tenant_users');
      if (error) {
        setErr(error.message);
        return;
      }
      setUsers((data as UserRow[] | null) ?? []);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <div className="eq-page__header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <h1 className="eq-page__title">Users</h1>
            <p className="eq-page__lede">
              Your team members and their roles.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Link
              to={`/${tenantSlug}/admin/users/migrate`}
              style={{ width: 'auto', padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none', height: 40, background: 'transparent', color: 'var(--eq-deep)', borderRadius: 6, fontWeight: 600, fontSize: 14, border: '1px solid var(--eq-border)' }}
            >
              <UsersRound size={16} aria-hidden="true" />
              Invite migrated staff
            </Link>
            <Link
              to={`/${tenantSlug}/admin/users/invite`}
              style={{ width: 'auto', padding: '0 16px', display: 'inline-flex', alignItems: 'center', textDecoration: 'none', height: 40, background: 'var(--eq-sky)', color: '#fff', borderRadius: 6, fontWeight: 600, fontSize: 14, border: 'none' }}
            >
              + Invite user
            </Link>
          </div>
        </div>

        {err && <EqError title="Couldn't load users" message={err} onRetry={load} />}

        <div className="eq-table-wrap">
          <table className="eq-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {users === null ? (
                <tr>
                  <td colSpan={5}>
                    <Skeleton variant="row" count={4} />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--eq-grey)' }}>
                    No users yet. Invite the first one.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span style={{ fontWeight: 500 }}>
                        {u.name ?? u.email.split('@')[0]}
                      </span>
                      <span className="eq-table__mute" style={{ display: 'block', fontSize: 12 }}>
                        {u.email}
                      </span>
                      {u.is_platform_admin && (
                        <span
                          className="eq-pill eq-pill--info"
                          style={{ marginLeft: 0, marginTop: 4, display: 'inline-block' }}
                          title="EQ Solutions internal cross-tenant access"
                        >
                          Platform admin
                        </span>
                      )}
                      {u.id === session?.user.id && (
                        <span className="eq-table__mute" style={{ marginLeft: 4 }}>
                          (you)
                        </span>
                      )}
                    </td>
                    <td>{roleLabel(u.role)}</td>
                    <td>
                      <span className={`eq-pill ${u.active ? 'eq-pill--ok' : 'eq-pill--mute'}`}>
                        {u.active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="eq-table__mute">{formatLastLogin(u.last_login_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {u.id !== session?.user.id && (
                        <Link
                          to={`/${tenantSlug}/admin/users/${u.id}`}
                          style={{ color: 'var(--eq-deep)', fontSize: 13 }}
                        >
                          Edit
                        </Link>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
    </HubLayout>
  );
}

export default function AdminUserList() {
  return (
    <Gate
      perm="admin.list_users"
      fallback={
        <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
          <div className="eq-empty">
            <p className="eq-empty__title">Not allowed</p>
            <p>Only managers can manage users.</p>
          </div>
        </HubLayout>
      }
    >
      <AdminUserListInner />
    </Gate>
  );
}
