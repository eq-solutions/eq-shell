import { useCallback, useEffect, useState, useRef } from 'react';
import { CheckCircle, Clock, Activity, UserCheck } from 'lucide-react';
import { Table, type TableColumn } from '@eq-solutions/ui';
import { TableBulkAction } from '../components/TableBulkAction';
import { useSession } from '../session';
import { useCan } from '../permissions';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

interface FieldPerson {
  id: string;
  name: string;
  group: string | null;
  trade: string | null;
  phone: string | null;
  email: string | null;
  field_approved: boolean | null;
  active: boolean | null;
  created_at: string | null;
}

interface CanonicalEvent {
  id: string;
  event: string;
  app_source: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-AU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function GroupBadge({ group }: { group: string | null }) {
  if (!group) return <span style={{ color: 'var(--eq-text-secondary, #888)' }}>—</span>;
  const label = group.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 4,
      fontSize: 12, fontWeight: 500,
      background: 'var(--eq-surface-secondary, #f4f4f5)',
      color: 'var(--eq-text-secondary, #555)',
    }}>
      {label}
    </span>
  );
}

function ApprovedBadge({ approved }: { approved: boolean | null }) {
  if (approved) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#16a34a', fontSize: 13 }}>
        <CheckCircle size={14} /> Approved
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#ca8a04', fontSize: 13 }}>
      <Clock size={14} /> Pending
    </span>
  );
}

const ROSTER_COLS: TableColumn<FieldPerson>[] = [
  {
    key: 'name',
    header: 'Name',
    sortAccessor: (r) => r.name,
    render: (r) => <span style={{ fontWeight: 500 }}>{r.name || '—'}</span>,
  },
  {
    key: 'group',
    header: 'Type',
    sortAccessor: (r) => r.group ?? '',
    render: (r) => <GroupBadge group={r.group} />,
  },
  {
    key: 'trade',
    header: 'Trade',
    sortAccessor: (r) => r.trade ?? '',
    render: (r) => <span style={{ fontSize: 13, color: 'var(--eq-text-secondary, #888)' }}>{r.trade || '—'}</span>,
  },
  {
    key: 'phone',
    header: 'Phone',
    render: (r) => r.phone
      ? <a href={`tel:${r.phone}`} style={{ fontSize: 13, color: 'var(--eq-brand, #3DA8D8)', textDecoration: 'none' }}>{r.phone}</a>
      : <span style={{ color: 'var(--eq-text-secondary, #888)', fontSize: 13 }}>—</span>,
  },
  {
    key: 'field_approved',
    header: 'Status',
    render: (r) => <ApprovedBadge approved={r.field_approved} />,
  },
  {
    key: 'created_at',
    header: 'Added',
    sortAccessor: (r) => r.created_at ?? '',
    render: (r) => <span style={{ color: 'var(--eq-text-secondary, #888)', fontSize: 13 }}>{fmtDate(r.created_at)}</span>,
  },
];

function eventLabel(event: string): string {
  switch (event) {
    case 'staff.approved':    return 'Person approved';
    case 'staff.created':     return 'Person added';
    case 'staff.updated':     return 'Profile updated';
    case 'staff.deactivated': return 'Person deactivated';
    default: return event.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function ActivityFeed({ tenantId }: { tenantId: string }) {
  const [events, setEvents] = useState<CanonicalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function load() {
    fetch('/.netlify/functions/canonical-events?limit=15', { credentials: 'include' })
      .then((r) => r.json())
      .then((body: { ok: boolean; events?: CanonicalEvent[] }) => {
        if (body.ok) setEvents(body.events ?? []);
      })
      .catch(() => {/* non-critical — feed failure doesn't break the page */})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return (
    <div style={{
      border: '1px solid var(--eq-border, #e5e7eb)',
      borderRadius: 8,
      overflow: 'hidden',
      marginTop: 32,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px',
        borderBottom: '1px solid var(--eq-border, #e5e7eb)',
        background: 'var(--eq-surface-secondary, #f9fafb)',
      }}>
        <Activity size={15} style={{ color: 'var(--eq-brand, #3DA8D8)' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Canonical Activity</span>
        <span style={{ fontSize: 11, color: 'var(--eq-text-secondary, #888)', marginLeft: 4 }}>live · refreshes every 30s</span>
      </div>

      {loading && (
        <div style={{ padding: '20px 16px', color: 'var(--eq-text-secondary, #888)', fontSize: 13 }}>
          Loading…
        </div>
      )}

      {!loading && events.length === 0 && (
        <div style={{ padding: '20px 16px', color: 'var(--eq-text-secondary, #888)', fontSize: 13 }}>
          No activity yet. Approve someone from Cards to see the layer come to life.
        </div>
      )}

      {!loading && events.length > 0 && (
        <div>
          {events.map((ev, i) => (
            <div key={ev.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '10px 16px',
              borderBottom: i < events.length - 1 ? '1px solid var(--eq-border, #e5e7eb)' : 'none',
            }}>
              <div style={{
                flexShrink: 0, width: 28, height: 28,
                borderRadius: '50%',
                background: ev.event === 'staff.approved' ? '#dcfce7' : 'var(--eq-surface-secondary, #f4f4f5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {ev.event === 'staff.approved'
                  ? <UserCheck size={14} style={{ color: '#16a34a' }} />
                  : <Activity size={14} style={{ color: 'var(--eq-text-secondary, #888)' }} />
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{eventLabel(ev.event)}</div>
                <div style={{ fontSize: 11, color: 'var(--eq-text-secondary, #888)', marginTop: 1 }}>
                  {ev.app_source} · {fmtDateTime(ev.occurred_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FieldRosterPage() {
  const { session } = useSession();
  const canApprove = useCan('admin.review_cards');
  const [rows, setRows] = useState<FieldPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/.netlify/functions/entity-rows?entity=field_person&limit=200&sort_col=created_at&sort_dir=DESC', {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((body: { ok: boolean; rows?: Record<string, unknown>[]; error?: string }) => {
        if (cancelled) return;
        if (!body.ok) { setError(body.error ?? 'Failed to load roster'); return; }
        setRows((body.rows ?? []) as unknown as FieldPerson[]);
      })
      .catch(() => { if (!cancelled) setError('Network error'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [session?.tenant.id]);

  const approveSelected = useCallback(async (selectedRows: FieldPerson[], clearSelection: () => void) => {
    const toApprove = selectedRows.filter((r) => r.field_approved !== true);
    if (toApprove.length === 0) { clearSelection(); return; }

    setApproving(true);
    setActionMsg(null);
    let succeeded = 0;
    let failed = 0;

    for (const person of toApprove) {
      try {
        const res = await fetch('/.netlify/functions/cards-approve-staff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ staff_id: person.id, action: 'approve' }),
        });
        const body = (await res.json()) as { ok: boolean; error?: string };
        if (body.ok) {
          setRows((prev) => prev.map((r) => r.id === person.id ? { ...r, field_approved: true } : r));
          succeeded++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    setApproving(false);
    clearSelection();

    if (succeeded > 0 && failed === 0) {
      setActionMsg({ text: `${succeeded} person${succeeded > 1 ? 's' : ''} approved.`, ok: true });
      setTimeout(() => setActionMsg(null), 5000);
    } else if (failed > 0) {
      setActionMsg({ text: `${succeeded} approved, ${failed} failed — check permissions.`, ok: false });
    }
  }, []);

  const approved = rows.filter((r) => r.field_approved === true).length;
  const pending  = rows.filter((r) => r.field_approved !== true).length;

  const lede = loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'person' : 'people'} · ${approved} approved · ${pending} pending`;

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS} fullWidth>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* Zone A — header */}
        <div style={{ padding: '16px 24px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0, marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: '#1A1A2E', margin: '0 0 4px' }}>Field Roster</h1>
            <p style={{ fontSize: 13, color: 'var(--eq-mute)', margin: 0 }}>{lede}</p>
          </div>
        </div>

        {/* Zone B — stat chips */}
        <div style={{ padding: '0 24px', display: 'flex', gap: 12, marginBottom: 12, flexShrink: 0 }}>
          <StatCard label="Total"    value={loading ? '…' : String(rows.length)} />
          <StatCard label="Approved" value={loading ? '…' : String(approved)} accent="#16a34a" />
          <StatCard label="Pending"  value={loading ? '…' : String(pending)}  accent="#ca8a04" />
        </div>

        {/* Inline messages */}
        {error && (
          <div style={{ padding: '0 24px', flexShrink: 0 }}>
            <div style={{ padding: '12px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, marginBottom: 12, fontSize: 14 }}>
              {error}
            </div>
          </div>
        )}
        {actionMsg && (
          <div style={{ padding: '0 24px', flexShrink: 0 }}>
            <div style={{
              padding: '12px 16px', borderRadius: 6, marginBottom: 12, fontSize: 14,
              background: actionMsg.ok ? '#f0fdf4' : '#fef2f2',
              color: actionMsg.ok ? '#16a34a' : '#dc2626',
            }}>
              {actionMsg.text}
            </div>
          </div>
        )}

        {/* Zone C — table + activity feed */}
        <div style={{ flex: 1, overflow: 'auto', minWidth: 0, padding: '0 24px 24px' }}>
          <Table
            columns={ROSTER_COLS}
            rows={rows}
            getRowId={(r) => r.id}
            slicers={[
              { key: 'all',      label: 'All' },
              { key: 'approved', label: 'Approved', filter: (r) => r.field_approved === true,  dot: 'var(--eq-success-text)' },
              { key: 'pending',  label: 'Pending',  filter: (r) => r.field_approved !== true,  dot: 'var(--eq-warning-text)' },
            ]}
            globalSearch={{ placeholder: 'Search roster…' }}
            columnToggle
            exportable={{ filename: 'field-roster.csv' }}
            rowIndicator={(r) => r.field_approved === true ? null : { color: 'var(--eq-warning-text)' }}
            loading={loading}
            emptyMessage="No people on the roster yet. Approve someone from Cards to get started."
            pagination={{ pageSize: 25 }}
            summary={(v: number, t: number) => <>Showing <strong>{v}</strong> of <strong>{t.toLocaleString()}</strong></>}
            selectable={canApprove}
            selectedIds={selected}
            onSelectionChange={setSelected}
            bulkActions={canApprove ? (selectedRows, clearSelection) => {
              const pendingCount = selectedRows.filter((r) => r.field_approved !== true).length;
              if (pendingCount === 0) return null;
              return (
                <TableBulkAction
                  icon={<UserCheck size={14} />}
                  onClick={() => { void approveSelected(selectedRows, clearSelection); }}
                >
                  {approving ? 'Approving…' : `Approve ${pendingCount}`}
                </TableBulkAction>
              );
            } : undefined}
          />

          {session?.tenant.id && <ActivityFeed tenantId={session.tenant.id} />}
        </div>

      </div>
    </HubLayout>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{
      padding: '14px 20px', borderRadius: 8, minWidth: 100,
      background: 'var(--eq-surface-secondary, #f9fafb)',
      border: '1px solid var(--eq-border, #e5e7eb)',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? 'var(--eq-text, #1A1A2E)' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--eq-text-secondary, #888)', marginTop: 2 }}>{label}</div>
    </div>
  );
}
