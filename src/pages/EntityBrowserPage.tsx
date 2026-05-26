// EntityBrowserPage — a generic paged table for any canonical entity.
// URL: /:tenant/data/:entity (entity is the singular registry name)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSession } from '../session';
import { HubLayout } from '../components/HubLayout';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';

// Response from /.netlify/functions/entity-rows. The function reads from
// the tenant data plane via eq_browse_entity RPC (see
// supabase/tenant-migrations/0004_browse_entity_rpc.sql).
interface EntityRowsResponse {
  ok:      boolean;
  error?:  string;
  detail?: string;
  rows?:   Record<string, unknown>[];
  total?:  number;
}

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
  const { session } = useSession();
  const isManager =
    session?.user.role === 'manager' || session?.user.is_platform_admin === true;
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [detailRow, setDetailRow] = useState<Record<string, unknown> | null>(null);

  const load = useMemo(
    () => async () => {
      if (!view) return;
      setLoading(true);
      setErr(null);
      try {
        // Server-side: tenant_routing resolves the session's tenant to its
        // dedicated Supabase project, then eq_browse_entity (public schema,
        // SECURITY DEFINER) does the count + paged select on app_data.
        // We don't pass tenant in the URL — the function reads it from the
        // session cookie so users can't browse other tenants' data.
        const qs = new URLSearchParams({
          entity,
          limit:  String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        });
        const res = await fetch(`/.netlify/functions/entity-rows?${qs}`, {
          credentials: 'include',
        });
        const body = (await res.json()) as EntityRowsResponse;
        if (!res.ok || !body.ok) {
          throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
        }
        setRows(body.rows ?? []);
        setCount(body.total ?? 0);
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
      <HubLayout>
        <div className="eq-empty">
          <p className="eq-empty__title">Unknown entity "{entity}"</p>
          <p>Try one of: {Object.keys(ENTITY_VIEW).join(', ')}.</p>
        </div>
      </HubLayout>
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
    <HubLayout>
      <div className="eq-page__header">
          <h1 className="eq-page__title">{view.label}</h1>
          <p className="eq-page__lede">
            {count != null ? `${count.toLocaleString()} total` : '...'}
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
                  <tr
                    key={(r[`${entity}_id`] as string) ?? i}
                    onClick={() => setDetailRow(r)}
                    style={{ cursor: 'pointer' }}
                  >
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

      {detailRow && (
        <EntityDetailDrawer
          entity={entity}
          row={detailRow}
          onClose={() => setDetailRow(null)}
          onMutated={() => { setDetailRow(null); void load(); }}
          isManager={isManager}
        />
      )}
    </HubLayout>
  );
}

// Entities that support archive/delete from the shell.
// Staff and operational entities are managed inside EQ Field.
const MANAGEABLE_ENTITIES = new Set(['customer', 'site', 'contact']);

// Slide-out drawer showing the full row. Floating UI (not static),
// so per the design spec it CAN have a drop-shadow.
function EntityDetailDrawer({
  entity,
  row,
  onClose,
  onMutated,
  isManager,
}: {
  entity: string;
  row: Record<string, unknown>;
  onClose: () => void;
  onMutated: () => void;
  isManager: boolean;
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ESC closes the drawer — keyboard-first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDelete) { setConfirmDelete(false); return; }
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirmDelete]);

  const handleAction = useCallback(async (action: 'archive' | 'unarchive' | 'delete') => {
    const id = row[`${entity}_id`] as string;
    setActionLoading(action);
    setActionErr(null);
    try {
      const res = await fetch('/.netlify/functions/entity-actions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, id, action }),
      });
      const body = await res.json() as { ok: boolean; error?: string; detail?: string };
      if (!res.ok || !body.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
      onMutated();
    } catch (e) {
      setActionErr((e as Error).message);
      setActionLoading(null);
      setConfirmDelete(false);
    }
  }, [entity, row, onMutated]);

  // Sort keys so identifiers come first, audit fields last.
  const sortedEntries = Object.entries(row).sort(([a], [b]) => {
    const order = (k: string) => {
      if (k === `${entity}_id`) return 0;
      if (k === 'tenant_id') return 1;
      if (k.endsWith('_id')) return 2;
      if (k === 'created_at') return 99;
      if (k === 'updated_at') return 100;
      if (k.startsWith('imported_')) return 90;
      return 50;
    };
    return order(a) - order(b);
  });

  const title =
    (row.company_name as string | null) ??
    (row.full_name as string | null) ??
    ([row.first_name, row.last_name].filter(Boolean).join(' ') || null) ??
    (row.name as string | null) ??
    (row[`${entity}_id`] as string | null)?.slice(0, 8) ??
    `${entity} detail`;

  const isActive      = row.active !== false;
  const isManageable  = MANAGEABLE_ENTITIES.has(entity);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(26, 26, 46, 0.4)',
          zIndex: 50,
        }}
      />
      <aside
        role="dialog"
        aria-label={`${entity} detail`}
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          height: '100vh',
          width: 360,
          background: 'white',
          borderLeft: '1px solid #E5E7EB',
          zIndex: 51,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '20px 24px 0' }}>
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#666666',
                }}
              >
                {entity}
              </span>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#1A1A2E',
                  marginTop: 2,
                  letterSpacing: '-0.01em',
                }}
              >
                {title}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close detail"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: 18,
                color: '#666666',
                lineHeight: 1,
                padding: '4px 6px',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </header>

          {/* Management actions (customer / site / contact only) */}
          {isManageable && (
            <div style={{
              display: 'flex',
              gap: 8,
              paddingBottom: 16,
              marginBottom: 4,
              borderBottom: '1px solid #E5E7EB',
              flexWrap: 'wrap',
            }}>
              {isActive ? (
                <button
                  type="button"
                  className="eq-btn-ghost"
                  disabled={actionLoading !== null}
                  onClick={() => void handleAction('archive')}
                  style={{ fontSize: 12 }}
                >
                  {actionLoading === 'archive' ? 'Archiving…' : 'Archive'}
                </button>
              ) : (
                <button
                  type="button"
                  className="eq-btn-ghost"
                  disabled={actionLoading !== null}
                  onClick={() => void handleAction('unarchive')}
                  style={{ fontSize: 12 }}
                >
                  {actionLoading === 'unarchive' ? 'Restoring…' : 'Restore'}
                </button>
              )}

              {isManager && (
                confirmDelete ? (
                  <>
                    <button
                      type="button"
                      className="eq-btn-ghost"
                      disabled={actionLoading !== null}
                      onClick={() => void handleAction('delete')}
                      style={{ fontSize: 12, color: '#c0392b' }}
                    >
                      {actionLoading === 'delete' ? 'Deleting…' : 'Confirm delete'}
                    </button>
                    <button
                      type="button"
                      className="eq-btn-ghost"
                      disabled={actionLoading !== null}
                      onClick={() => setConfirmDelete(false)}
                      style={{ fontSize: 12 }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="eq-btn-ghost"
                    onClick={() => setConfirmDelete(true)}
                    style={{ fontSize: 12, color: '#c0392b' }}
                  >
                    Delete
                  </button>
                )
              )}
            </div>
          )}

          {actionErr && (
            <div style={{
              background: '#fdf2f2',
              border: '1px solid #c0392b',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 12,
              color: '#c0392b',
              marginBottom: 12,
            }}>
              {actionErr}
            </div>
          )}
        </div>

        <dl style={{ margin: 0, padding: '0 24px 24px', flex: 1 }}>
          {sortedEntries.map(([key, value]) => (
            <div
              key={key}
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr',
                gap: 12,
                padding: '10px 0',
                borderBottom: '1px solid #E5E7EB',
                alignItems: 'baseline',
              }}
            >
              <dt
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#666666',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {key.replace(/_/g, ' ')}
              </dt>
              <dd
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: '#1A1A2E',
                  wordBreak: 'break-word',
                  fontFamily:
                    value === null || typeof value === 'object'
                      ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
                      : 'inherit',
                }}
              >
                {value === null || value === undefined ? (
                  <span style={{ color: '#666666' }}>—</span>
                ) : typeof value === 'boolean' ? (
                  value ? 'Yes' : 'No'
                ) : typeof value === 'object' ? (
                  JSON.stringify(value, null, 2)
                ) : (
                  String(value)
                )}
              </dd>
            </div>
          ))}
        </dl>
      </aside>
    </>
  );
}

export default function EntityBrowserPage() {
  const { entity } = useParams<{ entity: string }>();
  const { session } = useSession();
  if (!session) return null;
  return <EntityBrowserInner entity={entity ?? ''} />;
}
