// AdminMigrationPage — migration reconciliation. Per canonical entity:
// expected (operator baseline) vs landed (actual rows in the tenant DB),
// plus flagged/rejected rolled up from any intake events. Read-only — the
// instrument for proving a tenant's migration into EQ canonical/Field is
// complete and clean before cutover.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '../session';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';
import { Gate } from '../permissions/Gate';

const SIDEBAR_RECORDS = defaultSidebarRecords();

interface OrphanDetail {
  fk:     string;
  parent: string;
  count:  number;
}

interface ReconcileRow {
  entity:        string;
  label:         string;
  expected:      number | null;
  landed:        number;
  delta:         number | null;
  orphans:       number;
  orphan_detail: OrphanDetail[];
  flagged:       number;
  rejected:      number;
  last_activity: string | null;
  browse_entity: string | null;
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
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Broken links or rejected rows are a problem regardless of baseline — flag
// them first. Otherwise: no baseline → can't judge; matching counts → reconciled;
// differing counts → mismatch.
function statusFor(r: ReconcileRow): { pill: string; label: string } {
  if (r.orphans > 0) return { pill: 'eq-pill eq-pill--err', label: 'Broken links' };
  if (r.rejected > 0) return { pill: 'eq-pill eq-pill--err', label: 'Rejected rows' };
  if (r.expected === null) return { pill: 'eq-pill eq-pill--info', label: 'No baseline' };
  if (r.delta === 0) return { pill: 'eq-pill eq-pill--ok', label: 'Reconciled' };
  return { pill: 'eq-pill eq-pill--err', label: 'Mismatch' };
}

function AdminMigrationInner() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session } = useSession();
  const [rows, setRows] = useState<ReconcileRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/.netlify/functions/migration-reconcile', { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setRows((body as { rows: ReconcileRow[] }).rows);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!session) return null;

  const allRows      = rows ?? [];
  // "Needs attention" is baseline-independent: broken links or rejected rows
  // are problems on their own; a captured baseline that doesn't match is too.
  const needsAttention = allRows.filter(
    (r) => r.orphans > 0 || r.rejected > 0 || (r.expected !== null && r.delta !== 0),
  ).length;
  const reconciled = allRows.filter(
    (r) => r.expected !== null && r.delta === 0 && r.rejected === 0 && r.orphans === 0,
  ).length;
  const hasBaseline = allRows.some((r) => r.expected !== null);

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <div className="eq-page__header">
        <h1 className="eq-page__title">Migration</h1>
        <p className="eq-page__lede">
          Expected vs landed record counts for this workspace. Use it to confirm a
          migration is complete before going live — any mismatch flags data that
          didn't land or didn't match.
        </p>
      </div>

      {err && <EqError title="Couldn't load reconciliation" message={err} onRetry={load} />}

      {!loading && allRows.length > 0 && (
        <div
          className={`eq-hub-alert ${needsAttention > 0 ? 'eq-hub-alert--action' : 'eq-hub-alert--clear'}`}
          style={{ marginBottom: 16 }}
        >
          <span className="eq-hub-alert__text">
            {needsAttention > 0
              ? `${needsAttention} need attention`
              : 'All clear'}
            {hasBaseline ? ` · ${reconciled} reconciled` : ' · no baseline captured yet'}
          </span>
        </div>
      )}

      <div className="eq-table-wrap">
        <table className="eq-table">
          <thead>
            <tr>
              <th>Record type</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Expected</th>
              <th style={{ textAlign: 'right' }}>Landed</th>
              <th style={{ textAlign: 'right' }}>Difference</th>
              <th style={{ textAlign: 'right' }}>Broken links</th>
              <th style={{ textAlign: 'right' }}>Flagged</th>
              <th style={{ textAlign: 'right' }}>Rejected</th>
              <th>Last import</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && !rows ? (
              <tr><td colSpan={10}><Skeleton variant="row" count={6} /></td></tr>
            ) : !rows || rows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 28 }}>
                  No records found in this workspace yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const status = statusFor(r);
                return (
                  <tr key={r.entity}>
                    <td>{r.label}</td>
                    <td><span className={status.pill}>{status.label}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      {r.expected === null
                        ? <span className="eq-table__mute">—</span>
                        : r.expected.toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.landed.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.delta === null
                        ? <span className="eq-table__mute">—</span>
                        : r.delta === 0
                          ? <span className="eq-table__mute">0</span>
                          : <span style={{ color: 'var(--status-error-fg, #b42318)', fontWeight: 600 }}>
                              {r.delta > 0 ? `+${r.delta.toLocaleString()}` : r.delta.toLocaleString()}
                            </span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.orphans > 0
                        ? <span
                            style={{ color: 'var(--status-error-fg, #b42318)', fontWeight: 600 }}
                            title={r.orphan_detail.map((o) => `${o.count} → no ${o.parent}`).join('; ')}
                          >
                            {r.orphans.toLocaleString()}
                          </span>
                        : <span className="eq-table__mute">0</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.flagged > 0
                        ? <span style={{ fontWeight: 600 }}>{r.flagged.toLocaleString()}</span>
                        : <span className="eq-table__mute">0</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.rejected > 0
                        ? <span style={{ color: 'var(--status-error-fg, #b42318)', fontWeight: 600 }}>{r.rejected.toLocaleString()}</span>
                        : <span className="eq-table__mute">0</span>}
                    </td>
                    <td className="eq-table__mute">{relTime(r.last_activity)}</td>
                    <td>
                      {r.browse_entity && (
                        <Link
                          to={`/${tenantSlug}/data/${r.browse_entity}`}
                          className="eq-hub-activity__view-all"
                        >
                          View →
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="eq-page__lede" style={{ marginTop: 16, fontSize: 13 }}>
        "Expected" comes from the migration baseline captured for this workspace;
        entities without one show "—" and can't be judged complete. "Broken links"
        counts records that landed but point at a parent that didn't — hover the
        number for which link. These are flagged even without a baseline.
      </p>
    </HubLayout>
  );
}

export default function AdminMigrationPage() {
  return (
    <Gate
      perm="audit.view"
      fallback={
        <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
          <div className="eq-empty">
            <p className="eq-empty__title">Migration view requires manager access</p>
            <p>Talk to your manager if you need this view.</p>
          </div>
        </HubLayout>
      }
    >
      <AdminMigrationInner />
    </Gate>
  );
}
