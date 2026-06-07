// Plant & Equipment — calibration tracking + custody.
//
// Lists the tenant's plant & equipment (meters, test gear, etc.) with their
// calibration due status, computed client-side from next_service_due. Reads
// assets via the equipment-list function (asset_type='plant_equipment'); the
// certificate link comes from the cert_url column (migration 0017) and the
// custodian from assigned_to (migration 0040).
//
// Managers + supervisors (equipment.edit) can add an item and edit its
// calibration + custody fields via the slide-out form; writes go to the
// asset-calibration function (direct app_data.assets table ops). Employees see
// status only.
//
// Viewers can slice the list by status (overdue / due soon / no cert) and group
// it by location or by custodian, with per-group rollups — the two questions a
// supervisor actually asks ("what's overdue?" and "who holds what?").
//
// Status is computed in the browser on purpose: there is no calibration
// "overdue" event in the canonical feed yet (that would need an emitter).

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, FileText, MapPin, User } from 'lucide-react';
import { Button } from '@eq-solutions/ui';
import { useCan } from '../../permissions';
import { HubLayout } from '../../components/HubLayout';
import { defaultSidebarRecords } from '../../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();
import { Skeleton } from '../../components/Skeleton';
import { EqError } from '../../components/EqError';

interface AssetRow {
  asset_id?: string;
  name?: string | null;
  make?: string | null;
  model?: string | null;
  serial_number?: string | null;
  site_id?: string | null;
  assigned_to?: string | null;
  last_service_date?: string | null;
  next_service_due?: string | null;
  ppm_frequency?: string | null;
  cert_url?: string | null;
}

interface SiteOption {
  site_id: string;
  name: string;
}

interface StaffOption {
  staff_id: string;
  name: string;
}

interface EntityRowsResponse {
  ok: boolean;
  error?: string;
  detail?: string;
  rows?: Record<string, unknown>[];
}

type Tone = 'overdue' | 'soon' | 'ok' | 'none';

// Flat tints (no gradients/shadows, per brand). Value is the text colour;
// the chip background is the same colour at ~8% alpha.
const TONE_COLOR: Record<Tone, string> = {
  overdue: '#c0392b',
  soon:    '#b7791f',
  ok:      '#2e7d32',
  none:    '#64748b',
};

const DUE_SOON_DAYS = 30;

function calStatus(nextDue: string | null | undefined): { tone: Tone; label: string } {
  if (!nextDue) return { tone: 'none', label: 'No date set' };
  const due = new Date(`${nextDue.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(due.getTime())) return { tone: 'none', label: 'No date set' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { tone: 'overdue', label: `Overdue ${Math.abs(days)}d` };
  if (days === 0) return { tone: 'soon', label: 'Due today' };
  if (days <= DUE_SOON_DAYS) return { tone: 'soon', label: `Due in ${days}d` };
  return { tone: 'ok', label: 'In date' };
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(`${v.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-AU');
}

function toDateInput(v: string | null | undefined): string {
  return v ? String(v).slice(0, 10) : '';
}

function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Best-effort parse of the free-text interval (ppm_frequency) and add it to a
// base date. Handles "12 months", "6mo", "1 year", "weekly", "quarterly",
// "annually", a bare number (treated as months), etc. Returns YYYY-MM-DD, or
// null when the interval can't be understood (caller leaves next-due manual).
function addInterval(fromYMD: string, interval: string | null | undefined): string | null {
  const base = new Date(`${fromYMD}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const raw = (interval ?? '').trim().toLowerCase();
  if (!raw) return null;

  let days = 0;
  let months = 0;
  const m = raw.match(/(\d+)\s*(days|day|weeks|week|wk|w|months|month|mo|m|years|year|yr|y)\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2];
    if (/^(days|day)$/.test(unit)) days = n;
    else if (/^(weeks|week|wk|w)$/.test(unit)) days = n * 7;
    else if (/^(months|month|mo|m)$/.test(unit)) months = n;
    else if (/^(years|year|yr|y)$/.test(unit)) months = n * 12;
  } else if (/\bweekly\b/.test(raw)) days = 7;
  else if (/\bfortnightly\b/.test(raw)) days = 14;
  else if (/\bmonthly\b/.test(raw)) months = 1;
  else if (/\bquarterly\b/.test(raw)) months = 3;
  else if (/(half[- ]?yearly|bi[- ]?annual|biannual|6[- ]?monthly)/.test(raw)) months = 6;
  else if (/\b(annually|annual|yearly)\b/.test(raw)) months = 12;
  else if (/^\d+$/.test(raw)) months = parseInt(raw, 10);
  else return null;

  if (months === 0 && days === 0) return null;
  const d = new Date(base);
  if (months) d.setMonth(d.getMonth() + months);
  if (days) d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function StatusChip({ tone, label }: { tone: Tone; label: string }) {
  const color = TONE_COLOR[tone];
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 12,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 6,
        color,
        background: `${color}14`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

const INPUT_STYLE: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid var(--eq-border)',
  borderRadius: 6,
  background: 'var(--eq-bg)',
  color: 'var(--eq-ink)',
  width: '100%',
  fontSize: 14,
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--eq-mute)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  display: 'block',
  marginBottom: 4,
};

interface FormState {
  name: string;
  make: string;
  model: string;
  serial_number: string;
  site_id: string;
  assigned_to: string;
  last_service_date: string;
  next_service_due: string;
  ppm_frequency: string;
  cert_url: string;
}

function rowToForm(row: AssetRow | null): FormState {
  return {
    name:              row?.name ?? '',
    make:              row?.make ?? '',
    model:             row?.model ?? '',
    serial_number:     row?.serial_number ?? '',
    site_id:           row?.site_id ?? '',
    assigned_to:       row?.assigned_to ?? '',
    last_service_date: toDateInput(row?.last_service_date),
    next_service_due:  toDateInput(row?.next_service_due),
    ppm_frequency:     row?.ppm_frequency ?? '',
    cert_url:          row?.cert_url ?? '',
  };
}

function EquipmentFormDrawer({
  mode,
  row,
  sites,
  staff,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  row: AssetRow | null;
  sites: SiteOption[];
  staff: StaffOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => rowToForm(row));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rafRef = useRef<number | null>(null);
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    rafRef.current = requestAnimationFrame(() => {
      setOpen(true);
      // Move focus into the drawer (first field) for keyboard + screen readers.
      asideRef.current?.querySelector<HTMLElement>('input, select')?.focus();
    });
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      prevFocus?.focus?.(); // restore focus to whatever opened the drawer
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const canSave =
    !saving && (mode === 'edit' || (form.name.trim() !== '' && form.site_id !== ''));

  const save = useCallback(async () => {
    setSaving(true);
    setErr(null);
    try {
      const fields: Record<string, string | null> = {
        name:              form.name.trim() || null,
        make:              form.make.trim() || null,
        model:             form.model.trim() || null,
        serial_number:     form.serial_number.trim() || null,
        site_id:           form.site_id || null,
        assigned_to:       form.assigned_to || null,
        last_service_date: form.last_service_date || null,
        next_service_due:  form.next_service_due || null,
        ppm_frequency:     form.ppm_frequency.trim() || null,
        cert_url:          form.cert_url.trim() || null,
      };
      const payload =
        mode === 'create'
          ? { action: 'create', fields }
          : { action: 'update', id: row?.asset_id, fields };
      const res = await fetch('/.netlify/functions/asset-calibration', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { ok: boolean; error?: string; detail?: string };
      if (!res.ok || !body.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }, [form, mode, row, onSaved]);

  // Records a calibration done today: sets last calibrated = today and rolls
  // next due forward by the interval (if parseable). User reviews, then Saves.
  const markCalibratedToday = () => {
    const today = todayYMD();
    setForm((f) => {
      const next = addInterval(today, f.ppm_frequency);
      return { ...f, last_service_date: today, next_service_due: next ?? f.next_service_due };
    });
  };

  const onCertFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so re-selecting the same file fires onChange
    if (!file) return;
    setUploading(true);
    setUploadErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/.netlify/functions/upload-asset-cert', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const body = (await res.json()) as { ok: boolean; url?: string; error?: string; detail?: string };
      if (!res.ok || !body.ok || !body.url) {
        throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
      }
      const url = body.url;
      setForm((f) => ({ ...f, cert_url: url }));
    } catch (e2) {
      setUploadErr((e2 as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const field = (label: string, key: keyof FormState, type = 'text', placeholder = '') => (
    <div style={{ marginBottom: 14 }}>
      <label style={LABEL_STYLE} htmlFor={`eq-${key}`}>{label}</label>
      <input
        id={`eq-${key}`}
        type={type}
        value={form[key]}
        placeholder={placeholder}
        onChange={set(key)}
        style={INPUT_STYLE}
      />
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40 }} />
      <aside
        ref={asideRef}
        role="dialog"
        aria-label={mode === 'create' ? 'Add equipment' : 'Edit equipment'}
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          height: '100vh',
          width: 'min(420px, 100vw)',
          background: 'white',
          borderLeft: '1px solid #e2e8f0',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 200ms ease',
        }}
      >
        <div style={{ padding: '20px 24px' }}>
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--eq-ink)' }}>
              {mode === 'create' ? 'Add item' : 'Edit item'}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--eq-mute)' }}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          {field('Item name', 'name', 'text', 'e.g. Gas detector')}
          {field('Make', 'make')}
          {field('Model', 'model')}
          {field('Serial number', 'serial_number')}

          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE} htmlFor="eq-site_id">Where it lives</label>
            <select id="eq-site_id" value={form.site_id} onChange={set('site_id')} style={INPUT_STYLE}>
              <option value="">— select —</option>
              {sites.map((s) => (
                <option key={s.site_id} value={s.site_id}>{s.name}</option>
              ))}
            </select>
            {sites.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--eq-mute)', margin: '6px 0 0' }}>
                No locations yet — add one via Import first.
              </p>
            )}
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE} htmlFor="eq-assigned_to">Assigned to</label>
            <select id="eq-assigned_to" value={form.assigned_to} onChange={set('assigned_to')} style={INPUT_STYLE}>
              <option value="">— unassigned —</option>
              {staff.map((s) => (
                <option key={s.staff_id} value={s.staff_id}>{s.name}</option>
              ))}
            </select>
            <p style={{ fontSize: 12, color: 'var(--eq-mute)', margin: '6px 0 0' }}>
              The person who currently holds this item. Optional.
            </p>
          </div>

          {field('Interval', 'ppm_frequency', 'text', 'e.g. 12 months')}

          <div style={{ margin: '-4px 0 14px' }}>
            <Button type="button" variant="ghost" size="sm" onClick={markCalibratedToday}>
              Mark calibrated today
            </Button>
            <span style={{ fontSize: 12, color: 'var(--eq-mute)', marginLeft: 8 }}>
              sets last done + rolls next due by the interval
            </span>
          </div>

          {field('Last calibrated', 'last_service_date', 'date')}
          {field('Next due', 'next_service_due', 'date')}

          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE} htmlFor="eq-cert_url">Certificate</label>
            <input
              id="eq-cert_url"
              type="url"
              value={form.cert_url}
              placeholder="Paste a link, or upload a file below"
              onChange={set('cert_url')}
              style={INPUT_STYLE}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              <label
                style={{ fontSize: 13, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1, display: 'inline-block', padding: '6px 12px', borderRadius: 6, border: '1px solid var(--gray-200)', color: 'var(--eq-ink)', background: 'transparent' }}
              >
                {uploading ? 'Uploading…' : 'Upload file'}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  onChange={onCertFile}
                  style={{ display: 'none' }}
                />
              </label>
              {form.cert_url && (
                <a
                  href={form.cert_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 13, color: '#2986b4', fontWeight: 500 }}
                >
                  View current
                </a>
              )}
            </div>
            {uploadErr && <p style={{ fontSize: 12, color: '#c0392b', margin: '6px 0 0' }}>{uploadErr}</p>}
            <p style={{ fontSize: 12, color: 'var(--eq-mute)', margin: '6px 0 0' }}>PDF or image, up to 10 MB.</p>
          </div>

          {err && (
            <div style={{
              background: '#fdf2f2', border: '1px solid #c0392b', borderRadius: 6,
              padding: '8px 12px', fontSize: 12, color: '#c0392b', marginBottom: 12,
            }}>
              {err}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button type="button" disabled={!canSave} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

type StatusFilter = 'all' | 'overdue' | 'soon' | 'nocert';
type GroupBy = 'none' | 'site' | 'person';

const UNASSIGNED_KEY = '__unassigned__';
const NO_LOCATION_KEY = '__nolocation__';

function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        fontWeight: 600,
        padding: '5px 12px',
        borderRadius: 999,
        cursor: 'pointer',
        border: `1px solid ${active ? '#2986b4' : 'var(--eq-border)'}`,
        background: active ? '#2986b414' : 'transparent',
        color: active ? '#2986b4' : 'var(--eq-mute)',
      }}
    >
      {label}
      <span style={{ opacity: 0.8, fontWeight: 500 }}>{count}</span>
    </button>
  );
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 13,
        fontWeight: 600,
        padding: '5px 12px',
        cursor: 'pointer',
        border: 'none',
        background: active ? 'white' : 'transparent',
        color: active ? 'var(--eq-ink)' : 'var(--eq-mute)',
        borderRadius: 6,
        boxShadow: active ? '0 0 0 1px var(--eq-border)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

export default function EquipmentModule() {
  const canView = useCan('equipment.view');
  const canEdit = useCan('equipment.edit');

  const [rows, setRows] = useState<AssetRow[] | null>(null);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row: AssetRow | null } | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      // equipment-list returns only internal plant & equipment
      // (asset_type='plant_equipment'), already sorted by next_service_due.
      const res = await fetch('/.netlify/functions/equipment-list', { credentials: 'include' });
      const body = (await res.json()) as EntityRowsResponse;
      if (!res.ok || !body.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
      setRows((body.rows ?? []) as AssetRow[]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSites = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ entity: 'site', limit: '200', sort_col: 'name', sort_dir: 'ASC', active: 'true' });
      const res = await fetch(`/.netlify/functions/entity-rows?${qs}`, { credentials: 'include' });
      const body = (await res.json()) as EntityRowsResponse;
      if (!res.ok || !body.ok) return;
      const opts = (body.rows ?? [])
        .map((r) => ({ site_id: String(r.site_id ?? ''), name: String(r.name ?? r.site_id ?? '') }))
        .filter((s) => s.site_id !== '');
      setSites(opts);
    } catch {
      // Sites populate a dropdown — failing to load just leaves it empty.
    }
  }, []);

  const loadStaff = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ entity: 'staff', limit: '500', sort_col: 'first_name', sort_dir: 'ASC', active: 'true' });
      const res = await fetch(`/.netlify/functions/entity-rows?${qs}`, { credentials: 'include' });
      const body = (await res.json()) as EntityRowsResponse;
      if (!res.ok || !body.ok) return;
      const opts = (body.rows ?? [])
        .map((r) => {
          const preferred = String(r.preferred_name ?? '').trim();
          const first = String(r.first_name ?? '').trim();
          const last = String(r.last_name ?? '').trim();
          const name = [preferred || first, last].filter(Boolean).join(' ') || String(r.staff_id ?? '');
          return { staff_id: String(r.staff_id ?? ''), name };
        })
        .filter((s) => s.staff_id !== '');
      setStaff(opts);
    } catch {
      // Custodian dropdown + Assigned-to names degrade to "Unassigned" / id.
    }
  }, []);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  useEffect(() => {
    // Sites + staff load for every viewer (not just editors) so the Location
    // and Assigned-to columns resolve names for read-only users too.
    if (canView) { void loadSites(); void loadStaff(); }
  }, [canView, loadSites, loadStaff]);

  // Resolve a site_id to its display name for the Location column.
  const siteName = useMemo(() => {
    const m = new Map(sites.map((s) => [s.site_id, s.name]));
    return (id: string | null | undefined): string => (id ? m.get(id) ?? '—' : '—');
  }, [sites]);

  const staffName = useMemo(() => {
    const m = new Map(staff.map((s) => [s.staff_id, s.name]));
    return (id: string | null | undefined): string => (id ? m.get(id) ?? 'Unknown' : 'Unassigned');
  }, [staff]);

  // Per-status counts for the filter chips (computed over the full list).
  const counts = useMemo(() => {
    const c = { all: 0, overdue: 0, soon: 0, nocert: 0 };
    for (const r of rows ?? []) {
      c.all += 1;
      const { tone } = calStatus(r.next_service_due);
      if (tone === 'overdue') c.overdue += 1;
      else if (tone === 'soon') c.soon += 1;
      if (!r.cert_url) c.nocert += 1;
    }
    return c;
  }, [rows]);

  const matchesFilter = useCallback(
    (r: AssetRow): boolean => {
      if (filter === 'all') return true;
      if (filter === 'nocert') return !r.cert_url;
      return calStatus(r.next_service_due).tone === (filter === 'soon' ? 'soon' : 'overdue');
    },
    [filter],
  );

  const visibleRows = useMemo(() => (rows ?? []).filter(matchesFilter), [rows, matchesFilter]);

  // Group the visible rows by the chosen key, each with a rollup. A single
  // "flat" group is returned when grouping is off.
  const groups = useMemo(() => {
    const keyOf = (r: AssetRow): string => {
      if (groupBy === 'site') return r.site_id || NO_LOCATION_KEY;
      if (groupBy === 'person') return r.assigned_to || UNASSIGNED_KEY;
      return '__all__';
    };
    const labelOf = (key: string): string => {
      if (groupBy === 'site') return key === NO_LOCATION_KEY ? 'No location' : siteName(key);
      if (groupBy === 'person') return key === UNASSIGNED_KEY ? 'Unassigned' : staffName(key);
      return '';
    };
    const byKey = new Map<string, AssetRow[]>();
    for (const r of visibleRows) {
      const k = keyOf(r);
      const arr = byKey.get(k);
      if (arr) arr.push(r);
      else byKey.set(k, [r]);
    }
    const out = Array.from(byKey.entries()).map(([key, items]) => {
      let overdue = 0;
      let soon = 0;
      for (const r of items) {
        const { tone } = calStatus(r.next_service_due);
        if (tone === 'overdue') overdue += 1;
        else if (tone === 'soon') soon += 1;
      }
      return { key, label: labelOf(key), items, overdue, soon };
    });
    // Sort: most-overdue first when grouped; leave flat as-is (already date-sorted).
    if (groupBy !== 'none') {
      out.sort((a, b) => b.overdue - a.overdue || b.soon - a.soon || a.label.localeCompare(b.label));
    }
    return out;
  }, [visibleRows, groupBy, siteName, staffName]);

  if (!canView) {
    return (
      <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
        <div className="eq-empty">
          <p className="eq-empty__title">Not allowed</p>
          <p>You don't have access to plant &amp; equipment.</p>
        </div>
      </HubLayout>
    );
  }

  const lede = (() => {
    if (!rows) return 'Calibration status for your meters, test gear and plant.';
    if (counts.all === 0) return 'No equipment recorded yet.';
    const parts = [`${counts.all} item${counts.all === 1 ? '' : 's'}`];
    if (counts.overdue) parts.push(`${counts.overdue} overdue`);
    if (counts.soon) parts.push(`${counts.soon} due soon`);
    return parts.join(' · ');
  })();

  const COL_COUNT = 9;

  const renderRow = (r: AssetRow, i: number) => {
    const status = calStatus(r.next_service_due);
    const makeModel = [r.make, r.model].filter(Boolean).join(' ') || '—';
    return (
      <tr
        key={r.asset_id ?? i}
        onClick={canEdit ? () => setForm({ mode: 'edit', row: r }) : undefined}
        style={canEdit ? { cursor: 'pointer' } : undefined}
      >
        <td>
          {canEdit ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setForm({ mode: 'edit', row: r }); }}
              aria-label={`Edit ${r.name || 'item'}`}
              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
            >
              {r.name || '—'}
            </button>
          ) : (
            r.name || '—'
          )}
        </td>
        <td>{makeModel}</td>
        <td>{r.serial_number || '—'}</td>
        <td>{siteName(r.site_id)}</td>
        <td>
          {r.assigned_to ? (
            staffName(r.assigned_to)
          ) : (
            <span style={{ color: 'var(--eq-mute)' }}>Unassigned</span>
          )}
        </td>
        <td>{fmtDate(r.last_service_date)}</td>
        <td>{fmtDate(r.next_service_due)}</td>
        <td><StatusChip tone={status.tone} label={status.label} /></td>
        <td>
          {r.cert_url ? (
            <a
              href={r.cert_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label="View certificate"
              title="View certificate"
              style={{ color: '#2986b4', display: 'inline-flex', alignItems: 'center' }}
            >
              <FileText size={16} aria-hidden="true" />
            </a>
          ) : (
            <span style={{ color: 'var(--eq-mute)' }}>—</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <div className="eq-page__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <h1 className="eq-page__title">Plant &amp; Equipment</h1>
          <p className="eq-page__lede">{lede}</p>
        </div>
        {canEdit && (
          <Button type="button" onClick={() => setForm({ mode: 'create', row: null })}>
            Add item
          </Button>
        )}
      </div>

      {err && <EqError message={err} onRetry={load} />}

      {rows && counts.all > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', margin: '4px 0 16px' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <FilterChip active={filter === 'all'} label="All" count={counts.all} onClick={() => setFilter('all')} />
            <FilterChip active={filter === 'overdue'} label="Overdue" count={counts.overdue} onClick={() => setFilter('overdue')} />
            <FilterChip active={filter === 'soon'} label="Due soon" count={counts.soon} onClick={() => setFilter('soon')} />
            <FilterChip active={filter === 'nocert'} label="No cert" count={counts.nocert} onClick={() => setFilter('nocert')} />
          </div>
          <div role="group" aria-label="Group by" style={{ display: 'inline-flex', gap: 2, padding: 2, background: 'var(--eq-bg-subtle, #f1f5f9)', borderRadius: 8 }}>
            <SegBtn active={groupBy === 'none'} onClick={() => setGroupBy('none')}>Flat</SegBtn>
            <SegBtn active={groupBy === 'site'} onClick={() => setGroupBy('site')}>
              <MapPin size={14} aria-hidden="true" /> Location
            </SegBtn>
            <SegBtn active={groupBy === 'person'} onClick={() => setGroupBy('person')}>
              <User size={14} aria-hidden="true" /> Person
            </SegBtn>
          </div>
        </div>
      )}

      <div
        className="eq-table-wrap"
        style={{ opacity: loading && rows !== null ? 0.6 : 1, transition: 'opacity 150ms' }}
      >
        <table className="eq-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Make / model</th>
              <th>Serial</th>
              <th>Location</th>
              <th>Assigned to</th>
              <th>Last calibrated</th>
              <th>Next due</th>
              <th>Status</th>
              <th>Cert</th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows ? (
              <tr>
                <td colSpan={COL_COUNT}>
                  <Skeleton variant="row" count={8} />
                </td>
              </tr>
            ) : counts.all === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} style={{ textAlign: 'center', padding: 32, color: 'var(--eq-mute)' }}>
                  {canEdit
                    ? 'No equipment recorded yet — use “Add item” to start tracking calibration.'
                    : 'No equipment recorded yet.'}
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} style={{ textAlign: 'center', padding: 32, color: 'var(--eq-mute)' }}>
                  Nothing matches this filter.
                </td>
              </tr>
            ) : groupBy === 'none' ? (
              visibleRows.map(renderRow)
            ) : (
              groups.map((g) => (
                <Fragment key={g.key}>
                  <tr style={{ background: 'var(--eq-bg-subtle, #f8fafc)' }}>
                    <td colSpan={COL_COUNT} style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--eq-ink)' }}>
                      {g.label}
                      <span style={{ marginLeft: 10, fontWeight: 500, fontSize: 13, color: 'var(--eq-mute)' }}>
                        {g.items.length} item{g.items.length === 1 ? '' : 's'}
                        {g.overdue ? ` · ${g.overdue} overdue` : ''}
                        {g.soon ? ` · ${g.soon} due soon` : ''}
                      </span>
                    </td>
                  </tr>
                  {g.items.map(renderRow)}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {form && (
        <EquipmentFormDrawer
          mode={form.mode}
          row={form.row}
          sites={sites}
          staff={staff}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); void load(); }}
        />
      )}
    </HubLayout>
  );
}
