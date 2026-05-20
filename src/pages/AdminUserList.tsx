// Admin list of users in the current tenant.
//
// Gated by useCan('admin.list_users') — manager + platform_admin only.
// Reads users via the canonical Supabase JWT (createSupabaseClient
// from src/lib/supabaseJwt.ts) so RLS does the tenant scoping
// server-side. The manager can't see users from other tenants even
// if they probe the API directly.
//
// Each row links to /<tenant>/admin/users/<id> for edit. The list
// page itself has an "Invite a user" button that routes to
// /<tenant>/admin/users/invite.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = await createSupabaseClient();
        const { data, error } = await sb
          .from('users')
          .select('id, email, role, is_platform_admin, active, last_login_at')
          .order('email');
        if (cancelled) return;
        if (error) {
          setErr(error.message);
          return;
        }
        setUsers((data as UserRow[] | null) ?? []);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <div className="eq-shell">
        <div className="eq-login">
          <h1>Could not load users</h1>
          <p className="lede">{err}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="eq-shell">
      <div className="eq-topbar">
        <div className="brand">
          <span className="swatch" aria-hidden="true" />
          Users
        </div>
        <Link
          to={`/${tenantSlug}/admin/users/invite`}
          style={{
            background: 'var(--eq-brand)',
            color: 'white',
            padding: '8px 14px',
            borderRadius: 6,
            textDecoration: 'none',
            fontWeight: 500,
            fontSize: 14,
          }}
        >
          + Invite user
        </Link>
      </div>
      <div className="eq-tenant-home">
        {users === null ? (
          <p className="lede">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="lede">No users yet. Invite the first one.</p>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              marginTop: 16,
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--eq-border)' }}>
                <th style={{ padding: '8px 0', fontSize: 13, color: 'var(--eq-mute)' }}>Email</th>
                <th style={{ padding: '8px 0', fontSize: 13, color: 'var(--eq-mute)' }}>Role</th>
                <th style={{ padding: '8px 0', fontSize: 13, color: 'var(--eq-mute)' }}>Status</th>
                <th style={{ padding: '8px 0', fontSize: 13, color: 'var(--eq-mute)' }}>Last login</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--eq-border)' }}>
                  <td style={{ padding: '10px 0' }}>
                    {u.email}
                    {u.is_platform_admin && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          padding: '2px 6px',
                          background: 'var(--eq-ice)',
                          color: 'var(--eq-deep)',
                          borderRadius: 4,
                          fontWeight: 500,
                        }}
                        title="EQ Solutions internal cross-tenant access"
                      >
                        platform admin
                      </span>
                    )}
                    {u.id === session?.user.id && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--eq-mute)' }}>(you)</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 0' }}>{roleLabel(u.role)}</td>
                  <td style={{ padding: '10px 0' }}>
                    {u.active ? (
                      <span style={{ color: 'var(--eq-ink)' }}>Active</span>
                    ) : (
                      <span style={{ color: 'var(--eq-mute)' }}>Deactivated</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 0', color: 'var(--eq-mute)', fontSize: 13 }}>
                    {formatLastLogin(u.last_login_at)}
                  </td>
                  <td style={{ padding: '10px 0', textAlign: 'right' }}>
                    {u.id !== session?.user.id && (
                      <Link
                        to={`/${tenantSlug}/admin/users/${u.id}`}
                        style={{ color: 'var(--eq-brand)', textDecoration: 'none', fontSize: 13 }}
                      >
                        Edit
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function AdminUserList() {
  return (
    <Gate
      perm="admin.list_users"
      fallback={
        <div className="eq-shell">
          <div className="eq-login">
            <h1>Not allowed</h1>
            <p className="lede">Only managers can manage users.</p>
          </div>
        </div>
      }
    >
      <AdminUserListInner />
    </Gate>
  );
}
