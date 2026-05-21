// EntityBrowserPage — a generic paged table for any canonical entity.
// URL: /:tenant/data/:entity (entity is the singular registry name)

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSession } from '../session';
import { createSupabaseClient } from '../lib/supabaseJwt';
import { Topbar } from '../components/Topbar';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';

// Maps the URL :entity (singular registry name) → app_data table (plural)
// and a small set of "preferred columns" so the table doesn't have to
// show 30+ fields. Order matters for column layout.
const ENTITY_VIEW: Record<
  string,
  { table: string; label: string; columns: { key: string; label: string }[] }
> = {
  customer: {
    table: 'customers',
    label: 'Customers',
    columns: [
      { key: 'company_name', label: 'Company' },
      { key: 'email', label: 'Email' },
      { key: 'primary_phone', label: 'Phone' },
      { key: 'state', label: 'State' },
      { key: 'active', label: 'Active' },
    ],
  },
  contact: {
    table: 'contacts',
    label: 'Contacts',
    columns: [
      { key: 'first_name', label: 'First' },
      { key: 'last_name', label: 'Last' },
      { key: 'email', label: 'Email' },
      { key: 'mobile_phone', label: 'Mobile' },
      { key: 'position', label: 'Position' },
    ],
  },
  site: {
    table: 'sites',
    label: 'Sites',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'code', label: 'Code' },
      { key: 'suburb', label: 'Suburb' },
      { key: 'state', label: 'State' },
      { key: 'site_type', label: 'Type' },
      { key: 'active', label: 'Active' },
    ],
  },
  staff: {
    table: 'staff',
    label: 'Staff',
    columns: [
      { key: 'first_name', label: 'First' },
      { key: 'last_name', label: 'Last' },
      { key: 'email', label: 'Email' },
      { key: 'employment_type', label: 'Type' },
      { key: 'trade', label: 'Trade' },
      { key: 'level', label: 'Level' },
      { key: 'active', label: 'Active' },
    ],
  },
  schedule: {
    table: 'schedule_entries',
    label: 'Schedule',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'staff_id', label: 'Staff' },
      { key: 'site_id', label: 'Site' },
      { key: 'hours_planned', label: 'Hours' },
      { key: 'shift', label: 'Shift' },
      { key: 'status', label: 'Status' },
    ],
  },
  timesheet: {
    table: 'timesheets',
    label: 'Timesheets',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'staff_id', label: 'Staff' },
      { key: 'site_id', label: 'Site' },
      { key: 'hours', label: 'Hours' },
      { key: 'status', label: 'Status' },
    ],
  },
  leave_request: {
    table: 'leave_requests',
    label: 'Leave requests',
    columns: [
      { key: 'staff_id', label: 'Staff' },
      { key: 'leave_type', label: 'Type' },
      { key: 'from_date', label: 'From' },
      { key: 'to_date', label: 'To' },
      { key: 'hours_requested', label: 'Hours' },
      { key: 'status', label: 'Status' },
    ],
  },
  tender: {
    table: 'tenders',
    label: 'Tenders',
    columns: [
      { key: 'tender_number', label: 'Number' },
      { key: 'title', label: 'Title' },
      { key: 'client_name', label: 'Client' },
      { key: 'stage', label: 'Stage' },
      { key: 'estimated_value_cents', label: 'Value' },
      { key: 'close_date', label: 'Close' },
    ],
  },
  prestart: {
    table: 'prestart_checks',
    label: 'Prestart checks',
    columns: [
      { key: 'site_id', label: 'Site' },
      { key: 'date', label: 'Date' },
      { key: 'completed_by', label: 'Completed by' },
      { key: 'completed_at', label: 'Completed at' },
    ],
  },
  toolbox_talk: {
    table: 'toolbox_talks',
    label: 'Toolbox talks',
    columns: [
      { key: 'site_id', label: 'Site' },
      { key: 'topic', label: 'Topic' },
      { key: 'delivered_by', label: 'Delivered by' },
      { key: 'delivered_at', label: 'Delivered at' },
    ],
  },
  licence: {
    table: 'licences',
    label: 'Licences',
    columns: [
      { key: 'staff_id', label: 'Staff' },
      { key: 'licence_type', label: 'Type' },
      { key: 'licence_number', label: 'Number' },
      { key: 'state', label: 'State' },
      { key: 'expiry_date', label: 'Expires' },
      { key: 'active', label: 'Active' },
    ],
  },
};

function formatCell(value: unknown, key: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key.endsWith('_cents') && typeof value === 'number') {
    return `$${(value / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (key.endsWith('_id') && typeof value === 'string') return value.slice(0, 8) + '…';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    try {
      return new Date(value).toLocaleDateString('en-AU');
    } catch {
      return value;
    }
  }
  return String(value);
}

const PAGE_SIZE = 50;

function EntityBrowserInner({ entity }: { entity: string }) {
  const view = ENTITY_VIEW[entity];
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useMemo(
    () => async () => {
      if (!view) return;
      setLoading(true);
      setErr(null);
      try {
        const sb = await createSupabaseClient();
        // Use RPC instead of schema('app_data').from() because Supabase
        // PostgREST exposed-schemas is a dashboard toggle, not a SQL config.
        // The RPC lives in public schema and returns jsonb rows + total count.
        const { data, error } = await sb.rpc('eq_browse_entity', {
          p_entity: entity,
          p_limit: PAGE_SIZE,
          p_offset: page * PAGE_SIZE,
        });
        if (error) throw new Error(error.message);

        type RpcRow = { row_json: Record<string, unknown>; total_count: number };
        const result = (data as RpcRow[]) ?? [];
        setRows(result.map((r) => r.row_json));
        setCount(result.length > 0 ? Number(result[0].total_count) : 0);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [view, page, entity],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) {
    return (
      <>
        <Topbar />
        <main className="eq-page">
          <div className="eq-empty">
            <p className="eq-empty__title">Unknown entity "{entity}"</p>
            <p>Try one of: {Object.keys(ENTITY_VIEW).join(', ')}.</p>
          </div>
        </main>
      </>
    );
  }

  const filtered = (rows ?? []).filter((r) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return view.columns.some((col) => {
      const v = r[col.key];
      return v != null && String(v).toLowerCase().includes(s);
    });
  });

  return (
    <>
      <Topbar />
      <main className="eq-page">
        <div className="eq-page__header">
          <h1 className="eq-page__title">{view.label}</h1>
          <p className="eq-page__lede">
            {count != null ? `${count.toLocaleString()} total` : 'Loading…'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
          <input
            type="search"
            placeholder={`Search ${view.label.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid var(--eq-border)',
              borderRadius: 6,
              flex: 1,
              maxWidth: 320,
              background: 'var(--eq-bg)',
              color: 'var(--eq-ink)',
            }}
          />
          {count != null && count > PAGE_SIZE && (
            <span style={{ color: 'var(--eq-mute)', fontSize: 13 }}>
              Page {page + 1} of {Math.ceil(count / PAGE_SIZE)}
            </span>
          )}
        </div>

        {err && <EqError message={err} onRetry={load} />}

        <div className="eq-table-wrap">
          <table className="eq-table">
            <thead>
              <tr>
                {view.columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && !rows ? (
                <tr>
                  <td colSpan={view.columns.length}>
                    <Skeleton variant="row" count={10} />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={view.columns.length}
                    style={{ textAlign: 'center', padding: 32, color: 'var(--eq-mute)' }}
                  >
                    {search ? `No rows matching "${search}".` : 'No rows yet — drop a CSV via Intake.'}
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <tr key={(r[`${entity}_id`] as string) ?? i}>
                    {view.columns.map((col) => (
                      <td key={col.key}>{formatCell(r[col.key], col.key)}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {count != null && count > PAGE_SIZE && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
            <button
              className="eq-btn-ghost"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </button>
            <button
              className="eq-btn-ghost"
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * PAGE_SIZE >= count}
            >
              Next
            </button>
          </div>
        )}
      </main>
    </>
  );
}

export default function EntityBrowserPage() {
  const { entity } = useParams<{ entity: string }>();
  const { session } = useSession();
  if (!session) return null;
  return <EntityBrowserInner entity={entity ?? ''} />;
}
