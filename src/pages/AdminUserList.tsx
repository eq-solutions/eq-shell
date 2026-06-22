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
import { Link, useNavigate, useParams } from 'react-router-dom';
import { UsersRound } from 'lucide-react';
import { Table, type TableColumn } from '@eq-solutions/ui';
import { useSession } from '../session';
import { Gate } from '../permissions/Gate';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();
import { EqError } from '../components/EqError';
import { createSupabaseClient } from '../lib/supabaseJwt';
import type { EqRole } from '../session';

interface UserRow {
  id: string;
  email: string | null;
  name: string | null;
  role: EqRole;
  is_platform_admin: boolean;
  active: boolean;
  last_login_at: string | null;
}

// A user row can arrive with a null email/name (e.g. an invite stub that never
// completed). Never let one bad row white-screen the whole page.
function displayName(u: UserRow): string {
  if (u.name) return u.name;
  if (u.email) return u.email.split('@')[0];
  return '(no email)';
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
  const navigate = useNavigate();
  const { session } = useSession();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const columns: TableColumn<UserRow>[] = [
    {
      key: 'name',
      header: 'Name',
      sortAccessor: (u) => (u.name ?? u.email ?? '').toLowerCase(),
      render: (u) => (
        <>
          <span style={{ fontWeight: 500 }}>{displayName(u)}</span>
          <span className="eq-table__mute" style={{ display: 'block', fontSize: 12 }}>
            {u.email ?? '—'}
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
        </>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortAccessor: (u) => u.role,
      render: (u) => roleLabel(u.role),
    },
    {
      key: 'active',
      header: 'Status',
      sortAccessor: (u) => (u.active ? 1 : 0),
      render: (u) => (
        <span className={`eq-pill ${u.active ? 'eq-pill--ok' : 'eq-pill--mute'}`}>
          {u.active ? 'Active' : 'Deactivated'}
        </span>
      ),
    },
    {
      key: 'last_login_at',
      header: 'Last login',
      sortAccessor: (u) => (u.last_login_at ? new Date(u.last_login_at).getTime() : 0),
      render: (u) => <span className="eq-table__mute">{formatLastLogin(u.last_login_at)}</span>,
    },
  ];

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
      <div className="eq-page__header eq-admin-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <h1 className="eq-page__title">Users</h1>
            <p className="eq-page__lede">
              Your team members and their roles.
            </p>
          </div>
          <div className="eq-admin-header-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Link
              to={`/${tenantSlug}/admin/workers`}
              className="eq-admin-action--secondary"
              style={{ width: 'auto', padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none', height: 40, background: 'transparent', color: 'var(--eq-deep)', borderRadius: 6, fontWeight: 600, fontSize: 14, border: '1px solid var(--eq-border)' }}
            >
              Worker invites (Cards)
            </Link>
            <Link
              to={`/${tenantSlug}/admin/users/migrate`}
              className="eq-admin-action--secondary"
              style={{ width: 'auto', padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none', height: 40, background: 'transparent', color: 'var(--eq-deep)', borderRadius: 6, fontWeight: 600, fontSize: 14, border: '1px solid var(--eq-border)' }}
            >
              <UsersRound size={16} aria-hidden="true" />
              Invite migrated staff
            </Link>
            <Link
              to={`/${tenantSlug}/admin/users/invite`}
              className="eq-admin-action--primary"
              style={{ width: 'auto', padding: '0 16px', display: 'inline-flex', alignItems: 'center', textDecoration: 'none', height: 40, background: 'var(--eq-sky)', color: '#fff', borderRadius: 6, fontWeight: 600, fontSize: 14, border: 'none' }}
            >
              + Invite user
            </Link>
          </div>
        </div>

        {err && <EqError title="Couldn't load users" message={err} onRetry={load} />}

        <Table<UserRow>
          columns={columns}
          rows={users ?? []}
          getRowId={(u) => u.id}
          loading={users === null}
          loadingRows={4}
          defaultSort={{ key: 'name', dir: 'asc' }}
          emptyMessage="No users yet. Invite the first one."
          globalSearch={{ placeholder: 'Search users…' }}
          slicers={[
            { key: 'active',      label: 'Active',      filter: (u) => u.active },
            { key: 'all',         label: 'All' },
            { key: 'deactivated', label: 'Deactivated', filter: (u) => !u.active },
          ]}
          onRowClick={(u) => {
            if (u.id !== session?.user.id) navigate(`/${tenantSlug}/admin/users/${u.id}`);
          }}
        />
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
