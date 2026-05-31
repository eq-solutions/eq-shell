// Admin form: invite a user to the current tenant.
//
// Gated by useCan('admin.invite_user') — visible only to managers +
// platform admins. The Netlify function enforces the same check
// server-side; this Gate is for UX, not security.
//
// Until the email provider is wired (EQ_EMAIL_PROVIDER env var),
// invite-user returns the invite_url in the response — the admin
// copies + pastes it to the recipient manually. The component shows
// the URL with a Copy button after a successful invite.

import React, { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@eq-solutions/ui';
import { Gate } from '../permissions/Gate';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();
import type { EqRole } from '../session';

const ROLE_OPTIONS: { value: EqRole; label: string; helper: string }[] = [
  { value: 'manager',     label: 'Manager',     helper: 'Business owner. Full control.' },
  { value: 'supervisor',  label: 'Supervisor',  helper: 'Approves work, manages a team.' },
  { value: 'employee',    label: 'Employee',    helper: 'Default working role.' },
  { value: 'apprentice',  label: 'Apprentice',  helper: 'Trainee with mentor visibility.' },
  { value: 'labour_hire', label: 'Labour Hire', helper: 'Minimal access — roster + own timesheet.' },
];

// Phase 1.F seed: the 6 modules currently surfaced in TenantHome.
// Extend here when new modules ship.
const MODULE_OPTIONS = [
  { key: 'field',           label: 'EQ Field' },
  { key: 'cards',           label: 'Cards' },
  { key: 'intake',          label: 'Intake' },
  { key: 'quotes',          label: 'Quotes' },
  { key: 'service',         label: 'Service' },
];

interface InviteSuccess {
  invite_id: string;
  invite_url: string;
  email_delivered: boolean;
}

function AdminInviteUserForm() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<EqRole>('employee');
  const [entitlements, setEntitlements] = useState<Set<string>>(new Set(['intake']));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<InviteSuccess | null>(null);

  function toggleEntitlement(key: string) {
    setEntitlements((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function copyInviteUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback — just leave the URL visible; user copies manually.
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await fetch('/.netlify/functions/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          role,
          entitlements: [...entitlements],
        }),
      });
      const body = (await res.json()) as
        | { ok: true; invite_id: string; invite_url: string; email_delivered: boolean }
        | { ok: false; error?: string };
      if (!body.ok) {
        const map: Record<string, string> = {
          'unauthorized':     'Sign in again to invite users.',
          'forbidden':        'Only managers can invite users.',
          'bad-email':        'That email doesn\'t look right.',
          'bad-role':         'Pick a role from the list.',
          'user-exists':      'A user with that email already exists.',
          'already-invited':  'An open invite for that email already exists.',
          'server-error':     'Something went wrong server-side — try again.',
        };
        setErr(map[body.error ?? ''] ?? 'Could not send the invite. Try again.');
        setBusy(false);
        return;
      }
      setSuccess({
        invite_id: body.invite_id,
        invite_url: body.invite_url,
        email_delivered: body.email_delivered,
      });
      setEmail('');
      setBusy(false);
    } catch {
      setErr('Network error — please try again.');
      setBusy(false);
    }
  }

  return (
    <InviteShell>
      <div className="eq-page__header">
        <h1 className="eq-page__title">Invite a user</h1>
        <p className="eq-page__lede">
          They get a one-time link to set their PIN and land straight on the hub.
        </p>
      </div>
      <form onSubmit={onSubmit} style={{ maxWidth: 520 }}>

        <div style={{ marginBottom: 20 }}>
          <label htmlFor="invite-email" style={labelStyle}>Email</label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label htmlFor="invite-role" style={labelStyle}>Role</label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as EqRole)}
            disabled={busy}
            style={inputStyle}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p style={{ fontSize: 12, color: 'var(--gray-500)', margin: '6px 0 0' }}>
            {ROLE_OPTIONS.find((o) => o.value === role)?.helper}
          </p>
        </div>

        <div style={{ marginBottom: 24 }}>
          <p style={labelStyle}>App access</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {MODULE_OPTIONS.map((m) => (
              <label
                key={m.key}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', border: '1px solid var(--eq-border)',
                  borderRadius: 6, background: 'var(--eq-bg)', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 500 }}>{m.label}</span>
                <input
                  type="checkbox"
                  checked={entitlements.has(m.key)}
                  onChange={() => toggleEntitlement(m.key)}
                  disabled={busy}
                />
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !email}
            style={{ padding: '0 20px' }}
          >
            {busy ? 'Sending…' : 'Send invite'}
          </Button>
        </div>

        {err && (
          <div className="eq-err" role="alert" style={{ marginTop: 16 }}>
            {err}
          </div>
        )}

        {success && (
          <div
            style={{
              marginTop: 20,
              padding: '14px 16px',
              border: '1px solid var(--eq-border)',
              borderRadius: 6,
              background: 'var(--eq-ice)',
            }}
          >
            <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>Invite sent</p>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--gray-500)' }}>
              {success.email_delivered
                ? 'Email delivered — the recipient should see it within a minute.'
                : 'Email not configured yet. Copy this link and send it manually:'}
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                readOnly
                value={success.invite_url}
                style={{
                  flex: 1, padding: '6px 10px', border: '1px solid var(--eq-border)',
                  borderRadius: 4, fontSize: 12,
                  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                  background: 'var(--eq-bg)',
                }}
                onFocus={(e) => e.target.select()}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => copyInviteUrl(success.invite_url)}
              >
                Copy
              </Button>
            </div>
          </div>
        )}
      </form>
    </InviteShell>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 40, padding: '0 12px',
  border: '1px solid var(--gray-300)', borderRadius: 6,
  background: 'var(--eq-bg)', color: 'var(--eq-ink)',
  fontSize: 14,
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: 'var(--eq-grey)', textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: 8,
};

function InviteShell({ children }: { children: React.ReactNode }) {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <p style={{ marginBottom: 16 }}>
        <Link to={`/${tenantSlug}/admin/users`} style={{ fontSize: 13 }}>
          ← Back to users
        </Link>
      </p>
      {children}
    </HubLayout>
  );
}

export default function AdminInviteUser() {
  return (
    <Gate
      perm="admin.invite_user"
      fallback={
        <InviteShell>
          <div className="eq-empty">
            <p className="eq-empty__title">Not allowed</p>
            <p>
              Only managers can invite users. Ask your manager if you need access.
            </p>
          </div>
        </InviteShell>
      }
    >
      <AdminInviteUserForm />
    </Gate>
  );
}
