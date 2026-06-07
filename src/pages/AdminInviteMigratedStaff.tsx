// Admin: invite migrated staff (onboarding bridge).
//
// Reads the workspace's migrated staff via staff-invite-candidates, shows them
// with a mapped role + status, and sends the selected ones through the SAME
// invite-users-batch endpoint the bulk-invite page uses. Role is set from each
// person's employment type; people with no email address can't be invited.
//
// Gated by useCan('admin.invite_user') — same gate as single + bulk invite.
// The Netlify functions enforce the same check server-side; this Gate is UX.

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CircleCheck, Clock, UserCheck, MailWarning, TriangleAlert } from 'lucide-react';
import { Button } from '@eq-solutions/ui';
import { Gate } from '../permissions/Gate';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import type { EqRole } from '../session';

const SIDEBAR_RECORDS = defaultSidebarRecords();

const VALID_APPS = ['field', 'cards', 'intake', 'quotes', 'service'] as const;
const DEFAULT_APPS = ['field', 'cards'];
const MAX_PER_BATCH = 50;

type CandidateStatus = 'ready' | 'already-user' | 'already-invited' | 'no-email';

interface Candidate {
  staff_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  employment_type: string | null;
  role: EqRole;
  role_uncertain: boolean;
  status: CandidateStatus;
  worker_id: string | null;
}

const ROLE_OPTIONS: { value: EqRole; label: string }[] = [
  { value: 'employee', label: 'Employee' },
  { value: 'apprentice', label: 'Apprentice' },
  { value: 'labour_hire', label: 'Labour Hire' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'manager', label: 'Manager' },
];

interface Counts {
  ready: number;
  already_user: number;
  already_invited: number;
  no_email: number;
}

// Mirrors invite-users-batch.ts row result shape.
type RowStatus = 'invited' | 'added-to-tenant' | 'already-member' | 'already-invited' | 'failed';
interface RowResult {
  email: string;
  status: RowStatus;
  invite_url?: string;
  email_delivered?: boolean;
  error?: string;
}

function roleLabel(role: EqRole): string {
  return role.split('_').map((s) => s[0].toUpperCase() + s.slice(1)).join(' ');
}

const CANDIDATE_BADGE: Record<CandidateStatus, { label: string; bg: string; fg: string; Icon: typeof CircleCheck }> = {
  'ready': { label: 'Ready', bg: 'var(--eq-ice)', fg: 'var(--eq-deep, #2986B4)', Icon: CircleCheck },
  'already-user': { label: 'Already in', bg: 'var(--eq-bg)', fg: 'var(--gray-500)', Icon: UserCheck },
  'already-invited': { label: 'Invite pending', bg: 'var(--eq-bg)', fg: 'var(--gray-500)', Icon: Clock },
  'no-email': { label: 'No email', bg: '#FDECEC', fg: '#B42318', Icon: MailWarning },
};

const RESULT_LABEL: Record<RowStatus, string> = {
  'invited': 'Invited',
  'added-to-tenant': 'Added',
  'already-member': 'Already in',
  'already-invited': 'Invite pending',
  'failed': 'Failed',
};
const RESULT_TONE: Record<RowStatus, { bg: string; fg: string }> = {
  'invited': { bg: 'var(--eq-ice)', fg: 'var(--eq-deep, #2986B4)' },
  'added-to-tenant': { bg: 'var(--eq-ice)', fg: 'var(--eq-deep, #2986B4)' },
  'already-member': { bg: 'var(--eq-bg)', fg: 'var(--gray-500)' },
  'already-invited': { bg: 'var(--eq-bg)', fg: 'var(--gray-500)' },
  'failed': { bg: '#FDECEC', fg: '#B42318' },
};
const RESULT_ERROR: Record<string, string> = {
  'bad-email': 'Email looks wrong',
  'bad-role': 'Unknown role',
  'bad-phone': 'Phone looks wrong',
  'duplicate-in-batch': 'Listed twice',
  'server-error': 'Server error — retry this one',
};

function AdminInviteMigratedStaffInner() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [roleOverrides, setRoleOverrides] = useState<Record<string, EqRole>>({});
  const [apps, setApps] = useState<Set<string>>(new Set(DEFAULT_APPS));
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [results, setResults] = useState<RowResult[] | null>(null);

  async function load() {
    setLoadErr(null);
    setCandidates(null);
    try {
      const res = await fetch('/.netlify/functions/staff-invite-candidates', {
        credentials: 'include',
      });
      const body = (await res.json()) as
        | { ok: true; candidates: Candidate[]; counts: Counts }
        | { ok: false; error?: string };
      if (!body.ok) {
        setLoadErr(
          body.error === 'forbidden'
            ? 'Only managers can invite people.'
            : "Couldn't load your staff list. Try again.",
        );
        return;
      }
      setCandidates(body.candidates);
      setCounts(body.counts);
      // Pre-select everyone who's ready to invite.
      setSelected(new Set(body.candidates.filter((c) => c.status === 'ready').map((c) => c.staff_id)));
      // Reset role overrides on reload.
      setRoleOverrides({});
    } catch {
      setLoadErr('Network error — please try again.');
    }
  }

  useEffect(() => { void load(); }, []);

  const readyList = useMemo(
    () => (candidates ?? []).filter((c) => c.status === 'ready'),
    [candidates],
  );
  const selectedReady = useMemo(
    () => readyList.filter((c) => selected.has(c.staff_id)),
    [readyList, selected],
  );
  const overCap = selectedReady.length > MAX_PER_BATCH;

  function toggleOne(staffId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(staffId)) next.delete(staffId); else next.add(staffId);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === readyList.length ? new Set() : new Set(readyList.map((c) => c.staff_id)),
    );
  }
  function toggleApp(app: string) {
    setApps((prev) => {
      const next = new Set(prev);
      if (next.has(app)) next.delete(app); else next.add(app);
      return next;
    });
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); } catch { /* leave visible */ }
  }

  async function onSend() {
    setSendErr(null);
    setResults(null);
    setBusy(true);
    try {
      const res = await fetch('/.netlify/functions/invite-users-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          invites: selectedReady.map((c) => ({
            email: c.email,
            role: roleOverrides[c.staff_id] ?? c.role,
            entitlements: [...apps],
            ...(c.phone ? { phone: c.phone } : {}),
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
          'empty': 'Select at least one person.',
          'too-many': `Too many at once — send up to ${MAX_PER_BATCH} per batch.`,
          'server-error': 'Something went wrong server-side — try again.',
        };
        setSendErr(map[body.error ?? ''] ?? 'Could not send the invites. Try again.');
        setBusy(false);
        return;
      }
      setResults(body.results);
      setBusy(false);
    } catch {
      setSendErr('Network error — please try again.');
      setBusy(false);
    }
  }

  const pendingLinks = (results ?? []).filter((r) => r.status === 'invited' && r.invite_url);

  // ---- Results view ----
  if (results) {
    return (
      <MigrateShell>
        <div className="eq-page__header">
          <h1 className="eq-page__title">Invites sent</h1>
          <p className="eq-page__lede">
            Here's what happened for each person you selected.
          </p>
        </div>
        <div style={{ maxWidth: 720 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setResults(null); void load(); }}>
              Back to staff
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
                  const tone = RESULT_TONE[r.status];
                  return (
                    <tr key={r.email + i} style={{ borderTop: i > 0 ? '1px solid var(--eq-border)' : undefined }}>
                      <td style={cellStyle}>{r.email}</td>
                      <td style={{ ...cellStyle, width: 1, whiteSpace: 'nowrap' }}>
                        <span style={{ ...badgeStyle, background: tone.bg, color: tone.fg }}>
                          {RESULT_LABEL[r.status]}
                          {r.status === 'failed' && r.error ? `: ${RESULT_ERROR[r.error] ?? r.error}` : ''}
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
      </MigrateShell>
    );
  }

  // ---- Candidate selection view ----
  const allReadySelected = readyList.length > 0 && selected.size >= readyList.length;
  return (
    <MigrateShell>
      <div className="eq-page__header">
        <h1 className="eq-page__title">Invite migrated staff</h1>
        <p className="eq-page__lede">
          Your imported staff are listed below. Each gets a one-time link to set their PIN and sign in.
          Their role is set from their employment type — change it later from the people list if needed.
        </p>
      </div>

      {loadErr && <div className="eq-err" role="alert" style={{ marginBottom: 16 }}>{loadErr}</div>}

      {candidates === null && !loadErr && (
        <p style={{ color: 'var(--eq-grey)' }}>Loading your staff…</p>
      )}

      {candidates && (
        <div style={{ maxWidth: 760 }}>
          {counts && (
            <p style={{ fontSize: 13, color: 'var(--eq-grey)', marginBottom: 16 }}>
              {counts.ready} ready to invite
              {counts.already_user > 0 && ` · ${counts.already_user} already signed up`}
              {counts.already_invited > 0 && ` · ${counts.already_invited} already invited`}
              {counts.no_email > 0 && ` · ${counts.no_email} can't be invited (no email)`}
            </p>
          )}

          <div style={{ marginBottom: 16 }}>
            <p style={labelStyle}>Apps each person gets</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              {VALID_APPS.map((app) => (
                <label key={app} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, textTransform: 'capitalize' }}>
                  <input type="checkbox" checked={apps.has(app)} onChange={() => toggleApp(app)} disabled={busy} />
                  {app}
                </label>
              ))}
            </div>
          </div>

          <div style={{ border: '1px solid var(--eq-border)', borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--eq-bg)' }}>
                  <th style={{ ...cellStyle, width: 36 }}>
                    <input
                      type="checkbox"
                      checked={allReadySelected}
                      onChange={toggleAll}
                      disabled={busy || readyList.length === 0}
                      aria-label="Select all ready"
                    />
                  </th>
                  <th style={{ ...cellStyle, ...thStyle }}>Name</th>
                  <th style={{ ...cellStyle, ...thStyle }}>Email</th>
                  <th style={{ ...cellStyle, ...thStyle }}>Role</th>
                  <th style={{ ...cellStyle, ...thStyle, textAlign: 'right' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const badge = CANDIDATE_BADGE[c.status];
                  const Icon = badge.Icon;
                  const selectable = c.status === 'ready';
                  return (
                    <tr
                      key={c.staff_id}
                      style={{ borderTop: '1px solid var(--eq-border)', opacity: selectable ? 1 : 0.6 }}
                    >
                      <td style={cellStyle}>
                        <input
                          type="checkbox"
                          checked={selectable && selected.has(c.staff_id)}
                          onChange={() => toggleOne(c.staff_id)}
                          disabled={!selectable || busy}
                          aria-label={`Invite ${c.name}`}
                        />
                      </td>
                      <td style={cellStyle}>
                        <span style={{ fontWeight: 500 }}>{c.name}</span>
                      </td>
                      <td style={{ ...cellStyle, color: 'var(--gray-500)' }}>
                        {c.email ?? <span style={{ color: '#B42318' }}>—</span>}
                      </td>
                      <td style={{ ...cellStyle }}>
                        {selectable ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <select
                              value={roleOverrides[c.staff_id] ?? c.role}
                              onChange={(e) =>
                                setRoleOverrides((prev) => ({
                                  ...prev,
                                  [c.staff_id]: e.target.value as EqRole,
                                }))
                              }
                              disabled={busy}
                              aria-label={`Role for ${c.name}`}
                              style={{
                                fontSize: 12, border: '1px solid var(--eq-border)',
                                borderRadius: 4, padding: '3px 6px',
                                background: 'var(--eq-bg)', color: 'var(--eq-ink)',
                                cursor: 'pointer',
                              }}
                            >
                              {ROLE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            {c.role_uncertain && !(c.staff_id in roleOverrides) && (
                              <span title="Defaulted from unrecognised employment type — confirm before sending" style={{ color: '#B26B00', display: 'inline-flex' }}>
                                <TriangleAlert size={13} aria-hidden="true" />
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--gray-500)', fontSize: 13 }}>{roleLabel(c.role)}</span>
                        )}
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'right', width: 1, whiteSpace: 'nowrap' }}>
                        <span style={{ ...badgeStyle, background: badge.bg, color: badge.fg, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Icon size={13} aria-hidden="true" />
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {overCap && (
            <p style={{ fontSize: 12, color: '#B42318', margin: '10px 0 0' }}>
              {selectedReady.length} selected, but only {MAX_PER_BATCH} can be sent at once. Send these,
              then come back for the rest.
            </p>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 20 }}>
            <Button
              type="button"
              variant="primary"
              disabled={busy || selectedReady.length === 0 || overCap}
              onClick={onSend}
              style={{ padding: '0 20px' }}
            >
              {busy ? 'Sending…' : `Send ${selectedReady.length} invite${selectedReady.length === 1 ? '' : 's'}`}
            </Button>
          </div>

          {sendErr && <div className="eq-err" role="alert" style={{ marginTop: 16 }}>{sendErr}</div>}
        </div>
      )}
    </MigrateShell>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: 'var(--eq-grey)', textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: 8,
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', fontSize: 11, fontWeight: 600,
  color: 'var(--eq-grey)', textTransform: 'uppercase', letterSpacing: '0.04em',
};
const cellStyle: React.CSSProperties = { padding: '9px 12px', verticalAlign: 'middle' };
const badgeStyle: React.CSSProperties = {
  display: 'inline-block', padding: '3px 9px', borderRadius: 999,
  fontSize: 11.5, fontWeight: 600,
};

function MigrateShell({ children }: { children: React.ReactNode }) {
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

export default function AdminInviteMigratedStaff() {
  return (
    <Gate
      perm="admin.invite_user"
      fallback={
        <MigrateShell>
          <div className="eq-empty">
            <p className="eq-empty__title">Not allowed</p>
            <p>Only managers can invite people. Ask your manager if you need access.</p>
          </div>
        </MigrateShell>
      }
    >
      <AdminInviteMigratedStaffInner />
    </Gate>
  );
}
