// EntityBrowserPage — a generic paged table for any canonical entity.
// URL: /:tenant/data/:entity (entity is the singular registry name)

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@eq-solutions/ui';
import { useSession } from '../session';
import { useCan } from '../permissions';
import { AssetDrawerExtras } from './AssetDrawerExtras';
import { HubLayout } from '../components/HubLayout';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

// Response from /.netlify/functions/entity-rows. The function reads from
// the tenant data plane via eq_browse_entity RPC (see
// supabase/tenant-migrations/0014_browse_entity_search.sql).
interface EntityRowsResponse {
  ok:       boolean;
  error?:   string;
  detail?:  string;
  rows?:    Record<string, unknown>[];
  total?:   number;
  search?:  string | null;
  sort_col?: string;
  sort_dir?: string;
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
  asset: {
    table: 'assets',
    label: 'Equipment',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'external_id', label: 'Tag' },
      { key: 'asset_type', label: 'Type' },
      { key: 'make', label: 'Make' },
      { key: 'serial_number', label: 'Serial' },
      { key: 'site_id', label: 'Site' },
      { key: 'next_service_due', label: 'Next service' },
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

// Entities where the DB table has an `active` boolean column.
// Determines whether the Active / All / Inactive filter strip is shown.
const ACTIVE_FILTER_ENTITIES = new Set([
  'customer', 'contact', 'site', 'staff', 'licence', 'asset',
]);

// Debounce helper — delays firing fn until ms of silence.
function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// Entities that support manual creation from the shell (CRM records only;
// assets are created via Service or Intake, not manual shell forms).
const CREATE_ENTITIES = new Set(['customer', 'site', 'contact']);

function EntityBrowserInner({ entity }: { entity: string }) {
  const view = ENTITY_VIEW[entity];
  const canDelete = useCan('entity.delete');
  const canCreate = useCan('entity.create');
  const { session } = useSession();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [urlSearchParams] = useSearchParams();
  const isManager =
    session?.user.role === 'manager' || session?.user.is_platform_admin === true;

  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();

  // Search — input is immediate, server fetch is debounced. Seeds from the
  // ?search= query param so a scanned QR label (or a hierarchy link) lands
  // pre-filtered to the target asset.
  const [searchInput, setSearchInput] = useState(() => urlSearchParams.get('search') ?? '');
  const search = useDebounce(searchInput, 300);
  const urlSearch = urlSearchParams.get('search') ?? '';
  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);

  // Sort — only allow columns declared in the view config.
  const [sortCol, setSortCol] = useState('created_at');
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>('DESC');

  // Active filter — null = All, true = Active only, false = Inactive only.
  // Only shown for entities that have an `active` boolean column.
  const supportsActiveFilter = ACTIVE_FILTER_ENTITIES.has(entity);
  const [activeFilter, setActiveFilter] = useState<boolean | null>(null);

  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = useState(false);

  // Reset to page 0 whenever search, sort, or active filter changes.
  const prevSearch = useRef(search);
  const prevSort   = useRef({ sortCol, sortDir });
  const prevActive = useRef(activeFilter);
  useEffect(() => {
    if (prevSearch.current !== search ||
        prevSort.current.sortCol !== sortCol ||
        prevSort.current.sortDir !== sortDir ||
        prevActive.current !== activeFilter) {
      prevSearch.current = search;
      prevSort.current   = { sortCol, sortDir };
      prevActive.current = activeFilter;
      setPage(0);
    }
  }, [search, sortCol, sortDir, activeFilter]);

  const load = useMemo(
    () => async () => {
      if (!view) return;
      setLoading(true);
      setErr(null);
      try {
        // Server-side: tenant_routing resolves the session's tenant to its
        // dedicated Supabase project, then eq_browse_entity does the count +
        // paged select on app_data with optional search + sort.
        const qs = new URLSearchParams({
          entity,
          limit:    String(PAGE_SIZE),
          offset:   String(page * PAGE_SIZE),
          sort_col: sortCol,
          sort_dir: sortDir,
        });
        if (search) qs.set('search', search);
        if (supportsActiveFilter && activeFilter !== null) {
          qs.set('active', String(activeFilter));
        }
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
    [view, page, entity, search, sortCol, sortDir, activeFilter, supportsActiveFilter],
  );

  useEffect(() => { void load(); }, [load]);

  const handleSort = (key: string) => {
    startTransition(() => {
      if (sortCol === key) {
        setSortDir((d) => (d === 'DESC' ? 'ASC' : 'DESC'));
      } else {
        setSortCol(key);
        setSortDir('DESC');
      }
    });
  };

  if (!view) {
    return (
      <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
        <div className="eq-empty">
          <p className="eq-empty__title">Unknown entity "{entity}"</p>
          <p>Try one of: {Object.keys(ENTITY_VIEW).join(', ')}.</p>
        </div>
      </HubLayout>
    );
  }

  const totalPages = count != null ? Math.ceil(count / PAGE_SIZE) : null;

  return (
    <HubLayout>
      <div className="eq-page__header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 className="eq-page__title">{view.label}</h1>
          <p className="eq-page__lede">
            {count != null
              ? search || activeFilter !== null
                ? `${count.toLocaleString()} matching`
                : `${count.toLocaleString()} total`
              : '…'}
          </p>
        </div>
        {canCreate && CREATE_ENTITIES.has(entity) && (
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            New {view.label.toLowerCase().replace(/s$/, '')}
          </Button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder={`Search ${view.label.toLowerCase()}…`}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--eq-border)',
            borderRadius: 6,
            flex: '1 1 200px',
            maxWidth: 320,
            background: 'var(--eq-bg)',
            color: 'var(--eq-ink)',
          }}
        />
        {search && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSearchInput('')}
          >
            Clear
          </Button>
        )}

        {/* Active / All / Inactive filter — only for entities with an active column */}
        {supportsActiveFilter && (
          <div style={{ display: 'flex', border: '1px solid var(--eq-border)', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
            {([
              { label: 'Active',   value: true  as boolean | null },
              { label: 'All',      value: null  as boolean | null },
              { label: 'Inactive', value: false as boolean | null },
            ] as { label: string; value: boolean | null }[]).map(({ label, value }) => {
              const isSelected = activeFilter === value;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setActiveFilter(value)}
                  style={{
                    padding: '0 12px',
                    height: 34,
                    fontSize: 12,
                    fontWeight: isSelected ? 600 : 400,
                    border: 'none',
                    borderRight: label !== 'Inactive' ? '1px solid var(--eq-border)' : 'none',
                    background: isSelected ? 'var(--eq-brand, #3DA8D8)' : 'var(--eq-bg)',
                    color: isSelected ? '#fff' : 'var(--eq-ink)',
                    cursor: 'pointer',
                    transition: 'background 120ms, color 120ms',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {totalPages != null && totalPages > 1 && (
          <span style={{ color: 'var(--eq-mute)', fontSize: 13, marginLeft: 'auto' }}>
            Page {page + 1} of {totalPages}
          </span>
        )}
      </div>

      {err && <EqError message={err} onRetry={load} />}

      <div className="eq-table-wrap" style={{ opacity: loading && rows !== null ? 0.6 : 1, transition: 'opacity 150ms' }}>
        <table className="eq-table">
          <thead>
            <tr>
              {view.columns.map((c) => {
                const isSorted = sortCol === c.key;
                return (
                  <th
                    key={c.key}
                    onClick={() => handleSort(c.key)}
                    style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                    aria-sort={isSorted ? (sortDir === 'ASC' ? 'ascending' : 'descending') : 'none'}
                  >
                    {c.label}
                    {' '}
                    <span style={{ opacity: isSorted ? 1 : 0.25, fontSize: 11 }} aria-hidden="true">
                      {isSorted ? (sortDir === 'ASC' ? '▲' : '▼') : '▼'}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading && !rows ? (
              <tr>
                <td colSpan={view.columns.length}>
                  <Skeleton variant="row" count={10} />
                </td>
              </tr>
            ) : (rows ?? []).length === 0 ? (
              <tr>
                <td
                  colSpan={view.columns.length}
                  style={{ textAlign: 'center', padding: 32, color: 'var(--eq-mute)' }}
                >
                  {search ? `No rows matching "${search}".` : 'No rows yet — drop a CSV via Intake.'}
                </td>
              </tr>
            ) : (
              (rows ?? []).map((r, i) => (
                <tr
                  key={(r[`${entity}_id`] as string) ?? i}
                  onClick={() => setSelectedRow(r)}
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

      {totalPages != null && totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
          <Button
            variant="ghost"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * PAGE_SIZE >= (count ?? 0) || loading}
          >
            Next
          </Button>
        </div>
      )}

      {selectedRow && (
        <EntityDetailDrawer
          entity={entity}
          row={selectedRow}
          tenantSlug={tenantSlug ?? ''}
          onClose={() => setSelectedRow(null)}
          onMutated={() => { setSelectedRow(null); void load(); }}
          canDelete={canDelete}
        />
      )}

      {creating && (
        <EntityCreateDrawer
          entity={entity}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); void load(); }}
        />
      )}
    </HubLayout>
  );
}

// Entities that support archive/delete from the shell.
// Staff and operational entities are managed inside EQ Field.
const MANAGEABLE_ENTITIES = new Set(['customer', 'site', 'contact', 'asset']);

// Slide-out drawer showing the full row. Floating UI (not static),
// so per the design spec it CAN have a drop-shadow.
function EntityDetailDrawer({
  entity,
  row,
  tenantSlug,
  onClose,
  onMutated,
  canDelete,
}: {
  entity: string;
  row: Record<string, unknown>;
  tenantSlug: string;
  onClose: () => void;
  onMutated: () => void;
  canDelete: boolean;
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const canEdit = useCan('entity.edit');
  const view = ENTITY_VIEW[entity];
  const [isEditing, setIsEditing] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [open, setOpen] = useState(false);
  const rafRef = useRef<number | null>(null);

  // Trigger the slide-in on mount via a rAF so the initial transform is painted first.
  useEffect(() => {
    rafRef.current = requestAnimationFrame(() => setOpen(true));
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

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

  const startEditing = useCallback(() => {
    const initial: Record<string, string> = {};
    for (const col of (view?.columns ?? [])) {
      const v = row[col.key];
      initial[col.key] = v === null || v === undefined ? '' : String(v);
    }
    setEditFields(initial);
    setIsEditing(true);
    setActionErr(null);
  }, [row, view]);

  const handleSave = useCallback(async () => {
    const id = row[`${entity}_id`] as string;
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(editFields)) {
      if (v === 'true') fields[k] = true;
      else if (v === 'false') fields[k] = false;
      else if (v === '') fields[k] = null;
      else fields[k] = v;
    }
    setActionLoading('save');
    setActionErr(null);
    try {
      const res = await fetch('/.netlify/functions/entity-patch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, id, fields }),
      });
      const body = await res.json() as { ok: boolean; error?: string; detail?: string };
      if (!res.ok || !body.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
      setIsEditing(false);
      onMutated();
    } catch (e) {
      setActionErr((e as Error).message);
      setActionLoading(null);
    }
  }, [entity, row, editFields, onMutated]);

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
          background: 'rgba(0,0,0,0.3)',
          zIndex: 40,
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
          width: 'min(380px, 100vw)',
          background: 'white',
          borderLeft: '1px solid #E2E8F0',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 200ms ease',
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
                  color: '#64748B',
                }}
              >
                {entity}
              </span>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: 'var(--eq-ink, #1A1A2E)',
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
                color: '#64748B',
                lineHeight: 1,
                padding: '4px 6px',
                flexShrink: 0,
              }}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          {/* Management actions (customer / site / contact only) */}
          {isManageable && (
            <div style={{
              display: 'flex',
              gap: 8,
              paddingBottom: 16,
              marginBottom: 4,
              borderBottom: '1px solid #E2E8F0',
              flexWrap: 'wrap',
            }}>
              {canEdit && !isEditing && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={actionLoading !== null}
                  onClick={startEditing}
                >
                  Edit
                </Button>
              )}
              {isEditing && (
                <>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={actionLoading !== null}
                    onClick={() => void handleSave()}
                  >
                    {actionLoading === 'save' ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={actionLoading !== null}
                    onClick={() => setIsEditing(false)}
                  >
                    Cancel
                  </Button>
                </>
              )}
              {!isEditing && (isActive ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={actionLoading !== null}
                  onClick={() => void handleAction('archive')}
                >
                  {actionLoading === 'archive' ? 'Archiving…' : 'Archive'}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={actionLoading !== null}
                  onClick={() => void handleAction('unarchive')}
                >
                  {actionLoading === 'unarchive' ? 'Restoring…' : 'Restore'}
                </Button>
              ))}

              {!isEditing && canDelete && (
                confirmDelete ? (
                  <>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={actionLoading !== null}
                      onClick={() => void handleAction('delete')}
                    >
                      {actionLoading === 'delete' ? 'Deleting…' : 'Confirm delete'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={actionLoading !== null}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(true)}
                    style={{ color: '#c0392b' }}
                  >
                    Delete
                  </Button>
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

        {entity === 'asset' && <AssetDrawerExtras tenantSlug={tenantSlug} row={row} />}

        {isEditing ? (
          <div style={{ padding: '0 24px 24px', flex: 1 }}>
            {(view?.columns ?? []).map((col) => {
              const isBool = col.key === 'active';
              const isDate = col.key.endsWith('_date') || col.key.endsWith('_due');
              const isEmail = col.key === 'email';
              const isTel = col.key.includes('phone');
              return (
                <div key={col.key} style={{ marginBottom: 14 }}>
                  <label
                    htmlFor={`edit-${col.key}`}
                    style={{
                      display: 'block',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#64748B',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      marginBottom: 4,
                    }}
                  >
                    {col.label}
                  </label>
                  {isBool ? (
                    <select
                      id={`edit-${col.key}`}
                      value={editFields[col.key] ?? ''}
                      onChange={(e) => setEditFields((f) => ({ ...f, [col.key]: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        border: '1px solid var(--eq-border, #E2E8F0)',
                        borderRadius: 6,
                        fontSize: 13,
                        background: 'var(--eq-bg, #fff)',
                        color: 'var(--eq-ink, #1A1A2E)',
                      }}
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <input
                      id={`edit-${col.key}`}
                      type={isDate ? 'date' : isEmail ? 'email' : isTel ? 'tel' : 'text'}
                      value={editFields[col.key] ?? ''}
                      onChange={(e) => setEditFields((f) => ({ ...f, [col.key]: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        border: '1px solid var(--eq-border, #E2E8F0)',
                        borderRadius: 6,
                        fontSize: 13,
                        background: 'var(--eq-bg, #fff)',
                        color: 'var(--eq-ink, #1A1A2E)',
                        boxSizing: 'border-box',
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <dl style={{ margin: 0, padding: '0 24px 24px', flex: 1 }}>
            {sortedEntries.map(([key, value]) => (
              <div
                key={key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: '1px solid #E2E8F0',
                  alignItems: 'baseline',
                }}
              >
                <dt
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#64748B',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {key.replace(/_/g, ' ')}
                </dt>
                <dd
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: 'var(--eq-ink, #1A1A2E)',
                    wordBreak: 'break-word',
                    fontFamily:
                      value === null || typeof value === 'object'
                        ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
                        : 'inherit',
                  }}
                >
                  {value === null || value === undefined ? (
                    <span style={{ color: '#64748B' }}>—</span>
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
        )}
      </aside>
    </>
  );
}

// Per-entity create form fields with labels, input type, and required flag.
const CREATE_FORM_META: Record<string, { key: string; label: string; type: string; required: boolean }[]> = {
  customer: [
    { key: 'company_name', label: 'Company name', type: 'text',  required: true  },
    { key: 'email',        label: 'Email',         type: 'email', required: false },
    { key: 'primary_phone',label: 'Phone',         type: 'tel',   required: false },
    { key: 'state',        label: 'State',         type: 'text',  required: false },
  ],
  contact: [
    { key: 'first_name',   label: 'First name',    type: 'text',  required: true  },
    { key: 'last_name',    label: 'Last name',     type: 'text',  required: true  },
    { key: 'email',        label: 'Email',         type: 'email', required: false },
    { key: 'mobile_phone', label: 'Mobile',        type: 'tel',   required: false },
    { key: 'position',     label: 'Position',      type: 'text',  required: false },
  ],
  site: [
    { key: 'name',         label: 'Site name',     type: 'text',  required: true  },
    { key: 'code',         label: 'Code',          type: 'text',  required: false },
    { key: 'suburb',       label: 'Suburb',        type: 'text',  required: false },
    { key: 'state',        label: 'State',         type: 'text',  required: false },
    { key: 'site_type',    label: 'Type',          type: 'text',  required: false },
  ],
};

function EntityCreateDrawer({
  entity,
  onClose,
  onCreated,
}: {
  entity: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const fields = CREATE_FORM_META[entity] ?? [];
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, ''])),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(() => setOpen(true));
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const fieldPayload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v.trim() !== '') fieldPayload[k] = v.trim();
      }
      const res = await fetch('/.netlify/functions/entity-insert', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, fields: fieldPayload }),
      });
      const body = await res.json() as { ok: boolean; error?: string; detail?: string };
      if (!res.ok || !body.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }, [entity, values, onCreated]);

  const label = ENTITY_VIEW[entity]?.label.toLowerCase().replace(/s$/, '') ?? entity;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40 }} />
      <aside
        role="dialog"
        aria-label={`New ${label}`}
        style={{
          position: 'fixed', right: 0, top: 0, height: '100vh',
          width: 'min(380px, 100vw)', background: 'white',
          borderLeft: '1px solid #E2E8F0', zIndex: 50,
          display: 'flex', flexDirection: 'column', overflowY: 'auto',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 200ms ease',
        }}
      >
        <div style={{ padding: '20px 24px 0' }}>
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748B' }}>
                new
              </span>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--eq-ink, #1A1A2E)', marginTop: 2 }}>
                {label.charAt(0).toUpperCase() + label.slice(1)}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748B', padding: '4px 6px' }}>
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          {err && (
            <div style={{ background: '#fdf2f2', border: '1px solid #c0392b', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#c0392b', marginBottom: 16 }}>
              {err}
            </div>
          )}
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} style={{ padding: '0 24px 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {fields.map((f) => (
            <div key={f.key}>
              <label htmlFor={`create-${f.key}`} style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                {f.label}{f.required && <span style={{ color: '#c0392b', marginLeft: 2 }}>*</span>}
              </label>
              <input
                id={`create-${f.key}`}
                type={f.type}
                required={f.required}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                style={{
                  width: '100%', padding: '7px 10px',
                  border: '1px solid var(--eq-border, #E2E8F0)', borderRadius: 6,
                  fontSize: 13, background: 'var(--eq-bg, #fff)', color: 'var(--eq-ink, #1A1A2E)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? 'Saving…' : `Add ${label}`}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
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
