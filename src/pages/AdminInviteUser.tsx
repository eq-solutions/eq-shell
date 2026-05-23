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

import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Gate } from '../permissions/Gate';
import { Topbar } from '../components/Topbar';
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
          The recipient gets a one-time link to set their PIN. They land
          on the tenant home as soon as they accept.
        </p>
      </div>
      <form onSubmit={onSubmit} style={{ maxWidth: 520 }}>

        <label htmlFor="invite-email">Email</label>
        <input
          id="invite-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />

        <label htmlFor="invite-role">Role</label>
        <select
          id="invite-role"
          value={role}
          onChange={(e) => setRole(e.target.value as EqRole)}
          disabled={busy}
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px solid var(--eq-border)',
            borderRadius: 6,
            marginBottom: 6,
            background: 'var(--eq-bg)',
            color: 'var(--eq-ink)',
          }}
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p style={{ fontSize: 12, color: 'var(--eq-mute)', margin: '0 0 16px' }}>
          {ROLE_OPTIONS.find((o) => o.value === role)?.helper}
        </p>

        <fieldset
          style={{
            border: '1px solid var(--eq-border)',
            borderRadius: 6,
            padding: 12,
            margin: '0 0 16px',
          }}
        >
          <legend style={{ fontSize: 13, fontWeight: 500, padding: '0 6px' }}>
            Module access
          </legend>
          {MODULE_OPTIONS.map((m) => (
            <label
              key={m.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
                fontSize: 14,
                fontWeight: 400,
              }}
            >
              <input
                type="checkbox"
                checked={entitlements.has(m.key)}
                onChange={() => toggleEntitlement(m.key)}
                disabled={busy}
                style={{ width: 'auto', margin: 0 }}
              />
              {m.label}
            </label>
          ))}
        </fieldset>

        <button type="submit" disabled={busy || !email}>
          {busy ? 'Sending…' : 'Send invite'}
        </button>

        {err && (
          <div className="err" role="alert">
            {err}
          </div>
        )}

        {success && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: '1px solid var(--eq-border)',
              borderRadius: 6,
              background: 'var(--eq-bg)',
              fontSize: 13,
            }}
          >
            <strong style={{ color: 'var(--eq-ink)' }}>Invite sent</strong>
            <p style={{ margin: '6px 0', color: 'var(--eq-mute)' }}>
              {success.email_delivered
                ? 'Email delivered — the recipient should see it within a minute.'
                : 'Email provider not configured yet. Copy this link and send it to them manually:'}
            </p>
            <input
              readOnly
              value={success.invite_url}
              style={{
                width: '100%',
                padding: '6px 8px',
                border: '1px solid var(--eq-border)',
                borderRadius: 4,
                fontSize: 12,
                fontFamily: 'monospace',
                marginBottom: 6,
              }}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              onClick={() => copyInviteUrl(success.invite_url)}
              style={{
                background: 'transparent',
                color: 'var(--eq-brand)',
                border: '1px solid var(--eq-brand)',
                padding: '6px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Copy link
            </button>
          </div>
        )}
      </form>
    </InviteShell>
  );
}

function InviteShell({ children }: { children: React.ReactNode }) {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  return (
    <>
      <Topbar />
      <main className="eq-page">
        <p style={{ marginBottom: 16 }}>
          <Link to={`/${tenantSlug}/admin/users`} style={{ fontSize: 13 }}>
            ← Back to users
          </Link>
        </p>
        {children}
      </main>
    </>
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
