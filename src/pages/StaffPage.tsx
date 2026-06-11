// StaffPage — Staff list with licence summary + Training Matrix view
// Route: /:tenant/staff

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Table, type TableColumn } from '@eq-solutions/ui';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

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

// ─── API ─────────────────────────────────────────────────────────────────────

interface EntityResp {
  ok: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
}

async function fetchEntity(entity: string, extra: Record<string, string> = {}): Promise<EntityResp> {
  const qs = new URLSearchParams({ entity, page: '1', per_page: '500', ...extra });
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

// ─── PAGE ────────────────────────────────────────────────────────────────────

export function StaffPage() {
  const [staff,      setStaff]      = useState<StaffRow[]>([]);
  const [licences,   setLicences]   = useState<LicenceRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [licLoading, setLicLoading] = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [view,       setView]       = useState<View>('list');
  const [selId,      setSelId]      = useState<string | null>(null);
  const [tipId,      setTipId]      = useState<string | null>(null);
  const [tipRect,    setTipRect]    = useState<DOMRect | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Staff fetch — exclude inactive on arrival
  useEffect(() => {
    setLoading(true);
    fetchEntity('staff')
      .then((r) => {
        if (!r.ok) { setError(r.error ?? 'Failed to load staff'); return; }
        setStaff((r.rows ?? []).map(mapStaff).filter((s) => s.active !== false));
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, []);

  // Licences fetch — best-effort
  useEffect(() => {
    setLicLoading(true);
    fetchEntity('licence')
      .then((r) => {
        if (r.ok) setLicences((r.rows ?? []).map(mapLicence));
      })
      .catch(() => {})
      .finally(() => setLicLoading(false));
  }, []);

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

  const showTip = useCallback((staffId: string, rect: DOMRect) => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    setTipId(staffId);
    setTipRect(rect);
  }, []);
  const hideTip = useCallback(() => {
    tipTimer.current = setTimeout(() => setTipId(null), 100);
  }, []);

  const selStaff = selId ? staff.find((s) => s.id === selId) ?? null : null;

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS} fullWidth>
      <div style={s.page}>

        {/* Zone A — header */}
        <div style={s.ph}>
          <div>
            <h1 style={s.title}>Staff</h1>
            <p style={s.subtitle}>
              {loading ? 'Loading…' : `${staff.length} ${staff.length === 1 ? 'person' : 'people'}`}
            </p>
          </div>
        </div>

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
            <StaffList
              rows={staff}
              loading={loading}
              selId={selId}
              licByStaff={licByStaff}
              onSelect={selectRow}
              onShowTip={showTip}
              onHideTip={hideTip}
            />
            <SplitPanel
              staff={selStaff}
              lics={selStaff ? (licByStaff.get(selStaff.id) ?? []) : []}
              onClose={() => setSelId(null)}
            />
          </div>
        ) : (
          <MatrixView
            rows={staff}
            loading={loading || licLoading}
            licByStaff={licByStaff}
            licTypes={licTypes}
          />
        )}

        {/* Tooltip */}
        {tipId && tipRect && (
          <LicTip lics={licByStaff.get(tipId) ?? []} rect={tipRect} />
        )}
      </div>
    </HubLayout>
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
}

function StaffList({ rows, loading, selId, licByStaff, onSelect, onShowTip, onHideTip }: ListProps) {
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
      key: 'trade',
      header: 'Trade',
      sortAccessor: (row) => row.trade,
      render: (row) => <span style={{ color: '#475569' }}>{row.trade ?? '—'}</span>,
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
        let cur = 0, exp = 0, red = 0;
        for (const l of licByStaff.get(row.id) ?? []) {
          const st = licStatus(l);
          if (st === 'current' || st === 'ne') cur++;
          else if (st === 'expiring') exp++;
          else red++;
        }
        return (
          <span
            onMouseEnter={(e) => onShowTip(row.id, (e.currentTarget as HTMLElement).getBoundingClientRect())}
            onMouseLeave={onHideTip}
          >
            <LicDots cur={cur} exp={exp} red={red} />
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
        summary={(v, t) => <>Showing <strong>{v}</strong> of <strong>{t.toLocaleString()}</strong></>}
      />
    </div>
  );
}

function LicDots({ cur, exp, red }: { cur: number; exp: number; red: number }) {
  if (cur + exp + red === 0) return <span style={{ color: '#CBD5E1', fontSize: 12 }}>None recorded</span>;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {cur > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: '#475569' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E', display: 'inline-block' }} />
          {cur}
        </span>
      )}
      {exp > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: '#B45309' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
          {exp} expiring
        </span>
      )}
      {red > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: '#B91C1C' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444', display: 'inline-block' }} />
          {red} expired
        </span>
      )}
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

const MC: Record<LicStatus, React.CSSProperties> = {
  current:  { background: '#DCFCE7', color: '#15803D' },
  ne:       { background: '#EFF6FF', color: '#1D4ED8' },
  expiring: { background: '#FEF3C7', color: '#B45309' },
  expired:  { background: '#FEE2E2', color: '#B91C1C' },
};

function MatrixView({ rows, loading, licByStaff, licTypes }: MatrixProps) {
  if (loading) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>Loading matrix…</div>;
  }
  if (!licTypes.length) {
    return (
      <div style={s.empty}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
        <strong style={{ color: '#475569' }}>No licence data</strong>
        <span>Licences recorded in EQ Field will appear here</span>
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
