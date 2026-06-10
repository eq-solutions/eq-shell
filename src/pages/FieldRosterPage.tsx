// FieldRosterPage — Canonical field roster
// Route: /:tenant/field/roster
//
// Reads from the field_people view on the tenant's canonical data plane
// via entity-rows?entity=field_person. This is the sentient-layer stress
// test surface: starts empty, grows as Cards approvals land, never touches
// the legacy nspbmir database.

import { useEffect, useState } from 'react';
import { Users, CheckCircle, Clock } from 'lucide-react';
import { DataTable, type ColDef } from '../components/DataTable';
import { useSession } from '../session';

interface FieldPerson {
  id: string;
  name: string;
  group: string | null;
  field_approved: boolean | null;
  active: boolean | null;
  created_at: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
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

const COLS: ColDef<FieldPerson>[] = [
  {
    key: 'name',
    label: 'Name',
    defaultVisible: true,
    sortable: true,
    sortValue: (r) => r.name,
    render: (r) => <span style={{ fontWeight: 500 }}>{r.name || '—'}</span>,
  },
  {
    key: 'group',
    label: 'Type',
    defaultVisible: true,
    sortable: true,
    sortValue: (r) => r.group ?? '',
    render: (r) => <GroupBadge group={r.group} />,
  },
  {
    key: 'field_approved',
    label: 'Status',
    defaultVisible: true,
    render: (r) => <ApprovedBadge approved={r.field_approved} />,
  },
  {
    key: 'created_at',
    label: 'Added',
    defaultVisible: true,
    sortable: true,
    sortValue: (r) => r.created_at ?? '',
    render: (r) => <span style={{ color: 'var(--eq-text-secondary, #888)', fontSize: 13 }}>{fmtDate(r.created_at)}</span>,
  },
];

export default function FieldRosterPage() {
  const { session } = useSession();
  const [rows, setRows] = useState<FieldPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const approved = rows.filter((r) => r.field_approved === true).length;
  const pending  = rows.filter((r) => r.field_approved !== true).length;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <Users size={20} style={{ color: 'var(--eq-brand, #3DA8D8)' }} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Field Roster</h1>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        <StatCard label="Total" value={loading ? '…' : String(rows.length)} />
        <StatCard label="Approved" value={loading ? '…' : String(approved)} accent="#16a34a" />
        <StatCard label="Pending" value={loading ? '…' : String(pending)} accent="#ca8a04" />
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      <DataTable
        columns={COLS}
        rows={rows}
        rowKey={(r) => r.id}
        storageKey="field-roster"
        loading={loading}
        emptyMsg={loading ? 'Loading…' : 'No people on the roster yet. Approve someone from Cards to get started.'}
      />
    </div>
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
