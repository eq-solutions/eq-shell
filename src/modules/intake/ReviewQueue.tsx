// ReviewQueue — the reviewer side of the intake review queue.
//
// Imports route flagged rows (conflicts / errors) into app_data.eq_intake_staging
// instead of straight to the entity tables (see intake-stage). This screen is
// where a supervisor or manager works that queue: a list of batches awaiting
// review, drilling into one to see each staged row with its health score and
// conflicts, then approving (replays the commit RPC) or rejecting per-row, in
// bulk, or all at once.
//
// Data:
//   - Batch list  → control plane (eq_intake_events, status='pending_review')
//                   via createSupabaseClient(), RLS-scoped to the tenant.
//   - Staged rows → tenant data plane (app_data.eq_intake_staging) via the SKS
//                   browser client, readable under the tenant SELECT policy.
//   - Actions     → intake-staging-approve / -reject functions (service-role).
//
// Gated by intake.commit — the queue is a reviewer tool; the server re-checks
// the same permission on every approve/reject.
//
// Data loading uses the inline-IIFE + `reloadKey` pattern (mirrors
// DomainLanding) so state is only set after an await — keeps the
// set-state-in-effect lint rule happy. Refetches bump reloadKey rather than
// calling a setState-bearing callback from the effect.

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { ArrowLeft, Check, X, AlertTriangle, Copy } from 'lucide-react';
import { Table, type TableColumn } from '@eq-solutions/ui';
import { useSession } from '../../session';
import { Gate } from '../../permissions/Gate';
import { HubLayout } from '../../components/HubLayout';
import { defaultSidebarRecords } from '../../lib/sidebarConfig';
import { createSupabaseClient } from '../../lib/supabaseJwt';
import { createSKSSupabaseClient } from '../../lib/sksSupabaseClient';
import { friendlyError } from '../../lib/friendlyError';

const SIDEBAR_RECORDS = defaultSidebarRecords();

interface BatchSummary {
  health_score?: number;
  conflict_count?: number;
  flagged_count?: number;
  staged_count?: number;
}

interface PendingBatch {
  intake_id: string;
  entity: string;
  source_filename: string | null;
  started_at: string;
  rows_flagged: number;
  rows_committed: number;
  validation_summary: BatchSummary | null;
}

interface HealthFlag {
  field: string | null;
  severity: 'error' | 'warning' | 'info';
  reason: string;
}
interface Conflict {
  type: 'duplicate' | 'update';
  match_id: string;
  match_summary: string;
  on: string[];
}
interface StagedRow {
  staging_id: string;
  source_row_index: number;
  entity: string;
  target_table: string;
  canonical: Record<string, unknown>;
  row_health: number;
  health_flags: HealthFlag[];
  conflicts: Conflict[];
  status: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** A short, entity-aware label for a staged row. */
function rowSummary(entity: string, c: Record<string, unknown>): string {
  switch (entity) {
    case 'licence':
      return [str(c.licence_type), str(c.licence_number)].filter(Boolean).join(' · ') || '(licence)';
    case 'staff':
      return [[str(c.first_name), str(c.last_name)].filter(Boolean).join(' '), str(c.email)]
        .filter(Boolean).join(' · ') || '(staff member)';
    case 'tender':
      return [str(c.tender_number), str(c.title)].filter(Boolean).join(' · ') || '(tender)';
    default: {
      const vals = Object.values(c)
        .filter((v) => v !== null && v !== undefined && typeof v !== 'object')
        .slice(0, 2)
        .map(String);
      return vals.join(' · ') || '(row)';
    }
  }
}

function healthColor(h: number): string {
  if (h >= 0.8) return 'var(--eq-success-text, #1a7f37)';
  if (h >= 0.5) return 'var(--eq-warning-text, #9a6700)';
  return 'var(--eq-error-text, #cf222e)';
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function btnStyle(opts: { danger?: boolean; disabled?: boolean } = {}): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', fontSize: 13, borderRadius: 6, fontWeight: 500,
    cursor: opts.disabled ? 'default' : 'pointer',
    opacity: opts.disabled ? 0.55 : 1,
    border: `1px solid ${opts.danger ? 'var(--eq-error-text,#cf222e)' : 'var(--eq-border,#d0d7de)'}`,
    background: 'var(--eq-surface,#fff)',
    color: opts.danger ? 'var(--eq-error-text,#cf222e)' : 'var(--eq-text,#1a1a2e)',
  };
}

async function postAction(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || json.ok !== true) {
    throw new Error((json.detail as string) || (json.error as string) || `Request failed (${res.status})`);
  }
  return json;
}

// ── issue chips ───────────────────────────────────────────────────────────────

function IssueChips({ row }: { row: StagedRow }) {
  const chips: { text: string; title: string; tone: 'error' | 'warning' | 'info' }[] = [];
  for (const c of row.conflicts) {
    chips.push({
      text: c.type === 'duplicate' ? 'Possible duplicate' : 'Updates existing',
      title: `${c.match_summary} (matched on ${c.on.join(', ')})`,
      tone: c.type === 'duplicate' ? 'error' : 'warning',
    });
  }
  for (const f of row.health_flags) {
    if (f.severity === 'info') continue; // advisory — the row wouldn't be queued on info alone
    chips.push({ text: f.reason, title: f.field ? `${f.field}: ${f.reason}` : f.reason, tone: f.severity });
  }
  if (chips.length === 0) return <span style={{ color: 'var(--eq-text-subtle, #888)' }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {chips.map((c, i) => (
        <span
          key={i}
          title={c.title}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 12, padding: '2px 8px', borderRadius: 999,
            background: c.tone === 'error' ? 'var(--eq-error-bg, #ffebe9)'
              : c.tone === 'warning' ? 'var(--eq-warning-bg, #fff8c5)' : 'var(--eq-surface-2, #f0f0f0)',
            color: c.tone === 'error' ? 'var(--eq-error-text, #cf222e)'
              : c.tone === 'warning' ? 'var(--eq-warning-text, #9a6700)' : 'inherit',
          }}
        >
          {c.tone === 'error' ? <Copy size={11} /> : <AlertTriangle size={11} />}
          {c.text}
        </span>
      ))}
    </span>
  );
}

// ── batch detail ───────────────────────────────────────────────────────────────

function BatchDetail({ batch, onClose }: { batch: PendingBatch; onClose: (changed: boolean) => void }) {
  const [rows, setRows] = useState<StagedRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sks = await createSKSSupabaseClient();
        const { data, error } = await sks
          .from('eq_intake_staging')
          .select('staging_id, source_row_index, entity, target_table, canonical, row_health, health_flags, conflicts, status')
          .eq('intake_id', batch.intake_id)
          .eq('status', 'pending')
          .order('source_row_index', { ascending: true });
        if (cancelled) return;
        if (error) { setErr(friendlyError(error, "We couldn't load the rows for this batch.")); return; }
        setErr(null);
        setRows((data as StagedRow[]) ?? []);
      } catch (e) {
        if (!cancelled) setErr(friendlyError(e, "We couldn't load the rows for this batch."));
      }
    })();
    return () => { cancelled = true; };
  }, [batch.intake_id, reloadKey]);

  const act = useCallback(
    async (kind: 'approve' | 'reject', ids: string[] | 'all') => {
      const count = ids === 'all' ? (rows?.length ?? 0) : ids.length;
      if (count === 0) return;
      if (kind === 'reject') {
        const ok = window.confirm(
          `Reject ${count} row${count === 1 ? '' : 's'}? ${count === 1 ? 'It' : 'They'} won't be imported.`,
        );
        if (!ok) return;
      }
      setBusy(true);
      setErr(null);
      try {
        const path = kind === 'approve'
          ? '/.netlify/functions/intake-staging-approve'
          : '/.netlify/functions/intake-staging-reject';
        const body: Record<string, unknown> = { intake_id: batch.intake_id };
        if (ids !== 'all') body.staging_ids = ids;
        const result = await postAction(path, body);
        setChanged(true);
        setSelectedIds(new Set());
        const remaining = (result.remaining_pending as number) ?? 0;
        if (remaining === 0) { onClose(true); return; }
        setReloadKey((k) => k + 1);
      } catch (e) {
        setErr(friendlyError(e, 'That action could not be completed. Please try again.'));
      } finally {
        setBusy(false);
      }
    },
    [batch.intake_id, rows, onClose],
  );

  const columns: TableColumn<StagedRow>[] = [
    { key: 'row', header: 'Row', width: 64, render: (r) => <span style={{ color: 'var(--eq-text-subtle,#888)' }}>#{r.source_row_index + 1}</span> },
    { key: 'summary', header: 'Record', render: (r) => <strong>{rowSummary(r.entity, r.canonical)}</strong> },
    {
      key: 'health', header: 'Health', width: 88, align: 'center',
      sortAccessor: (r) => r.row_health,
      render: (r) => <span style={{ fontWeight: 600, color: healthColor(r.row_health) }}>{Math.round(r.row_health * 100)}%</span>,
    },
    { key: 'issues', header: 'Why it’s held', render: (r) => <IssueChips row={r} /> },
    {
      key: 'decision', header: '', width: 184, align: 'right',
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" style={btnStyle({ disabled: busy })} disabled={busy}
            onClick={() => void act('approve', [r.staging_id])} title="Import this row">
            <Check size={13} /> Approve
          </button>
          <button type="button" style={btnStyle({ danger: true, disabled: busy })} disabled={busy}
            onClick={() => void act('reject', [r.staging_id])} title="Discard this row">
            <X size={13} /> Reject
          </button>
        </span>
      ),
    },
  ];

  const summary = batch.validation_summary;

  return (
    <div className="domain-landing">
      <header className="domain-landing__header">
        <button type="button" style={{ ...btnStyle(), marginBottom: 12 }} onClick={() => onClose(changed)}>
          <ArrowLeft size={14} /> Back to queue
        </button>
        <h1>Review {batch.entity}</h1>
        <p>
          {batch.source_filename ?? 'Import'} · {timeAgo(batch.started_at)}
          {batch.rows_committed > 0 && ` · ${batch.rows_committed} already imported`}
          {typeof summary?.health_score === 'number' && ` · batch health ${summary.health_score}%`}
        </p>
      </header>

      {err && <div className="eq-error" role="alert">{err}</div>}

      {rows === null && <div className="eq-loading">Loading rows…</div>}

      {rows !== null && rows.length === 0 && !err && (
        <div className="eq-coming-soon"><p>Nothing left to review in this batch.</p></div>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" style={btnStyle({ disabled: busy })} disabled={busy} onClick={() => void act('approve', 'all')}>
              <Check size={14} /> Approve all ({rows.length})
            </button>
            <button type="button" style={btnStyle({ danger: true, disabled: busy })} disabled={busy} onClick={() => void act('reject', 'all')}>
              <X size={14} /> Reject all
            </button>
            {selectedIds.size > 0 && (
              <>
                <span style={{ marginLeft: 8, color: 'var(--eq-text-subtle,#888)', fontSize: 13 }}>
                  {selectedIds.size} selected
                </span>
                <button type="button" style={btnStyle({ disabled: busy })} disabled={busy}
                  onClick={() => void act('approve', [...selectedIds])}>
                  <Check size={14} /> Approve selected
                </button>
                <button type="button" style={btnStyle({ danger: true, disabled: busy })} disabled={busy}
                  onClick={() => void act('reject', [...selectedIds])}>
                  <X size={14} /> Reject selected
                </button>
              </>
            )}
          </div>
          <Table<StagedRow>
            columns={columns}
            rows={rows}
            getRowId={(r) => r.staging_id}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            emptyMessage="Nothing to review."
          />
        </>
      )}
    </div>
  );
}

// ── batch list ─────────────────────────────────────────────────────────────────

function ReviewQueueInner() {
  const { session } = useSession();
  const [batches, setBatches] = useState<PendingBatch[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<PendingBatch | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const tenantId = session?.tenant.id;

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const sb = await createSupabaseClient();
        const { data, error } = await sb
          .schema('shell_control')
          .from('eq_intake_events')
          .select('intake_id, entity, source_filename, started_at, rows_flagged, rows_committed, validation_summary')
          .eq('tenant_id', tenantId)
          .eq('status', 'pending_review')
          .order('started_at', { ascending: false });
        if (cancelled) return;
        if (error) { setErr(friendlyError(error, "We couldn't load the review queue.")); return; }
        setErr(null);
        setBatches((data as PendingBatch[]) ?? []);
      } catch (e) {
        if (!cancelled) setErr(friendlyError(e, "We couldn't load the review queue."));
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, reloadKey]);

  if (active) {
    return (
      <BatchDetail
        batch={active}
        onClose={(changed) => {
          setActive(null);
          if (changed) setReloadKey((k) => k + 1);
        }}
      />
    );
  }

  return (
    <div className="domain-landing">
      <header className="domain-landing__header">
        <h1>Review queue</h1>
        <p>Imported rows with possible duplicates or problems wait here for a closer look before they’re saved.</p>
      </header>

      {err && <div className="eq-error" role="alert">{err}</div>}
      {batches === null && !err && <div className="eq-loading">Loading…</div>}

      {batches !== null && batches.length === 0 && !err && (
        <div className="eq-coming-soon"><p>Nothing waiting for review. Clean imports save straight away.</p></div>
      )}

      {batches !== null && batches.length > 0 && (
        <div className="entity-grid">
          {batches.map((b) => {
            const s = b.validation_summary;
            return (
              <article key={b.intake_id} className="entity-card">
                <header>
                  <h3>{b.entity}</h3>
                </header>
                <p style={{ margin: '4px 0 8px', color: 'var(--eq-text-subtle,#888)', fontSize: 13 }}>
                  {b.rows_flagged} row{b.rows_flagged === 1 ? '' : 's'} to review
                  {typeof s?.conflict_count === 'number' && s.conflict_count > 0 && ` · ${s.conflict_count} possible duplicate${s.conflict_count === 1 ? '' : 's'}`}
                  <br />
                  {b.source_filename ?? 'Import'} · {timeAgo(b.started_at)}
                  {typeof s?.health_score === 'number' && ` · health ${s.health_score}%`}
                </p>
                <button type="button" className="entity-import-btn" onClick={() => setActive(b)}>
                  Review {b.rows_flagged} row{b.rows_flagged === 1 ? '' : 's'}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function IntakeReviewQueue() {
  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <Gate
        perm="intake.commit"
        fallback={
          <div className="eq-coming-soon">
            <h2>Review queue</h2>
            <p>Only managers and supervisors review imported records. Ask your manager if you need access.</p>
          </div>
        }
      >
        <ReviewQueueInner />
      </Gate>
    </HubLayout>
  );
}
