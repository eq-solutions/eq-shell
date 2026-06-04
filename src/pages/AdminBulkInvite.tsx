// Admin form: invite many users at once (bulk onboarding).
//
// Gated by useCan('admin.invite_user') — same gate as the single
// invite. The Netlify function (invite-users-batch) enforces the same
// check server-side; this Gate is for UX, not security.
//
// Paste a staff list, one person per line:
//     email, role, apps
//     jess.lee@sks.com.au, employee, field cards
//     mark.smith@sks.com.au, supervisor, field cards
//
// The page parses + validates locally, shows a preview, then sends the
// whole batch. Until the email provider is wired, each newly-invited
// person's one-time link is shown so the admin can send it manually.

import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@eq-solutions/ui';
import { Gate } from '../permissions/Gate';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import type { EqRole } from '../session';

const SIDEBAR_RECORDS = defaultSidebarRecords();

const VALID_ROLES: EqRole[] = ['manager', 'supervisor', 'employee', 'apprentice', 'labour_hire'];
const VALID_APPS = ['field', 'cards', 'intake', 'quotes', 'service'];
const MAX_ROWS = 50;

function normaliseRole(raw: string): EqRole | null {
  const r = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (VALID_ROLES as string[]).includes(r) ? (r as EqRole) : null;
}

interface ParsedRow {
  line: number;
  email: string;
  role: EqRole | null;
  apps: string[];
  unknownApps: string[];
  issue: string | null;
}

function parse(text: string): ParsedRow[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .map((l, i) => ({ raw: l, line: i + 1 }))
    .filter((r) => r.raw.length > 0)
    .map(({ raw, line }) => {
      const parts = raw.split(',');
      const email = (parts[0] ?? '').trim().toLowerCase();
      const role = normaliseRole(parts[1] ?? '');
      const appsRaw = parts.slice(2).join(' ');
      const tokens = appsRaw.split(/[\s,;|]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);
      const apps = tokens.filter((a) => VALID_APPS.includes(a));
      const unknownApps = tokens.filter((a) => !VALID_APPS.includes(a));

      let issue: string | null = null;
      if (!email || !email.includes('@')) issue = 'Email looks wrong';
      else if (!role) issue = 'Unknown role';

      return { line, email, role, apps, unknownApps, issue };
    });
}

type RowStatus = 'invited' | 'added-to-tenant' | 'already-member' | 'already-invited' | 'failed';

interface RowResult {
  email: string;
  status: RowStatus;
  invite_url?: string;
  email_delivered?: boolean;
  error?: string;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  'invited': 'Invited',
  'added-to-tenant': 'Added',
  'already-member': 'Already in',
  'already-invited': 'Pending invite',
  'failed': 'Failed',
};

const STATUS_TONE: Record<RowStatus, { bg: string; fg: string }> = {
  'invited': { bg: 'var(--eq-ice)', fg: 'var(--eq-deep, #2986B4)' },
  'added-to-tenant': { bg: 'var(--eq-ice)', fg: 'var(--eq-deep, #2986B4)' },
  'already-member': { bg: 'var(--eq-bg)', fg: 'var(--gray-500)' },
  'already-invited': { bg: 'var(--eq-bg)', fg: 'var(--gray-500)' },
  'failed': { bg: '#FDECEC', fg: '#B42318' },
};

const ERROR_LABEL: Record<string, string> = {
  'bad-email': 'Email looks wrong',
  'bad-role': 'Unknown role',
  'duplicate-in-batch': 'Listed twice',
  'server-error': 'Server error — retry this one',
};

function AdminBulkInviteForm() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<RowResult[] | null>(null);

  const rows = useMemo(() => parse(text), [text]);
  const validRows = rows.filter((r) => !r.issue);
  const invalidCount = rows.length - validRows.length;
  const overCap = validRows.length > MAX_ROWS;

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* leave visible for manual copy */
    }
  }

  async function onSend() {
    setErr(null);
    setResults(null);
    setBusy(true);
    try {
      const res = await fetch('/.netlify/functions/invite-users-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          invites: validRows.map((r) => ({
            email: r.email,
            role: r.role,
            entitlements: r.apps,
          })),
        }),
      });
      const body = (await res.json()) as
        | { ok: true; results: RowResult[] }
        | { ok: false; error?: string };
      if (!body.ok) {
        const map: Record<string, string> = {
          'unauthorized': 'Sign in again to invite people.',
          'forbidden': 'Only managers can invite people.',
          'empty': 'Add at least one person.',
          'too-many': `Too many at once — send up to ${MAX_ROWS} per batch.`,
          'server-error': 'Something went wrong server-side — try again.',
        };
        setErr(map[body.error ?? ''] ?? 'Could not send the invites. Try again.');
        setBusy(false);
        return;
      }
      setResults(body.results);
      setBusy(false);
    } catch {
      setErr('Network error — please try again.');
      setBusy(false);
    }
  }

  const pendingLinks = (results ?? []).filter((r) => r.status === 'invited' && r.invite_url);

  return (
    <BulkShell>
      <div className="eq-page__header">
        <h1 className="eq-page__title">Invite people in bulk</h1>
        <p className="eq-page__lede">
          Paste your staff list — one person per line. Each gets a one-time link to set their PIN
          and land straight on the hub.
        </p>
      </div>

      {!results && (
        <div style={{ maxWidth: 680 }}>
          <label htmlFor="bulk-list" style={labelStyle}>
            Staff list — email, role, apps (one per line)
          </label>
          <textarea
            id="bulk-list"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            spellCheck={false}
            placeholder={'jess.lee@sks.com.au, employee, field cards\nmark.smith@sks.com.au, supervisor, field cards'}
            style={{
              width: '100%', minHeight: 180, padding: '12px 14px',
              border: '1px solid var(--gray-300)', borderRadius: 6,
              background: 'var(--eq-bg)', color: 'var(--eq-ink)',
              fontSize: 13, lineHeight: 1.6,
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace', resize: 'vertical',
            }}
          />
          <p style={{ fontSize: 12, color: 'var(--gray-500)', margin: '8px 0 0' }}>
            Roles: {VALID_ROLES.join(', ')}. Apps: {VALID_APPS.join(', ')} (space-separated).
            Most field staff need <code>field cards</code>.
          </p>

          {rows.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <p style={labelStyle}>Preview — {validRows.length} ready{invalidCount > 0 ? `, ${invalidCount} need a fix` : ''}</p>
              <div style={{ border: '1px solid var(--eq-border)', borderRadius: 6, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.line} style={{ borderTop: r.line > 1 ? '1px solid var(--eq-border)' : undefined }}>
                        <td style={cellStyle}>{r.email || <span style={{ color: 'var(--gray-500)' }}>(blank)</span>}</td>
                        <td style={{ ...cellStyle, color: 'var(--gray-500)' }}>{r.role ?? '—'}</td>
                        <td style={{ ...cellStyle, color: 'var(--gray-500)' }}>{r.apps.join(' ') || '—'}</td>
                        <td style={{ ...cellStyle, textAlign: 'right' }}>
                          {r.issue
                            ? <span style={{ color: '#B42318', fontWeight: 600 }}>{r.issue}</span>
                            : <span style={{ color: 'var(--eq-deep, #2986B4)' }}>Ready</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {overCap && (
                <p style={{ fontSize: 12, color: '#B42318', margin: '8px 0 0' }}>
                  {validRows.length} ready, but only {MAX_ROWS} can be sent at once. Split the list and send the rest in a second batch.
                </p>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 24 }}>
            <Button
              type="button"
              variant="primary"
              disabled={busy || validRows.length === 0 || overCap}
              onClick={onSend}
              style={{ padding: '0 20px' }}
            >
              {busy ? 'Sending…' : `Send ${validRows.length} invite${validRows.length === 1 ? '' : 's'}`}
            </Button>
          </div>

          {err && <div className="eq-err" role="alert" style={{ marginTop: 16 }}>{err}</div>}
        </div>
      )}

      {results && (
        <div style={{ maxWidth: 720 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setResults(null); setText(''); }}>
              Invite more
            </Button>
            {pendingLinks.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => copy(pendingLinks.map((r) => `${r.email}\t${r.invite_url}`).join('\n'))}
              >
                Copy all links
              </Button>
            )}
          </div>

          <div style={{ border: '1px solid var(--eq-border)', borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {results.map((r, i) => {
                  const tone = STATUS_TONE[r.status];
                  return (
                    <tr key={r.email + i} style={{ borderTop: i > 0 ? '1px solid var(--eq-border)' : undefined }}>
                      <td style={cellStyle}>{r.email}</td>
                      <td style={{ ...cellStyle, width: 1, whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-block', padding: '3px 9px', borderRadius: 999,
                          fontSize: 11.5, fontWeight: 600, background: tone.bg, color: tone.fg,
                        }}>
                          {STATUS_LABEL[r.status]}
                          {r.status === 'failed' && r.error ? `: ${ERROR_LABEL[r.error] ?? r.error}` : ''}
                        </span>
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'right' }}>
                        {r.status === 'invited' && r.invite_url && !r.email_delivered && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => copy(r.invite_url!)}>
                            Copy link
                          </Button>
                        )}
                        {r.email_delivered && <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>Emailed</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pendingLinks.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--gray-500)', margin: '12px 0 0' }}>
              Email isn't switched on yet, so copy each link and send it to the person (text or email).
              Links expire in 7 days.
            </p>
          )}
        </div>
      )}
    </BulkShell>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: 'var(--eq-grey)', textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: 8,
};

const cellStyle: React.CSSProperties = {
  padding: '9px 12px', verticalAlign: 'middle',
};

function BulkShell({ children }: { children: React.ReactNode }) {
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

export default function AdminBulkInvite() {
  return (
    <Gate
      perm="admin.invite_user"
      fallback={
        <BulkShell>
          <div className="eq-empty">
            <p className="eq-empty__title">Not allowed</p>
            <p>Only managers can invite people. Ask your manager if you need access.</p>
          </div>
        </BulkShell>
      }
    >
      <AdminBulkInviteForm />
    </Gate>
  );
}
