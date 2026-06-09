// Admin form: invite a worker to activate their EQ Cards account.
//
// This is the phone-first path for field workers (tradies, labour-hire, etc.)
// who need a Cards wallet. The admin enters name + phone; the system generates
// a one-click Cards claim link. The admin shares it via WhatsApp, SMS, or email.
//
// Contrast with AdminInviteUser.tsx (email-first Shell invite for desktop users).
//
// Route: /:tenantSlug/admin/workers/invite
// Gated:  admin.invite_user

import React, { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@eq-solutions/ui';
import { Gate } from '../permissions/Gate';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

const ROLE_OPTIONS = [
  { value: 'employee',    label: 'Employee',    helper: 'Standard working role.' },
  { value: 'apprentice',  label: 'Apprentice',  helper: 'Trainee with mentor visibility.' },
  { value: 'labour_hire', label: 'Labour Hire', helper: 'Minimal access — roster only.' },
  { value: 'supervisor',  label: 'Supervisor',  helper: 'Approves work, manages a team.' },
  { value: 'manager',     label: 'Manager',     helper: 'Full admin access.' },
];

interface InviteResult {
  claim_url: string;
  token: string;
  worker_id: string;
  expires_at: string;
  reused: boolean;
  first_name: string;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function whatsAppUrl(firstName: string, claimUrl: string): string {
  const msg = `Hi ${firstName}! Your EQ Cards wallet is ready — tap the link to activate your account and access your licences and credentials:\n\n${claimUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

function AdminWorkerInviteFormInner() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [phone,     setPhone]     = useState('');
  const [email,     setEmail]     = useState('');
  const [role,      setRole]      = useState('employee');
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setResult(null);
    setCopied(false);
    setBusy(true);

    try {
      const res = await fetch('/.netlify/functions/create-worker-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name:  lastName.trim(),
          phone:      phone.trim(),
          role,
          ...(email.trim() ? { email: email.trim() } : {}),
        }),
      });

      const body = (await res.json()) as
        | { ok: true; claim_url: string; token: string; worker_id: string; expires_at: string; reused: boolean }
        | { error: string };

      if (!res.ok || !('ok' in body)) {
        const errMap: Record<string, string> = {
          'Manager access required': 'Only managers can invite workers.',
          'first_name is required':  'First name is required.',
          'phone is required':       'Phone number is required.',
          'phone must be a valid Australian mobile (e.g. 0412 345 678)':
            'Enter a valid Australian mobile — e.g. 0412 345 678.',
          'Invalid role':            'Select a role from the list.',
        };
        const raw = 'error' in body ? body.error : 'Something went wrong.';
        setErr(errMap[raw] ?? raw);
        setBusy(false);
        return;
      }

      setResult({ ...body, first_name: firstName.trim() });
      // Clear form for next invite
      setFirstName('');
      setLastName('');
      setPhone('');
      setEmail('');
      setRole('employee');
    } catch {
      setErr('Network error — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked — link stays visible for manual copy
    }
  }

  return (
    <WorkerInviteShell>
      <div className="eq-page__header">
        <h1 className="eq-page__title">Invite a worker</h1>
        <p className="eq-page__lede">
          Generates a one-tap activation link for their EQ Cards wallet. Share it via WhatsApp, SMS, or email.
        </p>
        <p style={{ marginTop: 4, fontSize: 13 }}>
          Inviting a desktop user (manager / supervisor)?{' '}
          <Link to={`/${tenantSlug}/admin/users/invite`}>Use the Shell invite instead →</Link>
        </p>
      </div>

      <form onSubmit={onSubmit} style={{ maxWidth: 520 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div>
            <label htmlFor="wif-first" style={labelStyle}>First name</label>
            <input
              id="wif-first"
              type="text"
              required
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={busy}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="wif-last" style={labelStyle}>Last name</label>
            <input
              id="wif-last"
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={busy}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label htmlFor="wif-phone" style={labelStyle}>Mobile *</label>
          <input
            id="wif-phone"
            type="tel"
            required
            autoComplete="tel"
            placeholder="0412 345 678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
          <p style={{ fontSize: 12, color: 'var(--eq-grey)', margin: '6px 0 0' }}>
            Australian mobiles only. Used to match their EQ wallet when they activate.
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label htmlFor="wif-role" style={labelStyle}>Role</label>
          <select
            id="wif-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={busy}
            style={inputStyle}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p style={{ fontSize: 12, color: 'var(--eq-grey)', margin: '6px 0 0' }}>
            {ROLE_OPTIONS.find((o) => o.value === role)?.helper}
          </p>
        </div>

        <div style={{ marginBottom: 24 }}>
          <label htmlFor="wif-email" style={labelStyle}>Email (optional)</label>
          <input
            id="wif-email"
            type="email"
            autoComplete="email"
            placeholder="worker@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
          <p style={{ fontSize: 12, color: 'var(--eq-grey)', margin: '6px 0 0' }}>
            If provided, used to invite them to the desktop portal later.
          </p>
        </div>

        <Button type="submit" variant="primary" disabled={busy || !firstName.trim() || !phone.trim()}>
          {busy ? 'Creating invite…' : 'Create invite link'}
        </Button>

        {err && (
          <div className="eq-err" role="alert" style={{ marginTop: 16 }}>
            {err}
          </div>
        )}
      </form>

      {result && (
        <div
          style={{
            marginTop: 24,
            padding: '16px 18px',
            border: '1px solid var(--eq-border)',
            borderRadius: 8,
            background: 'var(--eq-ice)',
            maxWidth: 520,
          }}
        >
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>
            {result.reused ? 'Existing link retrieved' : 'Invite link created'}
          </p>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--eq-grey)' }}>
            Expires in {daysUntil(result.expires_at)} days. Share it with {result.first_name}:
          </p>

          {/* Claim URL row */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input
              readOnly
              value={result.claim_url}
              style={{
                flex: 1, padding: '6px 10px',
                border: '1px solid var(--eq-border)', borderRadius: 4,
                fontSize: 12, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                background: 'var(--eq-bg)',
              }}
              onFocus={(e) => e.target.select()}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => copyLink(result.claim_url)}
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>

          {/* Share shortcuts */}
          <div style={{ display: 'flex', gap: 8 }}>
            <a
              href={whatsAppUrl(result.first_name, result.claim_url)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 6, fontSize: 13,
                background: '#25D366', color: '#fff', textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              WhatsApp
            </a>
            <a
              href={`sms:?body=${encodeURIComponent(`Hi ${result.first_name}! Activate your EQ Cards wallet: ${result.claim_url}`)}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 6, fontSize: 13,
                border: '1px solid var(--eq-border)', color: 'var(--eq-ink)',
                textDecoration: 'none', fontWeight: 500,
                background: 'var(--eq-bg)',
              }}
            >
              Text
            </a>
          </div>

          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--eq-grey)' }}>
            Once they tap the link and sign in, their wallet activates automatically.
          </p>
        </div>
      )}
    </WorkerInviteShell>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 40, padding: '0 12px',
  border: '1px solid var(--gray-300)', borderRadius: 6,
  background: 'var(--eq-bg)', color: 'var(--eq-ink)', fontSize: 14,
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: 'var(--eq-grey)', textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: 8,
};

function WorkerInviteShell({ children }: { children: React.ReactNode }) {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <p style={{ marginBottom: 16 }}>
        <Link to={`/${tenantSlug}/admin/workers`} style={{ fontSize: 13 }}>
          ← Back to worker invites
        </Link>
      </p>
      {children}
    </HubLayout>
  );
}

export default function AdminWorkerInviteForm() {
  return (
    <Gate
      perm="admin.invite_user"
      fallback={
        <WorkerInviteShell>
          <div className="eq-empty">
            <p className="eq-empty__title">Not allowed</p>
            <p>Only managers can invite workers.</p>
          </div>
        </WorkerInviteShell>
      }
    >
      <AdminWorkerInviteFormInner />
    </Gate>
  );
}
