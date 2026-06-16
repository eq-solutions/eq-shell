// AdminAuditPage — login activity and intake events.
// Two tabs. Click an intake to drill into per-row audit or roll it back.

import { useEffect, useState } from 'react';
import { Button } from '@eq-solutions/ui';
import { createSupabaseClient } from '../lib/supabaseJwt';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';
import { friendlyError } from '../lib/friendlyError';
import { Gate } from '../permissions/Gate';

interface IntakeEvent {
  intake_id: string;
  entity: string;
  source_app: string | null;
  source_filename: string | null;
  status: string;
  rows_committed: number;
  rows_flagged: number;
  rows_rejected: number;
  started_at: string;
  completed_at: string | null;
}

interface AuthEvent {
  id: number;
  at: string;
  event: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  ip: string | null;
  detail: Record<string, unknown> | null;
}

interface IntakeRow {
  audit_id: string;
  source_row_index: number;
  outcome: string;
  canonical_row: Record<string, unknown> | null;
  errors: unknown;
  flags: unknown;
  source_app: string | null;
}

// Human-readable labels for auth event keys
const AUTH_EVENT_LABELS: Record<string, string> = {
  'login.success': 'Signed in',
  'login.failed': 'Sign-in failed',
  'login.failed.bad_pin': 'Wrong PIN',
  'login.failed.user_inactive': 'Account inactive',
  'login.failed.no_user': 'Unknown account',
  'logout': 'Signed out',
  'invite.accepted': 'Invite accepted',
  'pin.reset.accepted': 'PIN reset',
  'totp.enrolled': '2FA enrolled',
  'totp.verified': '2FA verified',
  'totp.failed': '2FA failed',
};

function authEventLabel(event: string): string {
  if (AUTH_EVENT_LABELS[event]) return AUTH_EVENT_LABELS[event];
  // Prettify unknown keys: replace dots/underscores with spaces, title-case
  return event.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Human-readable detail summary — extract meaningful fields from the detail object
function authDetailSummary(detail: Record<string, unknown> | null): string {
  if (!detail || Object.keys(detail).length === 0) return '—';
  const useful = detail.reason ?? detail.email ?? detail.message;
  if (typeof useful === 'string') return useful;
  return '—';
}

// Human-readable status labels for intake events
const STATUS_LABELS: Record<string, string> = {
  complete: 'Complete',
  approved: 'Approved',
  committing: 'Saving…',
  pending: 'Pending',
  failed: 'Failed',
  rolled_back: 'Rolled back',
};

// Human-readable entity labels for intake drilldown
const ENTITY_LABELS: Record<string, string> = {
  staff: 'People',
  equipment: 'Equipment',
  customers: 'Customers',
  sites: 'Sites',
  contacts: 'Contacts',
  workers: 'Workers',
};

// Human-readable outcome labels for intake rows
const OUTCOME_LABELS: Record<string, string> = {
  committed: 'Saved',
  flagged: 'Flagged',
  rejected: 'Rejected',
};

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function pillFor(status: string): string {
  if (status === 'complete' || status === 'approved') return 'eq-pill eq-pill--ok';
  if (status === 'committing' || status === 'pending') return 'eq-pill eq-pill--warn';
  if (status === 'failed' || status === 'rolled_back') return 'eq-pill eq-pill--err';
  return 'eq-pill eq-pill--info';
}

function eventPill(event: string): string {
  if (event.startsWith('login.success') || event === 'invite.accepted' || event === 'pin.reset.accepted') return 'eq-pill eq-pill--ok';
  if (event.startsWith('login.failed')) return 'eq-pill eq-pill--err';
  if (event === 'logout') return 'eq-pill eq-pill--info';
  return 'eq-pill';
}

function AdminAuditInner() {
  const [tab, setTab] = useState<'auth' | 'intakes'>('auth');
  const [authEvents, setAuthEvents] = useState<AuthEvent[] | null>(null);
  const [intakes, setIntakes] = useState<IntakeEvent[] | null>(null);
  const [drilldown, setDrilldown] = useState<{
    intake: IntakeEvent;
    rows: IntakeRow[] | null;
    loading: boolean;
    err: string | null;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const sb = await createSupabaseClient();
      const [aRes, iRes] = await Promise.all([
        sb.rpc('eq_recent_auth_events', { p_limit: 100 }),
        sb.rpc('eq_recent_intake_events', { p_limit: 50 }),
      ]);
      if (aRes.error) throw new Error(aRes.error.message);
      if (iRes.error) throw new Error(iRes.error.message);
      setAuthEvents(aRes.data as AuthEvent[]);
      setIntakes(iRes.data as IntakeEvent[]);
    } catch (e) {
      setErr(friendlyError(e, "We couldn't load the activity log. Please try refreshing."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openDrilldown = async (intake: IntakeEvent) => {
    setDrilldown({ intake, rows: null, loading: true, err: null });
    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb.rpc('eq_intake_event_rows', {
        p_intake_id: intake.intake_id,
        p_limit: 100,
      });
      if (error) throw new Error(error.message);
      setDrilldown({ intake, rows: data as IntakeRow[], loading: false, err: null });
    } catch (e) {
      setDrilldown({ intake, rows: [], loading: false, err: friendlyError(e, "We couldn't open this import's details. Please try again.") });
    }
  };

  const [rollbackState, setRollbackState] = useState<{
    intakeId: string;
    reason: string;
    busy: boolean;
    result: string | null;
    err: string | null;
  } | null>(null);

  const openRollback = (intakeId: string) => {
    setRollbackState({ intakeId, reason: '', busy: false, result: null, err: null });
  };

  const submitRollback = async () => {
    if (!rollbackState || !rollbackState.reason.trim()) return;
    setRollbackState((s) => s ? { ...s, busy: true, err: null } : s);
    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb.rpc('eq_intake_rollback', {
        p_intake_id: rollbackState.intakeId,
        p_reason: rollbackState.reason.trim(),
      });
      if (error) throw new Error(error.message);
      setRollbackState((s) => s ? { ...s, busy: false, result: `Rolled back ${data ?? 0} rows.` } : s);
      setDrilldown(null);
      await load();
    } catch (e) {
      setRollbackState((s) => s ? { ...s, busy: false, err: (e as Error).message } : s);
    }
  };

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <div className="eq-page__header">
          <h1 className="eq-page__title">Audit log</h1>
          <p className="eq-page__lede">
            Every data write and every sign-in, scoped to your workspace.
          </p>
        </div>

        {err && <EqError message={err} onRetry={load} />}

        <div className="eq-tabs">
          <button
            type="button"
            className={`eq-tab ${tab === 'auth' ? 'eq-tab--active' : ''}`}
            onClick={() => setTab('auth')}
          >
            Login activity {authEvents && `(${authEvents.length})`}
          </button>
          <button
            type="button"
            className={`eq-tab ${tab === 'intakes' ? 'eq-tab--active' : ''}`}
            onClick={() => setTab('intakes')}
          >
            Imports {intakes && `(${intakes.length})`}
          </button>
        </div>

        {tab === 'auth' && (
          <div className="eq-table-wrap">
            <table className="eq-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>User</th>
                  <th>IP</th>
                  <th>Detail</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {loading && !authEvents ? (
                  <tr>
                    <td colSpan={5}>
                      <Skeleton variant="row" count={5} />
                    </td>
                  </tr>
                ) : !authEvents || authEvents.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 28 }}>
                      No login activity yet.
                    </td>
                  </tr>
                ) : (
                  authEvents.map((e) => (
                    <tr key={e.id}>
                      <td><span className={eventPill(e.event)}>{authEventLabel(e.event)}</span></td>
                      <td className="eq-table__mono">
                        {e.actor_email ?? e.actor_name ?? (e.actor_id ? e.actor_id.slice(0, 8) + '…' : <span className="eq-table__mute">—</span>)}
                      </td>
                      <td className="eq-table__mono">{e.ip ?? <span className="eq-table__mute">—</span>}</td>
                      <td className="eq-table__mute" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {authDetailSummary(e.detail)}
                      </td>
                      <td className="eq-table__mute">{relTime(e.at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'intakes' && (
          <div className="eq-table-wrap">
            <table className="eq-table">
              <thead>
                <tr>
                  <th>Record type</th>
                  <th>Source</th>
                  <th>App</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Committed</th>
                  <th style={{ textAlign: 'right' }}>Flagged</th>
                  <th style={{ textAlign: 'right' }}>Rejected</th>
                  <th>Started</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading && !intakes ? (
                  <tr>
                    <td colSpan={9}>
                      <Skeleton variant="row" count={5} />
                    </td>
                  </tr>
                ) : !intakes || intakes.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 28 }}>
                      No imports yet.
                    </td>
                  </tr>
                ) : (
                  intakes.map((e) => (
                    <tr key={e.intake_id}>
                      <td>{ENTITY_LABELS[e.entity] ?? e.entity}</td>
                      <td className="eq-table__mute">{e.source_filename ?? '—'}</td>
                      <td className="eq-table__mute">{e.source_app ?? '—'}</td>
                      <td>
                        <span className={pillFor(e.status)}>{STATUS_LABELS[e.status] ?? e.status}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{e.rows_committed.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{e.rows_flagged.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{e.rows_rejected.toLocaleString()}</td>
                      <td className="eq-table__mute">{relTime(e.started_at)}</td>
                      <td>
                        <Button variant="ghost" size="sm" onClick={() => openDrilldown(e)}>
                          View
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {drilldown && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.35)',
              display: 'flex',
              justifyContent: 'flex-end',
              zIndex: 100,
            }}
            onClick={() => setDrilldown(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Import details"
              style={{
                width: 'min(720px, 92vw)',
                background: 'var(--eq-bg)',
                borderLeft: '1px solid var(--eq-border)',
                padding: '24px 28px',
                overflowY: 'auto',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>
                    {ENTITY_LABELS[drilldown.intake.entity] ?? drilldown.intake.entity} import
                  </h2>
                  <p style={{ margin: 0, color: 'var(--eq-mute)', fontSize: 13 }}>
                    {drilldown.intake.source_filename ?? '—'} · {relTime(drilldown.intake.started_at)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setDrilldown(null)}>
                  Close
                </Button>
              </div>

              {drilldown.err && (
                <div className="eq-err" role="alert" style={{ marginTop: 16 }}>
                  {drilldown.err}
                </div>
              )}

              <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                {drilldown.intake.status !== 'rolled_back' && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => openRollback(drilldown.intake.intake_id)}
                  >
                    Roll back this import
                  </Button>
                )}
              </div>
              <h3 style={{ marginTop: 24, fontSize: 13, textTransform: 'uppercase', color: 'var(--eq-mute)' }}>
                Rows ({drilldown.rows?.length ?? '…'})
              </h3>
              {drilldown.loading ? (
                <Skeleton variant="row" count={5} />
              ) : (
                <div className="eq-table-wrap">
                  <table className="eq-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Outcome</th>
                        <th>Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(drilldown.rows ?? []).map((r) => (
                        <tr key={r.audit_id}>
                          <td>{r.source_row_index}</td>
                          <td>
                            <span className={r.outcome === 'committed' ? 'eq-pill eq-pill--ok' : 'eq-pill eq-pill--warn'}>
                              {OUTCOME_LABELS[r.outcome] ?? r.outcome}
                            </span>
                          </td>
                          <td className="eq-table__mute" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.canonical_row ? JSON.stringify(r.canonical_row).slice(0, 100) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {rollbackState && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(26, 26, 46, 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 200,
            }}
            onClick={() => !rollbackState.busy && setRollbackState(null)}
          >
            <div
              style={{
                background: 'var(--eq-bg)',
                border: '1px solid var(--eq-border)',
                borderRadius: 8,
                padding: '24px 28px',
                width: 'min(480px, 92vw)',
                boxShadow: 'var(--shadow-lg)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>Roll back import</h2>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--eq-grey)' }}>
                This deletes every row committed in this import. It cannot be undone. Describe why.
              </p>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--eq-grey)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Reason
              </label>
              <textarea
                rows={3}
                value={rollbackState.reason}
                onChange={(e) => setRollbackState((s) => s ? { ...s, reason: e.target.value } : s)}
                disabled={rollbackState.busy}
                placeholder="e.g. Wrong file uploaded — replacing with corrected version"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid var(--gray-300)',
                  borderRadius: 6,
                  fontSize: 14,
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  background: 'var(--eq-bg)',
                  color: 'var(--eq-ink)',
                  marginBottom: 16,
                }}
              />
              {rollbackState.err && (
                <div className="eq-err" style={{ marginBottom: 12 }}>{rollbackState.err}</div>
              )}
              {rollbackState.result && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--status-success-bg)', color: 'var(--status-success-fg)', borderRadius: 6, fontSize: 13 }}>
                  {rollbackState.result}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setRollbackState(null)}
                  disabled={rollbackState.busy}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={submitRollback}
                  disabled={rollbackState.busy || !rollbackState.reason.trim()}
                >
                  {rollbackState.busy ? 'Rolling back…' : 'Confirm rollback'}
                </Button>
              </div>
            </div>
          </div>
        )}
    </HubLayout>
  );
}

export default function AdminAuditPage() {
  return (
    <Gate
      perm="audit.view"
      fallback={
        <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
          <div className="eq-empty">
            <p className="eq-empty__title">Audit log requires manager access</p>
            <p>Talk to your manager if you need this view.</p>
          </div>
        </HubLayout>
      }
    >
      <AdminAuditInner />
    </Gate>
  );
}
