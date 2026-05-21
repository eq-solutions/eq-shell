// AdminAuditPage — visibility into intake events + token mints.
// Two tabs. Click an intake to drill into per-row audit.

import { useEffect, useState } from 'react';
import { createSupabaseClient } from '../lib/supabaseJwt';
import { Topbar } from '../components/Topbar';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';
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

interface MintAudit {
  audit_id: string;
  user_id: string | null;
  token_type: string;
  jti: string | null;
  source_app: string | null;
  source_ip: string | null;
  user_agent: string | null;
  exp_at: string | null;
  minted_at: string;
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

function AdminAuditInner() {
  const [tab, setTab] = useState<'intakes' | 'mints'>('intakes');
  const [intakes, setIntakes] = useState<IntakeEvent[] | null>(null);
  const [mints, setMints] = useState<MintAudit[] | null>(null);
  const [drilldown, setDrilldown] = useState<{
    intake: IntakeEvent;
    rows: IntakeRow[] | null;
    loading: boolean;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const sb = await createSupabaseClient();
      const [iRes, mRes] = await Promise.all([
        sb.rpc('eq_recent_intake_events', { p_limit: 50 }),
        sb.rpc('eq_recent_mint_audit', { p_limit: 50 }),
      ]);
      if (iRes.error) throw new Error(iRes.error.message);
      if (mRes.error) throw new Error(mRes.error.message);
      setIntakes(iRes.data as IntakeEvent[]);
      setMints(mRes.data as MintAudit[]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openDrilldown = async (intake: IntakeEvent) => {
    setDrilldown({ intake, rows: null, loading: true });
    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb.rpc('eq_intake_event_rows', {
        p_intake_id: intake.intake_id,
        p_limit: 100,
      });
      if (error) throw new Error(error.message);
      setDrilldown({ intake, rows: data as IntakeRow[], loading: false });
    } catch (e) {
      setDrilldown({ intake, rows: [], loading: false });
      setErr((e as Error).message);
    }
  };

  const rollback = async (intakeId: string) => {
    const reason = prompt('Reason for rollback?');
    if (!reason) return;
    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb.rpc('eq_intake_rollback', {
        p_intake_id: intakeId,
        p_reason: reason,
      });
      if (error) throw new Error(error.message);
      alert(`Rolled back ${data ?? 0} rows.`);
      setDrilldown(null);
      await load();
    } catch (e) {
      alert(`Rollback failed: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <Topbar />
      <main className="eq-page">
        <div className="eq-page__header">
          <h1 className="eq-page__title">Audit log</h1>
          <p className="eq-page__lede">
            Every write to canonical + every JWT mint, tenant-scoped via RLS.
          </p>
        </div>

        {err && <EqError message={err} onRetry={load} />}

        <div className="eq-tabs">
          <button
            type="button"
            className={`eq-tab ${tab === 'intakes' ? 'eq-tab--active' : ''}`}
            onClick={() => setTab('intakes')}
          >
            Intake events {intakes && `(${intakes.length})`}
          </button>
          <button
            type="button"
            className={`eq-tab ${tab === 'mints' ? 'eq-tab--active' : ''}`}
            onClick={() => setTab('mints')}
          >
            Token mints {mints && `(${mints.length})`}
          </button>
        </div>

        {tab === 'intakes' && (
          <div className="eq-table-wrap">
            <table className="eq-table">
              <thead>
                <tr>
                  <th>Entity</th>
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
                      No intake events yet.
                    </td>
                  </tr>
                ) : (
                  intakes.map((e) => (
                    <tr key={e.intake_id}>
                      <td>{e.entity}</td>
                      <td className="eq-table__mute">{e.source_filename ?? '—'}</td>
                      <td className="eq-table__mute">{e.source_app ?? '—'}</td>
                      <td>
                        <span className={pillFor(e.status)}>{e.status}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{e.rows_committed.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{e.rows_flagged.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{e.rows_rejected.toLocaleString()}</td>
                      <td className="eq-table__mute">{relTime(e.started_at)}</td>
                      <td>
                        <button className="eq-btn-ghost" onClick={() => openDrilldown(e)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'mints' && (
          <div className="eq-table-wrap">
            <table className="eq-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Source app</th>
                  <th>User</th>
                  <th>IP</th>
                  <th>Minted</th>
                  <th>Expires</th>
                  <th>JTI</th>
                </tr>
              </thead>
              <tbody>
                {loading && !mints ? (
                  <tr>
                    <td colSpan={7}>
                      <Skeleton variant="row" count={5} />
                    </td>
                  </tr>
                ) : !mints || mints.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 28 }}>
                      No mint events yet.
                    </td>
                  </tr>
                ) : (
                  mints.map((m) => (
                    <tr key={m.audit_id}>
                      <td>
                        <span className="eq-pill eq-pill--info">{m.token_type}</span>
                      </td>
                      <td>{m.source_app ?? '—'}</td>
                      <td className="eq-table__mute">{m.user_id?.slice(0, 8) ?? '—'}…</td>
                      <td className="eq-table__mono">{m.source_ip ?? '—'}</td>
                      <td className="eq-table__mute">{relTime(m.minted_at)}</td>
                      <td className="eq-table__mute">{m.exp_at ? relTime(m.exp_at) : '—'}</td>
                      <td className="eq-table__mono">{m.jti?.slice(0, 8) ?? '—'}…</td>
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
                    {drilldown.intake.entity} · intake
                  </h2>
                  <p style={{ margin: 0, color: 'var(--eq-mute)', fontSize: 13 }}>
                    {drilldown.intake.source_filename ?? '—'} · {drilldown.intake.source_app ?? '—'}
                  </p>
                  <p style={{ margin: '8px 0 0', fontSize: 12, fontFamily: 'monospace', color: 'var(--eq-mute)' }}>
                    intake_id: {drilldown.intake.intake_id}
                  </p>
                </div>
                <button className="eq-btn-ghost" onClick={() => setDrilldown(null)}>
                  Close
                </button>
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                {drilldown.intake.status !== 'rolled_back' && (
                  <button
                    className="eq-btn-ghost"
                    style={{ borderColor: 'var(--eq-danger)', color: 'var(--eq-danger)' }}
                    onClick={() => rollback(drilldown.intake.intake_id)}
                  >
                    Roll back this intake
                  </button>
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
                              {r.outcome}
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
      </main>
    </>
  );
}

export default function AdminAuditPage() {
  return (
    <Gate
      perm="audit.view"
      fallback={
        <>
          <Topbar />
          <main className="eq-page">
            <div className="eq-empty">
              <p className="eq-empty__title">Audit log requires manager access</p>
              <p>Talk to your tenant manager if you need this view.</p>
            </div>
          </main>
        </>
      }
    >
      <AdminAuditInner />
    </Gate>
  );
}
