// StaffPage — Staff list with licence summary + Training Matrix view
// Route: /:tenant/staff

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Table, type TableColumn } from '@eq-solutions/ui';
import { archiveStaff } from '../lib/entityActions';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface StaffRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  employment_type: string | null;
  trade: string | null;
  level: string | null;
  active: boolean | null;
}

interface LicenceRow {
  id: string;
  staff_id: string;
  licence_type: string | null;
  licence_number: string | null;
  expiry_date: string | null;
  no_expiry: boolean | null;
}

interface PendingWorker {
  application_id: string;
  worker_user_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  licence_count: number;
  requested_at: string;
}

type LicStatus = 'current' | 'expiring' | 'expired' | 'ne';
type View = 'list' | 'matrix';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const AV_COLOURS = ['#3DA8D8','#8B5CF6','#F59E0B','#10B981','#EF4444','#6366F1','#EC4899','#14B8A6'];

function avatarColour(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AV_COLOURS[h % AV_COLOURS.length];
}
function initials(first: string | null, last: string | null): string {
  return ((first?.[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '?';
}
function fullName(s: StaffRow): string {
  return [s.first_name, s.last_name].filter(Boolean).join(' ') || 'Unnamed';
}
function licStatus(l: LicenceRow): LicStatus {
  if (l.no_expiry || !l.expiry_date) return 'ne';
  const diff = (new Date(l.expiry_date).getTime() - Date.now()) / 86400000;
  if (diff < 0) return 'expired';
  if (diff < 90) return 'expiring';
  return 'current';
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}
function relativeTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const MC: Record<LicStatus, React.CSSProperties> = {
  current:  { background: '#DCFCE7', color: '#15803D' },
  ne:       { background: '#EFF6FF', color: '#1D4ED8' },
  expiring: { background: '#FEF3C7', color: '#B45309' },
  expired:  { background: '#FEE2E2', color: '#B91C1C' },
};

// ─── API ─────────────────────────────────────────────────────────────────────

interface EntityResp {
  ok: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
}

async function fetchEntity(entity: string, extra: Record<string, string> = {}): Promise<EntityResp> {
  const qs = new URLSearchParams({ entity, limit: '1000', ...extra });
  const res = await fetch(`/.netlify/functions/entity-rows?${qs}`, { credentials: 'include' });
  return res.json() as Promise<EntityResp>;
}

function mapStaff(row: Record<string, unknown>): StaffRow {
  return {
    id:               String(row['staff_id'] ?? row['id'] ?? ''),
    first_name:       (row['first_name']      as string  | null) ?? null,
    last_name:        (row['last_name']        as string  | null) ?? null,
    email:            (row['email']            as string  | null) ?? null,
    employment_type:  (row['employment_type']  as string  | null) ?? null,
    trade:            (row['trade']            as string  | null) ?? null,
    level:            (row['level']            as string  | null) ?? null,
    active:           (row['active']           as boolean | null) ?? null,
  };
}
function mapLicence(row: Record<string, unknown>): LicenceRow {
  return {
    id:            String(row['licence_id'] ?? row['id'] ?? ''),
    staff_id:      String(row['staff_id'] ?? ''),
    licence_type:  (row['licence_type']   as string  | null) ?? null,
    licence_number:(row['licence_number'] as string  | null) ?? null,
    expiry_date:   (row['expiry_date']    as string  | null) ?? null,
    no_expiry:     (row['no_expiry']      as boolean | null) ?? null,
  };
}

// ─── HOOKS ───────────────────────────────────────────────────────────────────

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', fn, { passive: true });
    return () => window.removeEventListener('resize', fn);
  }, []);
  return mobile;
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export function StaffPage() {
  const [staff,      setStaff]      = useState<StaffRow[]>([]);
  const [licences,   setLicences]   = useState<LicenceRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [licLoading, setLicLoading] = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [view,       setView]       = useState<View>('list');
  const [selId,      setSelId]      = useState<string | null>(null);
  const [reload,     setReload]     = useState(0);
  const [pending,    setPending]    = useState<PendingWorker[]>([]);
  const [tipId,      setTipId]      = useState<string | null>(null);
  const [tipRect,    setTipRect]    = useState<DOMRect | null>(null);
  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null);
  const tipTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMobile = useIsMobile();

  const showToast = useCallback((msg: string, ok = true) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, ok });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // Staff fetch — active only, all records, re-runs after mutations
  useEffect(() => {
    setLoading(true);
    fetchEntity('staff', { active: 'true' })
      .then((r) => {
        if (!r.ok) { setError(r.error ?? 'Failed to load staff'); return; }
        setStaff((r.rows ?? []).map(mapStaff));
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [reload]);

  // Pending connection requests
  useEffect(() => {
    fetch('/.netlify/functions/staff-pending-connections', { credentials: 'include' })
      .then((r) => r.json() as Promise<{ pending?: PendingWorker[] }>)
      .then((r) => { if (r.pending) setPending(r.pending); })
      .catch(() => {});
  }, [reload]);

  // Licences fetch — reads canonical (public.licences) for connected workers
  useEffect(() => {
    setLicLoading(true);
    fetch('/.netlify/functions/staff-canonical-licences', { credentials: 'include' })
      .then((r) => r.json() as Promise<{ licences?: Record<string, unknown>[] }>)
      .then((r) => { if (r.licences) setLicences(r.licences.map(mapLicence)); })
      .catch(() => {})
      .finally(() => setLicLoading(false));
  }, []);

  // A-Z sort by full name
  const sortedStaff = useMemo(
    () => [...staff].sort((a, b) => fullName(a).localeCompare(fullName(b))),
    [staff],
  );

  // Sidebar records — warn + count badge when connection requests are waiting
  const sidebarRecords = useMemo(
    () => defaultSidebarRecords().map((r) =>
      r.key === 'staff'
        ? { ...r, count: pending.length > 0 ? pending.length : null, warn: pending.length > 0 }
        : r,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending.length],
  );

  // Licences by staff_id
  const licByStaff = useMemo(() => {
    const m = new Map<string, LicenceRow[]>();
    for (const l of licences) {
      if (!l.staff_id) continue;
      const arr = m.get(l.staff_id) ?? [];
      arr.push(l);
      m.set(l.staff_id, arr);
    }
    return m;
  }, [licences]);

  // Unique licence types (for matrix columns, sorted)
  const licTypes = useMemo(() => {
    const set = new Set<string>();
    for (const l of licences) { if (l.licence_type) set.add(l.licence_type); }
    return [...set].sort();
  }, [licences]);

  const selectRow = useCallback((id: string) => {
    setSelId((prev) => (prev === id ? null : id));
  }, []);

  const handleMutated = useCallback(() => setReload((n) => n + 1), []);

  const handleApprove = useCallback(async (applicationId: string) => {
    const worker = pending.find((p) => p.application_id === applicationId);
    const name = [worker?.first_name, worker?.last_name].filter(Boolean).join(' ') || 'Worker';
    const res = await fetch('/.netlify/functions/cards-approve-staff', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ application_id: applicationId, action: 'approve' }),
    });
    if (res.ok) {
      setPending((p) => p.filter((x) => x.application_id !== applicationId));
      handleMutated();
      showToast(`${name} added to roster`);
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      console.error('[staff] approve failed', res.status, err.error);
      showToast('Approval failed — try again', false);
    }
  }, [handleMutated, pending, showToast]);

  const handleDecline = useCallback(async (applicationId: string) => {
    const worker = pending.find((p) => p.application_id === applicationId);
    const name = [worker?.first_name, worker?.last_name].filter(Boolean).join(' ') || 'Worker';
    const res = await fetch('/.netlify/functions/cards-approve-staff', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ application_id: applicationId, action: 'reject' }),
    });
    if (res.ok) {
      setPending((p) => p.filter((x) => x.application_id !== applicationId));
      showToast(`${name} declined`);
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      console.error('[staff] decline failed', res.status, err.error);
      showToast('Failed to decline — try again', false);
    }
  }, [pending, showToast]);

  const showTip = useCallback((staffId: string, rect: DOMRect) => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    setTipId(staffId);
    setTipRect(rect);
  }, []);
  const hideTip = useCallback(() => {
    tipTimer.current = setTimeout(() => setTipId(null), 100);
  }, []);

  const selStaff = selId ? sortedStaff.find((s) => s.id === selId) ?? null : null;

  return (
    <HubLayout sidebarRecords={sidebarRecords} fullWidth>
      <div style={s.page}>

        {/* Zone A — header */}
        <div style={{ ...s.ph, flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'flex-end', padding: isMobile ? '12px 16px 0' : '16px 24px 0', gap: isMobile ? 8 : 0 }}>
          <div>
            <h1 style={s.title}>Staff</h1>
            <p style={s.subtitle}>
              {loading ? 'Loading…' : `${sortedStaff.length} ${sortedStaff.length === 1 ? 'person' : 'people'}`}
            </p>
          </div>
          <a
            href="/.netlify/functions/cards-export-licences"
            download
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px solid #E2E8F0', background: 'white', color: '#475569', fontSize: 11, fontWeight: 700, textDecoration: 'none', fontFamily: 'inherit', alignSelf: isMobile ? 'flex-start' : 'flex-end', marginBottom: isMobile ? 0 : 4 }}
          >
            Compliance pack
          </a>
        </div>

        {/* Pending connections */}
        {pending.length > 0 && (
          <PendingSection
            workers={pending}
            onApprove={handleApprove}
            onDecline={handleDecline}
            isMobile={isMobile}
          />
        )}

        {/* Zone B — view toggle */}
        <div style={s.vt}>
          <div style={s.viewToggle}>
            <button
              type="button"
              style={{ ...s.vtBtn, ...(view === 'list' ? s.vtBtnOn : {}) }}
              onClick={() => setView('list')}
            >
              List
            </button>
            <button
              type="button"
              style={{ ...s.vtBtn, ...(view === 'matrix' ? s.vtBtnOn : {}) }}
              onClick={() => setView('matrix')}
            >
              Training Matrix
            </button>
          </div>
        </div>

        {/* Content */}
        {error ? (
          <div style={s.empty}>
            <p style={{ fontWeight: 700, color: '#EF4444' }}>{error}</p>
          </div>
        ) : view === 'list' ? (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {isMobile ? (
              <MobileStaffList
                rows={sortedStaff}
                loading={loading}
                selId={selId}
                licByStaff={licByStaff}
                onSelect={selectRow}
              />
            ) : (
              <>
                <StaffList
                  rows={sortedStaff}
                  loading={loading}
                  selId={selId}
                  licByStaff={licByStaff}
                  onSelect={selectRow}
                  onShowTip={showTip}
                  onHideTip={hideTip}
                  onMutated={handleMutated}
                />
                <SplitPanel
                  staff={selStaff}
                  lics={selStaff ? (licByStaff.get(selStaff.id) ?? []) : []}
                  onClose={() => setSelId(null)}
                />
              </>
            )}
          </div>
        ) : (
          <MatrixView
            rows={sortedStaff}
            loading={loading || licLoading}
            licByStaff={licByStaff}
            licTypes={licTypes}
          />
        )}

        {/* Mobile bottom sheet — shown instead of split panel */}
        {isMobile && selStaff && (
          <MobileSheet
            staff={selStaff}
            lics={licByStaff.get(selStaff.id) ?? []}
            onClose={() => setSelId(null)}
          />
        )}

        {/* Tooltip — desktop only (hover doesn't exist on touch) */}
        {!isMobile && tipId && tipRect && (
          <LicTip lics={licByStaff.get(tipId) ?? []} rect={tipRect} />
        )}

        {/* Toast */}
        {toast && (
          <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: toast.ok ? '#1A1A2E' : '#EF4444', color: 'white', padding: '10px 18px', borderRadius: 9, fontSize: 13, fontWeight: 600, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,.18)' }}>
            {toast.msg}
          </div>
        )}
      </div>
    </HubLayout>
  );
}

// ─── PENDING CONNECTIONS SECTION ─────────────────────────────────────────────

function PendingSection({
  workers,
  onApprove,
  onDecline,
  isMobile,
}: {
  workers: PendingWorker[];
  onApprove: (id: string) => Promise<void>;
  onDecline: (id: string) => Promise<void>;
  isMobile?: boolean;
}) {
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const isBusy = (id: string) => busy.has(id);

  const act = async (id: string, fn: (id: string) => Promise<void>) => {
    setBusy((prev) => new Set(prev).add(id));
    try { await fn(id); } finally { setBusy((prev) => { const s = new Set(prev); s.delete(id); return s; }); }
  };

  return (
    <div style={{ padding: isMobile ? '8px 12px' : '8px 24px', borderBottom: '1px solid #F1F5F9', background: '#FAFBFD', flexShrink: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#3DA8D8', marginBottom: 8 }}>
        {workers.length} connection {workers.length === 1 ? 'request' : 'requests'} pending
      </div>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', flexWrap: isMobile ? undefined : 'wrap', gap: 8 }}>
        {workers.map((w) => {
          const name = [w.first_name, w.last_name].filter(Boolean).join(' ') || w.phone || 'Unknown';
          const busy = isBusy(w.application_id);
          return (
            <div
              key={w.application_id}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px 6px 8px', border: '1px solid #BFDBFE', borderRadius: 8, background: 'white', fontSize: 12 }}
            >
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#3DA8D8', color: 'white', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {initials(w.first_name, w.last_name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: '#1A1A2E', whiteSpace: 'nowrap' }}>{name}</div>
                <div style={{ fontSize: 10, color: '#64748B' }}>
                  {w.licence_count > 0 ? `${w.licence_count} licence${w.licence_count === 1 ? '' : 's'} ready` : 'No licences yet'}
                  {' · '}
                  {relativeTime(w.requested_at)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 5, marginLeft: 4, flexShrink: 0 }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { void act(w.application_id, onApprove); }}
                  style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: busy ? '#94A3B8' : '#3DA8D8', color: 'white', fontSize: 11, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', minWidth: 82, transition: 'background .15s' }}
                >
                  {busy ? 'Adding…' : 'Add to roster'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { void act(w.application_id, onDecline); }}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E2E8F0', background: 'white', color: busy ? '#CBD5E1' : '#64748B', fontSize: 11, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', minWidth: 68, transition: 'color .15s' }}
                >
                  {busy ? 'Declining…' : 'Decline'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── STAFF LIST ───────────────────────────────────────────────────────────────

interface ListProps {
  rows: StaffRow[];
  loading: boolean;
  selId: string | null;
  licByStaff: Map<string, LicenceRow[]>;
  onSelect: (id: string) => void;
  onShowTip: (id: string, rect: DOMRect) => void;
  onHideTip: () => void;
  onMutated: () => void;
}

function StaffList({ rows, loading, selId, licByStaff, onSelect, onShowTip, onHideTip, onMutated }: ListProps) {
  const staffCols = useMemo<TableColumn<StaffRow>[]>(() => [
    {
      key: 'name',
      header: 'Name',
      sortAccessor: (row) => fullName(row),
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: avatarColour(row.id), color: 'white', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {initials(row.first_name, row.last_name)}
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#1A1A2E', fontSize: 13, lineHeight: 1.2 }}>{fullName(row)}</div>
            {row.email && <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1 }}>{row.email}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortAccessor: (row) => row.employment_type,
      render: (row) => <span style={{ color: '#64748B' }}>{row.employment_type ?? '—'}</span>,
    },
    {
      key: 'licences',
      header: 'Licences & Training',
      render: (row) => {
        const lics = licByStaff.get(row.id) ?? [];
        return (
          <span
            onMouseEnter={(e) => onShowTip(row.id, (e.currentTarget as HTMLElement).getBoundingClientRect())}
            onMouseLeave={onHideTip}
          >
            <LicChips lics={lics} />
          </span>
        );
      },
    },
  ], [licByStaff, onShowTip, onHideTip]);

  const worstStatus = useCallback((row: StaffRow): { color: string } | null => {
    const lics = licByStaff.get(row.id) ?? [];
    if (lics.some((l) => licStatus(l) === 'expired'))  return { color: 'var(--eq-error-text)'   };
    if (lics.some((l) => licStatus(l) === 'expiring')) return { color: 'var(--eq-warning-text)' };
    return null;
  }, [licByStaff]);

  return (
    <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
      <Table
        columns={staffCols}
        rows={rows}
        getRowId={(row) => row.id}
        slicers={[
          { key: 'all',      label: 'All' },
          { key: 'expiring', label: 'Has expiring', filter: (row) => (licByStaff.get(row.id) ?? []).some((l) => licStatus(l) === 'expiring'), dot: 'var(--eq-warning-text)' },
          { key: 'gaps',     label: 'Has gaps',     filter: (row) => (licByStaff.get(row.id) ?? []).some((l) => { const st = licStatus(l); return st === 'expired' || st === 'expiring'; }), dot: 'var(--eq-error-text)' },
        ]}
        globalSearch={{ placeholder: 'Search staff…' }}
        columnToggle
        exportable={{ filename: 'staff.csv' }}
        rowIndicator={worstStatus}
        loading={loading}
        emptyMessage="No results — try adjusting your search or filters"
        onRowClick={(row) => onSelect(row.id)}
        rowStyle={(row) => row.id === selId ? { background: '#e1f1fb' } : undefined}
        pagination={{ pageSize: 25 }}
        summary={(v, t) => <>Showing <strong>{v}</strong> of <strong>{t.toLocaleString()}</strong></>}
        onArchive={async (rows) => { await archiveStaff(rows.map((r) => r.id)); onMutated(); }}
        archiveConfirm={{ description: (n) => `${n} staff member${n === 1 ? '' : 's'} will be set to inactive and removed from the active roster.` }}
        onActionError={(_action, err) => console.error('[staff] bulk archive failed', err)}
      />
    </div>
  );
}

function LicChips({ lics }: { lics: LicenceRow[] }) {
  if (lics.length === 0) return <span style={{ color: '#CBD5E1', fontSize: 11 }}>None recorded</span>;
  return (
    <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 3 }}>
      {lics.map((l) => {
        const st = licStatus(l);
        const abbr = (l.licence_type ?? '?').split(' ').map((w) => w[0]).join('').slice(0, 4).toUpperCase();
        return (
          <span
            key={l.id}
            style={{ ...MC[st], padding: '1px 5px', borderRadius: 4, fontSize: 9, fontWeight: 800, letterSpacing: '.03em', fontFamily: 'monospace', lineHeight: 1.6 }}
          >
            {abbr}
          </span>
        );
      })}
    </div>
  );
}

// ─── MOBILE STAFF LIST ───────────────────────────────────────────────────────

function MobileStaffList({
  rows, loading, selId, licByStaff, onSelect,
}: {
  rows: StaffRow[];
  loading: boolean;
  selId: string | null;
  licByStaff: Map<string, LicenceRow[]>;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => fullName(r).toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  if (loading) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>Loading…</div>;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
        <input
          type="search"
          placeholder="Search staff…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: '#F8FAFC' }}
        />
      </div>
      <div style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
        {filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No results</div>
        )}
        {filtered.map((row) => {
          const lics = licByStaff.get(row.id) ?? [];
          const sel = row.id === selId;
          const worst = lics.some((l) => licStatus(l) === 'expired')
            ? '#EF4444'
            : lics.some((l) => licStatus(l) === 'expiring')
            ? '#F59E0B'
            : null;
          return (
            <div
              key={row.id}
              onClick={() => onSelect(row.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #F1F5F9', background: sel ? '#EAF5FB' : 'white', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', borderLeft: worst ? `3px solid ${worst}` : '3px solid transparent' } as React.CSSProperties}
            >
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: avatarColour(row.id), color: 'white', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {initials(row.first_name, row.last_name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1A2E', lineHeight: 1.2 }}>{fullName(row)}</div>
                {row.employment_type && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{row.employment_type}</div>}
                {lics.length > 0 && <div style={{ marginTop: 5 }}><LicChips lics={lics} /></div>}
                {lics.length === 0 && <div style={{ marginTop: 3, fontSize: 11, color: '#CBD5E1' }}>No licences recorded</div>}
              </div>
              <span style={{ color: '#CBD5E1', fontSize: 20, fontWeight: 300, flexShrink: 0 }}>›</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MOBILE BOTTOM SHEET ─────────────────────────────────────────────────────

function MobileSheet({
  staff, lics, onClose,
}: {
  staff: StaffRow;
  lics: LicenceRow[];
  onClose: () => void;
}) {
  const groupedLics = useMemo(() => {
    const cur: LicenceRow[] = [], exp: LicenceRow[] = [], red: LicenceRow[] = [];
    for (const l of lics) {
      const st = licStatus(l);
      if (st === 'current' || st === 'ne') cur.push(l);
      else if (st === 'expiring') exp.push(l);
      else red.push(l);
    }
    return { cur, exp, red };
  }, [lics]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)' }}
      onClick={onClose}
    >
      <div
        style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'white', borderRadius: '16px 16px 0 0', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'center', padding: '10px 0 2px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#E2E8F0' }} />
        </div>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px 12px', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: avatarColour(staff.id), color: 'white', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {initials(staff.first_name, staff.last_name)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#1A1A2E' }}>{fullName(staff)}</div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 1 }}>{[staff.trade, staff.employment_type].filter(Boolean).join(' · ')}</div>
          </div>
          <button type="button" onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={14} />
          </button>
        </div>
        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 40px', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          {staff.email && <PField label="Email" value={staff.email} />}
          {staff.level && <PField label="Level" value={staff.level} />}
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#94A3B8', padding: '12px 0 6px' }}>
            Licences &amp; Training ({lics.length} held)
          </div>
          {lics.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94A3B8', fontStyle: 'italic' }}>No licences recorded</p>
          ) : (
            <>
              {groupedLics.cur.length > 0 && <LicGroup label="Active" colour="#22C55E" lics={groupedLics.cur} />}
              {groupedLics.exp.length > 0 && <LicGroup label="Expiring soon" colour="#F59E0B" lics={groupedLics.exp} />}
              {groupedLics.red.length > 0 && <LicGroup label="Expired" colour="#EF4444" lics={groupedLics.red} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MATRIX VIEW ─────────────────────────────────────────────────────────────

interface MatrixProps {
  rows: StaffRow[];
  loading: boolean;
  licByStaff: Map<string, LicenceRow[]>;
  licTypes: string[];
}

function MatrixView({ rows, loading, licByStaff, licTypes }: MatrixProps) {
  if (loading) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>Loading matrix…</div>;
  }
  if (!licTypes.length) {
    return (
      <div style={s.empty}>
        <strong style={{ color: '#475569' }}>No licence data yet</strong>
        <span>
          Workers need to connect to your org via EQ Cards and upload their licences.
          Once connected, their credentials appear here automatically.
        </span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', whiteSpace: 'nowrap' }}>
          <thead>
            <tr>
              <th style={{ ...s.mth, position: 'sticky', left: 0, zIndex: 3, minWidth: 180, textAlign: 'left', paddingLeft: 16, background: 'white', borderRight: '1px solid #E2E8F0' }}>
                Name
              </th>
              {licTypes.map((t) => (
                <th key={t} style={s.mth} title={t}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontSize: 9, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '.04em', lineHeight: 1.2 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#1A1A2E' }}>
                      {t.split(' ').map((w) => w[0]).join('').slice(0, 4).toUpperCase()}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const lics = licByStaff.get(row.id) ?? [];
              const licByType = new Map(lics.map((l) => [l.licence_type ?? '', l]));
              return (
                <tr key={row.id}>
                  <td style={{ ...s.mtd, position: 'sticky', left: 0, zIndex: 1, background: 'white', borderRight: '1px solid #E2E8F0', minWidth: 180, padding: '6px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: avatarColour(row.id), color: 'white', fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {initials(row.first_name, row.last_name)}
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1A1A2E' }}>{fullName(row)}</div>
                        <div style={{ fontSize: 10, color: '#94A3B8' }}>{row.trade ?? row.employment_type ?? ''}</div>
                      </div>
                    </div>
                  </td>
                  {licTypes.map((t) => {
                    const l = licByType.get(t);
                    if (!l) {
                      return (
                        <td key={t} style={s.mtd}>
                          <div style={{ ...s.mc, background: '#F8FAFC', color: '#D1D5DB', fontSize: 14, fontWeight: 400 }}>—</div>
                        </td>
                      );
                    }
                    const st = licStatus(l);
                    const txt = (st === 'ne' || !l.expiry_date) ? '✓' : fmtDateShort(l.expiry_date);
                    return (
                      <td key={t} style={s.mtd} title={`${t}: ${l.expiry_date ? fmtDate(l.expiry_date) : 'No expiry'}`}>
                        <div style={{ ...s.mc, ...MC[st] }}>{txt}</div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 24px', borderTop: '1px solid #E2E8F0', background: 'white', flexShrink: 0, fontSize: 11 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#64748B', marginRight: 4 }}>KEY:</span>
        {[
          { bg: '#DCFCE7', border: '#BBF7D0', label: 'Current' },
          { bg: '#EFF6FF', border: '#BFDBFE', label: 'No expiry' },
          { bg: '#FEF3C7', border: '#FDE68A', label: 'Expiring <90 days' },
          { bg: '#FEE2E2', border: '#FECACA', label: 'Expired' },
          { bg: '#F8FAFC', border: '#E2E8F0', label: 'Not held' },
        ].map(({ bg, border, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#64748B', fontWeight: 600 }}>
            <div style={{ width: 16, height: 14, borderRadius: 3, background: bg, border: `1px solid ${border}` }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SPLIT PANEL ─────────────────────────────────────────────────────────────

function SplitPanel({ staff, lics, onClose }: { staff: StaffRow | null; lics: LicenceRow[]; onClose: () => void }) {
  const open = staff !== null;
  const groupedLics = useMemo(() => {
    const cur: LicenceRow[] = [], exp: LicenceRow[] = [], red: LicenceRow[] = [];
    for (const l of lics) {
      const st = licStatus(l);
      if (st === 'current' || st === 'ne') cur.push(l);
      else if (st === 'expiring') exp.push(l);
      else red.push(l);
    }
    return { cur, exp, red };
  }, [lics]);

  return (
    <div style={{ ...s.pw, ...(open ? s.pwOpen : {}) }}>
      <div style={s.pi}>
        {staff && (
          <>
            <div style={s.phead}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarColour(staff.id), color: 'white', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {initials(staff.first_name, staff.last_name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.pname}>{fullName(staff)}</div>
                <div style={s.prole}>{[staff.trade, staff.employment_type].filter(Boolean).join(' · ')}</div>
              </div>
              <button type="button" style={s.pcls} onClick={onClose} aria-label="Close panel">
                <X size={14} />
              </button>
            </div>
            <div style={s.pbody}>
              <div style={s.psec}>Contact</div>
              {staff.email && <PField label="Email" value={staff.email} />}
              {staff.level && <PField label="Level" value={staff.level} />}

              <div style={s.psec}>
                Licences &amp; Training ({lics.length} held)
              </div>

              {lics.length === 0 ? (
                <p style={{ fontSize: 11, color: '#94A3B8', fontStyle: 'italic' }}>No licences recorded</p>
              ) : (
                <>
                  {groupedLics.cur.length > 0 && (
                    <LicGroup label="Active" colour="#22C55E" lics={groupedLics.cur} />
                  )}
                  {groupedLics.exp.length > 0 && (
                    <LicGroup label="Expiring soon" colour="#F59E0B" lics={groupedLics.exp} />
                  )}
                  {groupedLics.red.length > 0 && (
                    <LicGroup label="Expired" colour="#EF4444" lics={groupedLics.red} />
                  )}
                </>
              )}
            </div>
            <div style={s.pfoot}>
              <button type="button" style={{ ...s.btnPrimary, flex: 1, justifyContent: 'center' }}>Edit record</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#1A1A2E' }}>{value}</div>
    </div>
  );
}

function LicGroup({ label, colour, lics }: { label: string; colour: string; lics: LicenceRow[] }) {
  return (
    <>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: colour, marginTop: 10, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, display: 'inline-block' }} />
        {label}
      </div>
      {lics.map((l) => {
        const st = licStatus(l);
        const expText = (l.no_expiry || !l.expiry_date)
          ? 'No expiry'
          : st === 'expiring'
          ? `Expires ${fmtDate(l.expiry_date)}`
          : st === 'expired'
          ? `Expired ${fmtDate(l.expiry_date)}`
          : `Expires ${fmtDate(l.expiry_date)}`;
        const expColour = st === 'expiring' ? '#B45309' : st === 'expired' ? '#B91C1C' : '#94A3B8';
        return (
          <div key={l.id} style={s.licRow}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#1A1A2E', width: 40, flexShrink: 0 }}>
              {(l.licence_type ?? '').split(' ').map((w) => w[0]).join('').slice(0, 4).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {l.licence_type ?? 'Unknown'}
              </div>
              <div style={{ fontSize: 10, color: expColour, marginTop: 1 }}>{expText}</div>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ─── LICENCE TOOLTIP ─────────────────────────────────────────────────────────

function LicTip({ lics, rect }: { lics: LicenceRow[]; rect: DOMRect }) {
  const cur = lics.filter((l) => { const st = licStatus(l); return st === 'current' || st === 'ne'; });
  const exp = lics.filter((l) => licStatus(l) === 'expiring');
  const red = lics.filter((l) => licStatus(l) === 'expired');

  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, above: true });

  useEffect(() => {
    const tipH = tipRef.current?.offsetHeight ?? 280;
    const above = rect.top - tipH - 8 > 0;
    const top = above ? rect.top - 8 : rect.bottom + 8;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 310));
    setPos({ top, left, above });
  }, [rect]);

  return (
    <div
      ref={tipRef}
      style={{
        position: 'fixed',
        zIndex: 9999,
        top: pos.top,
        left: pos.left,
        transform: pos.above ? 'translateY(-100%)' : 'none',
        background: '#1A1A2E',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 10,
        padding: '12px 14px',
        minWidth: 240,
        maxWidth: 300,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        pointerEvents: 'none',
      }}
    >
      {lics.length === 0 ? (
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>No licences recorded</span>
      ) : (
        <>
          {cur.length > 0 && <TipGroup label="Active" colour="#22C55E" textColour="#4ADE80" lics={cur} />}
          {exp.length > 0 && <TipGroup label="Expiring soon" colour="#F59E0B" textColour="#FCD34D" lics={exp} />}
          {red.length > 0 && <TipGroup label="Expired" colour="#EF4444" textColour="#F87171" lics={red} />}
        </>
      )}
    </div>
  );
}

function TipGroup({ label, colour, textColour, lics }: { label: string; colour: string; textColour: string; lics: LicenceRow[] }) {
  return (
    <>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 5, marginTop: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, flexShrink: 0, display: 'inline-block' }} />
        <span style={{ color: textColour }}>{label}</span>
        <span style={{ color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' }}>{lics.length}</span>
      </div>
      {lics.map((l) => (
        <div key={l.id} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: '2px 0' }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.9)', flexShrink: 0, width: 40 }}>
            {(l.licence_type ?? '').split(' ').map((w) => w[0]).join('').slice(0, 4).toUpperCase()}
          </span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {l.licence_type ?? 'Unknown'}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, flexShrink: 0, color: licStatus(l) === 'ne' ? '#93C5FD' : licStatus(l) === 'expiring' ? '#FCD34D' : licStatus(l) === 'expired' ? '#F87171' : '#4ADE80' }}>
            {(l.no_expiry || !l.expiry_date) ? 'No expiry' : fmtDateShort(l.expiry_date)}
          </span>
        </div>
      ))}
    </>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page:      { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', fontFamily: 'inherit' },
  ph:        { padding: '16px 24px 0', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexShrink: 0 },
  title:     { fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: '#1A1A2E' },
  subtitle:  { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  vt:        { padding: '9px 24px', display: 'flex', alignItems: 'center', background: 'white', borderBottom: '1px solid #F1F5F9', flexShrink: 0 },
  viewToggle:{ display: 'inline-flex', border: '1px solid #E2E8F0', borderRadius: 7, overflow: 'hidden', background: 'white' },
  vtBtn:     { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none', background: 'transparent', color: '#64748B', fontFamily: 'inherit', borderRight: '1px solid #E2E8F0' },
  vtBtnOn:   { background: '#F1F5F9', color: '#1A1A2E' },
  empty:     { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#94A3B8', textAlign: 'center' },
  mth:       { position: 'sticky', top: 0, zIndex: 2, background: 'white', borderBottom: '2px solid #E2E8F0', width: 44, textAlign: 'center', padding: '6px 2px' },
  mtd:       { width: 44, height: 32, textAlign: 'center', verticalAlign: 'middle', padding: '0 2px', borderBottom: '1px solid #F1F5F9' },
  mc:        { display: 'flex', alignItems: 'center', justifyContent: 'center', height: 26, borderRadius: 5, fontSize: 9, fontWeight: 800, fontFamily: 'monospace', margin: '0 2px' },
  pw:        { width: 0, flexShrink: 0, overflow: 'hidden', transition: 'width .22s cubic-bezier(.4,0,.2,1)', borderLeft: '0px solid #E2E8F0', background: 'white' },
  pwOpen:    { width: 320, borderLeftWidth: 1 },
  pi:        { width: 320, height: '100%', display: 'flex', flexDirection: 'column' },
  phead:     { padding: '14px 16px 12px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'flex-start', gap: 10, flexShrink: 0 },
  pname:     { fontSize: 14, fontWeight: 800, color: '#1A1A2E', lineHeight: 1.2 },
  prole:     { fontSize: 11, color: '#64748B', marginTop: 2 },
  pcls:      { width: 26, height: 26, borderRadius: 6, border: '1px solid #E2E8F0', background: 'white', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  pbody:     { flex: 1, overflowY: 'auto', padding: '14px 16px' },
  psec:      { fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#94A3B8', padding: '12px 0 6px', marginTop: 0 },
  pfoot:     { padding: '10px 16px 14px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 8, flexShrink: 0 },
  licRow:    { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, border: '1px solid #E2E8F0', marginBottom: 5, background: '#FAFAFA' },
  btnPrimary:{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: 'none', background: '#3DA8D8', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
};
