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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, FileText, FileCheck2, FileX2, MapPin, User, ChevronRight, ChevronDown,
  Check, Clock, AlertTriangle, Gauge, CalendarDays, ArrowRightLeft,
  Download, UserCheck,
} from 'lucide-react';
import { Button, Table, TableBulkAction, type TableColumn } from '@eq-solutions/ui';
import { useCan } from '../../permissions';
import { HubLayout } from '../../components/HubLayout';
import { defaultSidebarRecords } from '../../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();
import { Skeleton } from '../../components/Skeleton';
import { EqError } from '../../components/EqError';

// Deterministic custodian avatar colour from the staff id. Stays within the
// brand-blue family (sky → deep) so it never reads as a status colour.
const AVATAR_PALETTE = ['#2986B4', '#1F4E6C', '#3DA8D8', '#5AC0E6', '#2E6E94'];
function avatarColour(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

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

// Chip class + icon per status. Status reads by dot + label + icon, never
// colour alone (per spec + WCAG). Colours come from --eq-success/warning/error
// tokens via the .eq-rc-chip--* classes in records-redesign.css.
const TONE_CHIP: Record<Tone, { cls: string; icon: React.ReactNode }> = {
  ok:      { cls: 'eq-rc-chip--ok',   icon: <Check size={13} aria-hidden="true" /> },
  soon:    { cls: 'eq-rc-chip--soon', icon: <Clock size={13} aria-hidden="true" /> },
  overdue: { cls: 'eq-rc-chip--over', icon: <AlertTriangle size={13} aria-hidden="true" /> },
  none:    { cls: 'eq-rc-chip--none', icon: <Clock size={13} aria-hidden="true" /> },
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
  const { cls, icon } = TONE_CHIP[tone];
  return (
    <span className={`eq-rc-chip ${cls}`}>
      <span className="eq-rc-chip__dot" aria-hidden="true" />
      {icon}
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
// Site = one register table (Site/location column). Person = one collapsible
// card per custodian with rollups; the custodian owns cert/calibration.
type GroupBy = 'site' | 'person';

const UNASSIGNED_KEY = '__unassigned__';

// Group-by pill toggle button (Site | Person).
function PillToggle({
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
      className={`eq-pilltoggle__btn${active ? ' is-active' : ''}`}
    >
      {children}
    </button>
  );
}

// Custodian avatar + name cell (used in the table + drawer).
function Custodian({ id, name }: { id: string | null | undefined; name: string }) {
  if (!id) {
    return (
      <span className="eq-rc-custodian eq-rc-custodian--none">
        <span className="eq-rc-avatar eq-rc-avatar--none" aria-hidden="true">?</span>
        <span className="eq-rc-custodian-name">Unassigned</span>
      </span>
    );
  }
  return (
    <span className="eq-rc-custodian">
      <span className="eq-rc-avatar" style={{ background: avatarColour(id) }} aria-hidden="true">
        {nameInitials(name)}
      </span>
      <span className="eq-rc-custodian-name">{name}</span>
    </span>
  );
}

// Merged Calibration cell — status chip + "Next <date>" sub.
function CalibrationCell({ tone, label, next }: { tone: Tone; label: string; next: string }) {
  return (
    <span className="eq-rc-cal">
      <StatusChip tone={tone} label={label} />
      <span className="eq-rc-calsub">Next <b>{next}</b></span>
    </span>
  );
}

// Cert affordance — filled file-check (has) / dashed file-x (missing) icon button.
function CertButton({ has, onOpen, label }: { has: boolean; onOpen: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`eq-rc-cert ${has ? 'eq-rc-cert--has' : 'eq-rc-cert--missing'}`}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      aria-label={has ? `View certificate for ${label}` : `No certificate on file for ${label}`}
      title={has ? 'View certificate' : 'No certificate on file'}
    >
      {has ? <FileCheck2 size={16} aria-hidden="true" /> : <FileX2 size={16} aria-hidden="true" />}
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
  const [detail, setDetail] = useState<AssetRow | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  // Group by Site (default) or by custodian (Person). Site keeps the single
  // table; Person renders one collapsible card per custodian with rollups.
  const [groupBy, setGroupBy] = useState<GroupBy>('site');
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  // Per-status counts used only for the header lede text.
  const counts = useMemo(() => {
    const c = { all: 0, overdue: 0, soon: 0 };
    for (const r of rows ?? []) {
      c.all += 1;
      const { tone } = calStatus(r.next_service_due);
      if (tone === 'overdue') c.overdue += 1;
      else if (tone === 'soon') c.soon += 1;
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

  // Group the visible rows by custodian (Person mode), each with a rollup of
  // its overdue / due-soon counts. Unassigned items group last.
  const personGroups = useMemo(() => {
    const byKey = new Map<string, AssetRow[]>();
    for (const r of visibleRows) {
      const k = r.assigned_to || UNASSIGNED_KEY;
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
      const isNone = key === UNASSIGNED_KEY;
      return {
        key,
        label: isNone ? 'Unassigned' : staffName(key),
        role: isNone ? 'No custodian — needs assigning' : 'Custodian',
        isNone,
        items,
        overdue,
        soon,
      };
    });
    // Most-overdue first; Unassigned always last.
    out.sort((a, b) => {
      if (a.isNone !== b.isNone) return a.isNone ? 1 : -1;
      return b.overdue - a.overdue || b.soon - a.soon || a.label.localeCompare(b.label);
    });
    return out;
  }, [visibleRows, staffName]);

  if (!canView) {
    return (
      <HubLayout sidebarRecords={SIDEBAR_RECORDS} fullWidth>
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

  // Column definitions for the Site view Table.
  const equipmentCols = useMemo<TableColumn<AssetRow>[]>(() => [
    {
      key: 'item',
      header: 'Item',
      sortAccessor: (r) => r.name ?? '',
      render: (r) => {
        const overdue = calStatus(r.next_service_due).tone === 'overdue';
        const itemId = r.name || r.serial_number || (r.asset_id ?? '').slice(0, 8) || '—';
        return (
          <span className="eq-rc-itemid">
            {overdue && <span className="eq-rc-reddot" aria-label="Overdue" />}
            {itemId}
          </span>
        );
      },
    },
    {
      key: 'make_model',
      header: 'Make / model',
      sortAccessor: (r) => `${r.make ?? ''} ${r.model ?? ''}`.trim(),
      render: (r) => (
        <span className="eq-rc-model">
          <b>{r.model || '—'}</b>
          {r.make && <span>{r.make}</span>}
        </span>
      ),
    },
    {
      key: 'serial',
      header: 'Serial',
      render: (r) => <span className="eq-rc-serial">{r.serial_number || '—'}</span>,
    },
    {
      key: 'assigned_to',
      header: 'Assigned to',
      sortAccessor: (r) => staffName(r.assigned_to),
      render: (r) => <Custodian id={r.assigned_to} name={staffName(r.assigned_to)} />,
    },
    {
      key: 'site',
      header: 'Site / location',
      sortAccessor: (r) => siteName(r.site_id),
      render: (r) => <span>{siteName(r.site_id)}</span>,
    },
    {
      key: 'calibration',
      header: 'Calibration',
      sortAccessor: (r) => r.next_service_due ?? '',
      render: (r) => {
        const status = calStatus(r.next_service_due);
        return <CalibrationCell tone={status.tone} label={status.label} next={fmtDate(r.next_service_due)} />;
      },
    },
    {
      key: 'cert',
      header: 'Cert',
      align: 'center',
      locked: true,
      render: (r) => {
        const itemId = r.name || r.serial_number || (r.asset_id ?? '').slice(0, 8) || '—';
        return (
          <CertButton has={Boolean(r.cert_url)} onOpen={() => setDetail(r)} label={String(itemId)} />
        );
      },
    },
  ], [siteName, staffName, setDetail]);

  // renderRow is kept for the Person view's bespoke group cards.
  const renderRow = (r: AssetRow, i: number) => {
    const status = calStatus(r.next_service_due);
    const overdue = status.tone === 'overdue';
    const itemId = r.name || r.serial_number || (r.asset_id ?? '').slice(0, 8) || '—';
    return (
      <tr
        key={r.asset_id ?? i}
        onClick={() => setDetail(r)}
        className={overdue ? 'is-overdue' : undefined}
        style={{ cursor: 'pointer' }}
      >
        <td>
          <span className="eq-rc-itemid">
            {overdue && <span className="eq-rc-reddot" aria-label="Overdue" />}
            {itemId}
          </span>
        </td>
        <td>
          <span className="eq-rc-model">
            <b>{r.model || '—'}</b>
            {r.make && <span>{r.make}</span>}
          </span>
        </td>
        <td><span className="eq-rc-serial">{r.serial_number || '—'}</span></td>
        <td>{siteName(r.site_id)}</td>
        <td>
          <CalibrationCell tone={status.tone} label={status.label} next={fmtDate(r.next_service_due)} />
        </td>
        <td style={{ textAlign: 'center' }}>
          <CertButton has={Boolean(r.cert_url)} onOpen={() => setDetail(r)} label={String(itemId)} />
        </td>
        <td style={{ width: 28 }}>
          <span className="eq-rc-rowchev" aria-hidden="true"><ChevronRight size={16} /></span>
        </td>
      </tr>
    );
  };

  const personTableHead = () => (
    <thead>
      <tr>
        <th>Item</th>
        <th>Make / model</th>
        <th>Serial</th>
        <th>Site / location</th>
        <th>Calibration</th>
        <th style={{ textAlign: 'center' }}>Cert</th>
        <th aria-label="Open" />
      </tr>
    </thead>
  );

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS} fullWidth>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Zone A — page header */}
      <div style={{ padding: '16px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexShrink: 0, marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--eq-deep)', margin: '0 0 4px' }}>Records · Register</p>
          <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: '#1A1A2E', margin: '0 0 4px' }}>Plant &amp; equipment</h1>
          <p style={{ fontSize: 13, color: 'var(--eq-mute)', margin: 0 }}>{lede}</p>
        </div>
        {canEdit && (
          <Button type="button" icon={<Gauge size={16} />} onClick={() => setForm({ mode: 'create', row: null })}>
            Add item
          </Button>
        )}
      </div>

      {err && <div style={{ padding: '0 24px', flexShrink: 0 }}><EqError message={err} onRetry={load} /></div>}

      {/* Zone B — group-by toggle (only when there's data) */}
      {rows && counts.all > 0 && (
        <div className="eq-rc-toolbar" style={{ padding: '0 24px', justifyContent: 'flex-end', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--eq-grey)' }}>Group by</span>
            <div className="eq-pilltoggle" role="group" aria-label="Group by">
              <PillToggle active={groupBy === 'site'} onClick={() => setGroupBy('site')}>
                <MapPin size={14} aria-hidden="true" /> Site
              </PillToggle>
              <PillToggle active={groupBy === 'person'} onClick={() => setGroupBy('person')}>
                <User size={14} aria-hidden="true" /> Person
              </PillToggle>
            </div>
          </div>
        </div>
      )}

      {/* Zone C — content area */}
      <div style={{ flex: 1, overflow: 'auto', minWidth: 0, padding: '0 24px 24px' }}>
      {loading && !rows ? (
        <div className="eq-table-wrap"><div style={{ padding: 8 }}><Skeleton variant="row" count={8} /></div></div>
      ) : counts.all === 0 ? (
        <div className="eq-table-wrap">
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--eq-mute)' }}>
            {canEdit
              ? 'No equipment recorded yet — use "Add item" to start tracking calibration.'
              : 'No equipment recorded yet.'}
          </div>
        </div>
      ) : groupBy === 'site' ? (
        // ── Group by Site: canonical Table with slicers, search, export ──
        <Table
          columns={equipmentCols}
          rows={rows ?? []}
          getRowId={(r) => r.asset_id ?? ''}
          slicers={[
            { key: 'all',     label: 'All' },
            { key: 'overdue', label: 'Overdue',  filter: (r) => calStatus(r.next_service_due).tone === 'overdue', dot: 'var(--eq-error-text)'   },
            { key: 'soon',    label: 'Due soon', filter: (r) => calStatus(r.next_service_due).tone === 'soon',    dot: 'var(--eq-warning-text)' },
            { key: 'nocert',  label: 'No cert',  filter: (r) => !r.cert_url,                                      dot: 'var(--eq-gray-400)'     },
          ]}
          activeSlicer={filter}
          onSlicerChange={(k) => setFilter(k as StatusFilter)}
          rowIndicator={(r) => calStatus(r.next_service_due).tone === 'overdue' ? { color: 'var(--eq-error-text)' } : null}
          globalSearch={{ placeholder: 'Search items…' }}
          columnToggle
          exportable={{ filename: 'equipment.csv' }}
          selectable
          selectedIds={selected}
          onSelectionChange={setSelected}
          bulkActions={(_rows, clear) => (
            <>
              <TableBulkAction icon={<UserCheck size={15} />} onClick={() => { console.warn('[equipment] bulk assign — not yet wired'); clear(); }}>Assign holder</TableBulkAction>
              <TableBulkAction icon={<CalendarDays size={15} />} onClick={() => { console.warn('[equipment] bulk schedule — not yet wired'); clear(); }}>Schedule calibration</TableBulkAction>
              <TableBulkAction icon={<Download size={15} />} onClick={clear}>Export</TableBulkAction>
            </>
          )}
          onRowClick={setDetail}
          loading={loading && !!rows}
          emptyMessage="Nothing matches this filter."
          pagination={{ pageSize: 25 }}
          summary={(v, t) => <>Showing <strong>{v}</strong> of <strong>{t.toLocaleString()}</strong> items</>}
        />
      ) : (
        // ── Group by Person: bespoke collapsible cards (Table doesn't support grouped layout) ──
        <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 150ms' }}>
          {visibleRows.length === 0 ? (
            <div className="eq-table-wrap">
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--eq-mute)' }}>Nothing matches this filter.</div>
            </div>
          ) : (
            personGroups.map((g) => {
              const closed = closedGroups.has(g.key);
              return (
                <div key={g.key} className={`eq-pgroup${closed ? ' is-closed' : ''}`}>
                  <button
                    type="button"
                    className="eq-pgroup__head"
                    aria-expanded={!closed}
                    onClick={() => setClosedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.key)) next.delete(g.key); else next.add(g.key);
                      return next;
                    })}
                  >
                    <span
                      className={`eq-pgroup__av${g.isNone ? ' eq-pgroup__av--none' : ''}`}
                      style={g.isNone ? undefined : { background: avatarColour(g.key) }}
                      aria-hidden="true"
                    >
                      {g.isNone ? '?' : nameInitials(g.label)}
                    </span>
                    <div className="eq-pgroup__main">
                      <div className="eq-pgroup__nm">{g.label}</div>
                      <div className="eq-pgroup__role">{g.role}</div>
                    </div>
                    <div className="eq-pgroup__roll">
                      <span className="eq-rollchip"><b>{g.items.length}</b> {g.items.length === 1 ? 'tool' : 'tools'}</span>
                      {g.overdue > 0 && (
                        <span className="eq-rollchip eq-rollchip--over"><span className="eq-rollchip__dot" aria-hidden="true" />{g.overdue} overdue</span>
                      )}
                      {g.overdue === 0 && g.soon > 0 && (
                        <span className="eq-rollchip eq-rollchip--soon"><span className="eq-rollchip__dot" aria-hidden="true" />{g.soon} due soon</span>
                      )}
                      {g.overdue === 0 && g.soon === 0 && (
                        <span className="eq-rollchip eq-rollchip--ok"><span className="eq-rollchip__dot" aria-hidden="true" />all current</span>
                      )}
                    </div>
                    <span className="eq-pgroup__chev" aria-hidden="true"><ChevronDown size={18} /></span>
                  </button>
                  <div className="eq-pgroup__body">
                    <div className="eq-rc-tablescroll">
                      <table className="eq-table">
                        {personTableHead()}
                        <tbody>{g.items.map((r, i) => renderRow(r, i))}</tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      </div>{/* /Zone C */}
      </div>{/* /flex column */}

      {detail && (
        <AssetDetailDrawer
          row={detail}
          siteName={siteName(detail.site_id)}
          custodianName={staffName(detail.assigned_to)}
          canEdit={canEdit}
          onClose={() => setDetail(null)}
          onReassign={() => { const r = detail; setDetail(null); setForm({ mode: 'edit', row: r }); }}
          onLogCalibration={() => { const r = detail; setDetail(null); setForm({ mode: 'edit', row: r }); }}
        />
      )}

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

// ── Asset detail drawer (read-only) — EntityBrowserPage slide-over pattern.
// Identity & custody · Calibration (mini track) · Certificate, plus Reassign /
// Log-calibration actions that hand off to the existing edit form.
function AssetDetailDrawer({
  row,
  siteName,
  custodianName,
  canEdit,
  onClose,
  onReassign,
  onLogCalibration,
}: {
  row: AssetRow;
  siteName: string;
  custodianName: string;
  canEdit: boolean;
  onClose: () => void;
  onReassign: () => void;
  onLogCalibration: () => void;
}) {
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

  const status = calStatus(row.next_service_due);
  const { cls, icon } = TONE_CHIP[status.tone];
  const itemId = row.name || row.serial_number || (row.asset_id ?? '').slice(0, 8) || 'Item';
  const makeModel = [row.make, row.model].filter(Boolean).join(' ') || '—';
  const hasCert = Boolean(row.cert_url);
  // Mini track fill: OK ~40%, due ~86%, overdue 100% (illustrative position in
  // the calibration interval), coloured by status.
  const pct = status.tone === 'overdue' ? 100 : status.tone === 'soon' ? 86 : status.tone === 'ok' ? 40 : 12;
  const barColour =
    status.tone === 'overdue' ? 'var(--eq-error-text)'
    : status.tone === 'soon'  ? 'var(--eq-warning-text)'
    : status.tone === 'ok'    ? 'var(--eq-success-text)'
    : 'var(--eq-gray-400)';

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--eq-overlay)', zIndex: 40 }} />
      <aside
        role="dialog"
        aria-label={`${itemId} detail`}
        style={{
          position: 'fixed', right: 0, top: 0, height: '100vh',
          width: 'min(560px, 94vw)', background: 'var(--eq-content-bg, #F6F3EE)',
          borderLeft: '1px solid var(--eq-border)', zIndex: 50,
          display: 'flex', flexDirection: 'column', overflowY: 'auto',
          boxShadow: 'var(--eq-shadow-lg)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 220ms ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px', borderBottom: '1px solid var(--eq-border)', background: 'var(--eq-white)' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--eq-ink)', fontVariantNumeric: 'tabular-nums' }}>{itemId}</span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--eq-gray-500)', display: 'inline-flex', padding: 4 }}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div style={{ padding: 20, flex: 1 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--eq-ink)' }}>{row.name || itemId}</div>
            <div style={{ fontSize: 13, color: 'var(--eq-grey)' }}>{makeModel}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--eq-radius-input)', background: 'var(--eq-ice)', color: 'var(--eq-deep)' }}>
                <MapPin size={12} aria-hidden="true" /> {siteName}
              </span>
              <span className={`eq-rc-chip ${cls}`}>
                <span className="eq-rc-chip__dot" aria-hidden="true" />{icon}{status.label}
              </span>
            </div>
          </div>

          {/* Identity & custody */}
          <div className="eq-rc-drawer-card">
            <div className="eq-rc-drawer-card__h"><Gauge size={16} aria-hidden="true" /><h3>Identity &amp; custody</h3></div>
            <div className="eq-rc-kv"><span className="eq-rc-kv__k">Make / model</span><span className="eq-rc-kv__v">{makeModel}</span></div>
            <div className="eq-rc-kv"><span className="eq-rc-kv__k">Serial</span><span className="eq-rc-kv__v" style={{ fontVariantNumeric: 'tabular-nums' }}>{row.serial_number || '—'}</span></div>
            <div className="eq-rc-kv"><span className="eq-rc-kv__k">Site / location</span><span className="eq-rc-kv__v">{siteName}</span></div>
            <div className="eq-rc-kv"><span className="eq-rc-kv__k">Assigned to</span><span className="eq-rc-kv__v"><Custodian id={row.assigned_to} name={custodianName} /></span></div>
          </div>

          {/* Calibration */}
          <div className="eq-rc-drawer-card">
            <div className="eq-rc-drawer-card__h"><CalendarDays size={16} aria-hidden="true" /><h3>Calibration</h3></div>
            <div className="eq-rc-kv"><span className="eq-rc-kv__k">Last calibrated</span><span className="eq-rc-kv__v">{fmtDate(row.last_service_date)}</span></div>
            <div className="eq-rc-kv"><span className="eq-rc-kv__k">Next due</span><span className="eq-rc-kv__v">{fmtDate(row.next_service_due)}</span></div>
            <div className="eq-rc-track__bar"><i style={{ width: `${pct}%`, background: barColour }} /></div>
            <div className="eq-rc-track__meta"><span>Last cal</span><span><b>{status.label}</b></span><span>Next due</span></div>
          </div>

          {/* Certificate */}
          <div className="eq-rc-drawer-card">
            <div className="eq-rc-drawer-card__h">{hasCert ? <FileCheck2 size={16} aria-hidden="true" /> : <FileX2 size={16} aria-hidden="true" />}<h3>Certificate</h3></div>
            <div className={`eq-rc-certtile ${hasCert ? 'eq-rc-certtile--has' : 'eq-rc-certtile--missing'}`}>
              <span className="eq-rc-certtile__ic">{hasCert ? <FileCheck2 size={22} aria-hidden="true" /> : <FileX2 size={22} aria-hidden="true" />}</span>
              <div style={{ flex: 1 }}>
                <div className="eq-rc-certtile__t">{hasCert ? 'Calibration certificate on file' : 'No certificate on file'}</div>
                <div className="eq-rc-certtile__m">{hasCert ? 'PDF or image — open to view the issued certificate.' : 'Upload the latest certificate to clear this flag.'}</div>
              </div>
              {hasCert ? (
                <a href={row.cert_url ?? '#'} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                  <Button type="button" variant="ghost" size="sm" icon={<FileText size={14} />}>View</Button>
                </a>
              ) : (
                canEdit && <Button type="button" variant="primary" size="sm" onClick={onLogCalibration}>Upload</Button>
              )}
            </div>
          </div>
        </div>

        {canEdit && (
          <div style={{ display: 'flex', gap: 8, padding: 16, borderTop: '1px solid var(--eq-border)', background: 'var(--eq-white)' }}>
            <Button type="button" variant="ghost" icon={<ArrowRightLeft size={15} />} onClick={onReassign}>Reassign custodian</Button>
            <Button type="button" variant="primary" icon={<CalendarDays size={15} />} onClick={onLogCalibration}>Log calibration</Button>
          </div>
        )}
      </aside>
    </>
  );
}
