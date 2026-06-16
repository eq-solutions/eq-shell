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
  { value: 'manager',     label: 'Manager',     helper: 'Full access — can invite users, manage settings, and see all data.' },
  { value: 'supervisor',  label: 'Supervisor',  helper: 'Approves work, manages a team.' },
  { value: 'employee',    label: 'Employee',    helper: 'Default working role.' },
  { value: 'apprentice',  label: 'Apprentice',  helper: 'Trainee with mentor visibility.' },
  { value: 'labour_hire', label: 'Contractor',  helper: 'For contractors or agency workers — read-only access to their own roster and timesheet.' },
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
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<EqRole>('employee');
  const [entitlements, setEntitlements] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<InviteSuccess | null>(null);
  const [addedMsg, setAddedMsg] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

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
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('failed');
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSuccess(null);
    setAddedMsg(null);
    setCopyStatus('idle');
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
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }),
      });
      const body = (await res.json()) as
        | { ok: true; added_to_tenant: true; user_id: string; email_delivered: boolean }
        | { ok: true; invite_id: string; invite_url: string; email_delivered: boolean }
        | { ok: false; error?: string };
      if (!body.ok) {
        const map: Record<string, string> = {
          'unauthorized':      'Sign in again to invite users.',
          'forbidden':         'Only managers can invite users.',
          'bad-email':         "That email doesn't look right.",
          'bad-phone':         "That mobile doesn't look like an Australian number.",
          'bad-role':          'Pick a role from the list.',
          'bad-request':       'The request was invalid — refresh and try again.',
          'user-exists':       'A user with that email already exists.',
          'already-invited':   'An open invite for that email already exists.',
          'already-a-member':  'That person is already part of this workspace.',
          'server-error':      'Something went wrong server-side — try again.',
        };
        setErr(map[body.error ?? ''] ?? 'Could not send the invite. Try again.');
        setBusy(false);
        return;
      }
      if ('added_to_tenant' in body && body.added_to_tenant) {
        setAddedMsg("That person already has an EQ account — they've been added to this workspace.");
        setEmail('');
        setPhone('');
        setBusy(false);
        return;
      }
      if ('invite_id' in body) {
        setSuccess({
          invite_id: body.invite_id,
          invite_url: body.invite_url,
          email_delivered: body.email_delivered,
        });
        setEmail('');
        setPhone('');
      }
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
        <p style={{ marginTop: 4 }}>
          <Link to="../invite-bulk" style={{ fontSize: 13 }}>
            Inviting a whole team? Invite in bulk →
          </Link>
        </p>
      </div>
      <form onSubmit={onSubmit} style={{ maxWidth: 520, width: '100%', boxSizing: 'border-box' }}>

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
          <label htmlFor="invite-phone" style={labelStyle}>Mobile (optional)</label>
          <input
            id="invite-phone"
            type="tel"
            autoComplete="tel"
            placeholder="0412 345 678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
          <p style={{ fontSize: 12, color: 'var(--gray-500)', margin: '6px 0 0' }}>
            Adding a mobile lets them sign in by text code, not just a PIN.
          </p>
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
          <p style={labelStyle}>Workspace apps</p>
          <p style={{ fontSize: 12, color: 'var(--gray-500)', margin: '-4px 0 10px' }}>
            Turning these on makes them available to everyone in this workspace, not just this person.
          </p>
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
            disabled={busy || !email.trim()}
            aria-busy={busy}
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

        {addedMsg && (
          <div
            role="status"
            style={{
              marginTop: 16,
              padding: '12px 14px',
              border: '1px solid var(--eq-border)',
              borderRadius: 6,
              background: 'var(--eq-ice)',
              fontSize: 14,
              color: 'var(--eq-ink)',
            }}
          >
            {addedMsg}
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
            {success.email_delivered ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--gray-500)' }}>
                Email delivered — the recipient should see it within a minute.
              </p>
            ) : (
              <>
                <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--gray-500)' }}>
                  Email not configured yet. Copy this link and send it manually:
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    readOnly
                    value={success.invite_url}
                    style={{
                      flex: 1, minWidth: 0, padding: '6px 10px', border: '1px solid var(--eq-border)',
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
                    {copyStatus === 'copied' ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
                {copyStatus === 'failed' && (
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--eq-err, #c0392b)' }}>
                    Copy failed — select and copy the link above.
                  </p>
                )}
              </>
            )}
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