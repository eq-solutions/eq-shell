import { Fragment, useState, useEffect, useCallback, useId } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Circle, AlertTriangle, AlertCircle, Plus, X, Pencil, Trash2, Check, Download, Search } from 'lucide-react';
import { HubLayout } from '../../components/HubLayout';
import { useSession } from '../../session';
import { useCan } from '../../permissions';
import { defaultSidebarRecords } from '../../lib/sidebarConfig';
import { COMMS_UPDATE_PERM } from './permissions';
import './comms.css';

const SIDEBAR_RECORDS = defaultSidebarRecords();

// ── Types ────────────────────────────────────────────────────────────────────

type JobStatus = 'quoted' | 'active' | 'on_hold' | 'complete' | 'closed';

interface CommsJob {
  job_id:            string;
  job_number:        string | null;
  site_code:         string;
  site_name:         string | null;
  client:            string;
  status:            JobStatus;
  description:       string | null;
  assigned_to:       string | null;
  start_date:        string | null;
  target_completion: string | null;
  on_hold_since:     string | null;
  mop_received:      boolean;
  pre_cable_done:    boolean;
  post_dock_done:    boolean;
  invoice_raised:    boolean;
  notes:             string | null;
  total_value:       number;
  total_invoiced:    number;
  total_hours:       number;
  total_materials:   number;
  line_count:        number;
}

interface PoLine {
  line_id:          string;
  po_number:        string | null;
  description:      string;
  requestor:        string | null;
  fid_number:       string | null;
  quote_number:     string | null;
  date_approval:    string | null;
  hours:            number | null;
  materials_cost:   number | null;
  price_ex_gst:     number | null;
  complete_notes:   string | null;
  invoice_number:   string | null;
  invoiced_amount:  number | null;
}

interface CommsEvent {
  event_id:   string;
  action:     string;
  note:       string | null;
  user_id:    string;
  created_at: string;
}

interface StaffMember {
  id:   string;
  name: string;
}

interface LineEditForm {
  po_number:       string;
  description:     string;
  requestor:       string;
  fid_number:      string;
  quote_number:    string;
  date_approval:   string;
  hours:           string;
  materials_cost:  string;
  price_ex_gst:    string;
  invoice_number:  string;
  invoiced_amount: string;
  complete_notes:  string;
}

type TabKey = 'all' | JobStatus;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n === 0)   return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}k`;
  return `$${n.toLocaleString()}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

function isJobOverdue(job: CommsJob): boolean {
  return !!job.target_completion
    && job.target_completion < todayIso()
    && (job.status === 'active' || job.status === 'on_hold');
}

function matchesSearch(job: CommsJob, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  return [job.site_code, job.site_name, job.job_number, job.description, job.assigned_to, job.client]
    .some((v) => v?.toLowerCase().includes(lower));
}

function exportCSV(jobs: CommsJob[]) {
  const headers = [
    'Job #', 'Site Code', 'Site Name', 'Client', 'Status', 'Assigned',
    'Description', 'Start', 'Target', 'On Hold Since',
    'Value ex-GST', 'Invoiced', 'Hours', 'Lines',
    'MOP', 'Pre-cable', 'Post-dock', 'Invoice raised',
  ];
  const rows = jobs.map((j) => [
    j.job_number ?? '',
    j.site_code,
    j.site_name ?? '',
    j.client,
    STATUS_LABELS[j.status],
    j.assigned_to ?? '',
    j.description ?? '',
    j.start_date ?? '',
    j.target_completion ?? '',
    j.on_hold_since ?? '',
    j.total_value,
    j.total_invoiced,
    j.total_hours,
    j.line_count,
    j.mop_received    ? 'Yes' : '',
    j.pre_cable_done  ? 'Yes' : '',
    j.post_dock_done  ? 'Yes' : '',
    j.invoice_raised  ? 'Yes' : '',
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = `nsw-comms-${today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_LABELS: Record<JobStatus, string> = {
  quoted:   'Quoted',
  active:   'Active',
  on_hold:  'On Hold',
  complete: 'Complete',
  closed:   'Closed',
};

const ALL_STATUSES: JobStatus[] = ['quoted', 'active', 'on_hold', 'complete', 'closed'];

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'active',   label: 'Active' },
  { key: 'quoted',   label: 'Quoted' },
  { key: 'on_hold',  label: 'On Hold' },
  { key: 'complete', label: 'Complete' },
];

// ── Monday brief ─────────────────────────────────────────────────────────────

function MondayBrief({ jobs }: { jobs: CommsJob[] }) {
  const overdueJobs     = jobs.filter(isJobOverdue);
  const readyToInvoice  = jobs.filter((j) => j.post_dock_done && !j.invoice_raised && j.total_value > 0 && j.status !== 'closed');
  const unassignedActive = jobs.filter((j) => j.status === 'active' && !j.assigned_to);
  const longOnHold      = jobs.filter((j) => j.status === 'on_hold');

  const total = overdueJobs.length + readyToInvoice.length + unassignedActive.length + longOnHold.length;
  if (total === 0) return null;

  return (
    <div className="comms-brief" role="region" aria-label="Action items">
      <div className="comms-brief__heading">
        <AlertTriangle size={14} />
        Action needed
      </div>
      <ul className="comms-brief__list">
        {overdueJobs.length > 0 && (
          <li className="comms-brief__item comms-brief__item--overdue">
            <strong>{overdueJobs.length} overdue</strong>
            {' — '}{overdueJobs.map((j) => j.site_code).join(', ')}
          </li>
        )}
        {readyToInvoice.length > 0 && (
          <li className="comms-brief__item comms-brief__item--invoice">
            <strong>{readyToInvoice.length} job{readyToInvoice.length > 1 ? 's' : ''} ready to invoice</strong>
            {' — '}{readyToInvoice.map((j) => j.site_code).join(', ')}
          </li>
        )}
        {unassignedActive.length > 0 && (
          <li className="comms-brief__item comms-brief__item--assign">
            <strong>{unassignedActive.length} active job{unassignedActive.length > 1 ? 's' : ''} unassigned</strong>
            {' — '}{unassignedActive.map((j) => j.site_code).join(', ')}
          </li>
        )}
        {longOnHold.length > 0 && (
          <li className="comms-brief__item comms-brief__item--hold">
            <strong>{longOnHold.length} on hold</strong>
            {' — '}{longOnHold.map((j) => j.site_code).join(', ')}
          </li>
        )}
      </ul>
    </div>
  );
}

// ── Milestone pill ────────────────────────────────────────────────────────────

function MilestonePill({
  label, fullLabel, done, canEdit, onClick,
}: {
  label:     string;
  fullLabel: string;
  done:      boolean;
  canEdit:   boolean;
  onClick?:  () => void;
}) {
  return (
    <button
      type="button"
      className={[
        'comms-milestone',
        done    ? 'comms-milestone--done'      : 'comms-milestone--pending',
        canEdit ? 'comms-milestone--clickable' : '',
      ].join(' ')}
      onClick={canEdit ? onClick : undefined}
      aria-pressed={done}
      aria-label={`${fullLabel}: ${done ? 'done' : 'pending'}${canEdit ? '. Click to toggle' : ''}`}
      disabled={!canEdit}
    >
      {done ? <CheckCircle2 size={11} /> : <Circle size={11} />}
      {label}
    </button>
  );
}

// ── Create job form ───────────────────────────────────────────────────────────

function CreateJobForm({
  onCreated,
  onCancel,
  staffListId,
}: {
  onCreated:   (job: CommsJob) => void;
  onCancel:    () => void;
  staffListId: string;
}) {
  const [form, setForm] = useState({
    site_code:         '',
    site_name:         '',
    client:            'Microsoft',
    job_number:        '',
    description:       '',
    assigned_to:       '',
    start_date:        '',
    target_completion: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.site_code.trim()) { setErr('Site code is required'); return; }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/.netlify/functions/comms-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          create: {
            site_code:         form.site_code.trim().toUpperCase(),
            site_name:         form.site_name.trim()         || null,
            client:            form.client.trim()            || 'Microsoft',
            job_number:        form.job_number.trim()        || null,
            description:       form.description.trim()       || null,
            assigned_to:       form.assigned_to.trim()       || null,
            start_date:        form.start_date               || null,
            target_completion: form.target_completion        || null,
          },
        }),
      });
      const data = await res.json();
      if (!data.ok) { setErr(data.error ?? 'Save failed'); return; }
      onCreated(data.job as CommsJob);
    } catch {
      setErr('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="comms-create-form" onSubmit={submit}>
      <div className="comms-create-form__heading">New job</div>
      <div className="comms-create-form__row">
        <div className="comms-edit-field">
          <label>Site code *</label>
          <input type="text" value={form.site_code} onChange={set('site_code')}
            placeholder="SYD27" autoFocus />
        </div>
        <div className="comms-edit-field comms-edit-field--grow">
          <label>Site name</label>
          <input type="text" value={form.site_name} onChange={set('site_name')}
            placeholder="Equinix SY9" />
        </div>
        <div className="comms-edit-field">
          <label>Client</label>
          <input type="text" value={form.client} onChange={set('client')}
            placeholder="Microsoft" />
        </div>
        <div className="comms-edit-field">
          <label>Job #</label>
          <input type="text" value={form.job_number} onChange={set('job_number')}
            placeholder="SKS-1234" />
        </div>
      </div>
      <div className="comms-create-form__row">
        <div className="comms-edit-field comms-edit-field--grow2">
          <label>Description</label>
          <input type="text" value={form.description} onChange={set('description')}
            placeholder="Copper decommission, rack relocation…" />
        </div>
        <div className="comms-edit-field comms-edit-field--grow">
          <label>Assigned to</label>
          <input type="text" value={form.assigned_to} onChange={set('assigned_to')}
            list={staffListId} placeholder="Tech name" />
        </div>
        <div className="comms-edit-field">
          <label>Start date</label>
          <input type="date" value={form.start_date} onChange={set('start_date')} />
        </div>
        <div className="comms-edit-field">
          <label>Target completion</label>
          <input type="date" value={form.target_completion} onChange={set('target_completion')} />
        </div>
      </div>
      {err && <div className="comms-save-error" role="alert">{err}</div>}
      <div className="comms-create-form__actions">
        <button type="submit" className="comms-save-btn" disabled={saving}>
          {saving ? 'Creating…' : 'Create job'}
        </button>
        <button type="button" className="comms-cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ── Add line form ─────────────────────────────────────────────────────────────

function AddLineForm({
  jobId, onAdded, onCancel,
}: {
  jobId:    string;
  onAdded:  (line: PoLine) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    po_number:     '',
    description:   '',
    requestor:     '',
    fid_number:    '',
    quote_number:  '',
    date_approval: '',
    hours:         '',
    materials_cost: '',
    price_ex_gst:  '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) { setErr('Description is required'); return; }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/.netlify/functions/comms-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          line: {
            po_number:     form.po_number.trim()     || null,
            description:   form.description.trim(),
            requestor:     form.requestor.trim()     || null,
            fid_number:    form.fid_number.trim()    || null,
            quote_number:  form.quote_number.trim()  || null,
            date_approval: form.date_approval        || null,
            hours:         form.hours         ? parseFloat(form.hours)         : null,
            materials_cost: form.materials_cost ? parseFloat(form.materials_cost) : null,
            price_ex_gst:  form.price_ex_gst  ? parseFloat(form.price_ex_gst)  : null,
          },
        }),
      });
      const data = await res.json();
      if (!data.ok) { setErr(data.error ?? 'Save failed'); return; }
      onAdded(data.line as PoLine);
    } catch {
      setErr('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="comms-add-line-form" onSubmit={submit}>
      <div className="comms-add-line-form__row">
        <div className="comms-edit-field comms-edit-field--grow">
          <label>Description *</label>
          <input type="text" value={form.description} onChange={set('description')} placeholder="Work description" />
        </div>
        <div className="comms-edit-field">
          <label>PO #</label>
          <input type="text" value={form.po_number} onChange={set('po_number')} placeholder="PO number" />
        </div>
        <div className="comms-edit-field">
          <label>FID #</label>
          <input type="text" value={form.fid_number} onChange={set('fid_number')} placeholder="FID" />
        </div>
        <div className="comms-edit-field">
          <label>Requestor</label>
          <input type="text" value={form.requestor} onChange={set('requestor')} placeholder="Name" />
        </div>
        <div className="comms-edit-field">
          <label>Quote #</label>
          <input type="text" value={form.quote_number} onChange={set('quote_number')} placeholder="Quote" />
        </div>
        <div className="comms-edit-field">
          <label>Date approved</label>
          <input type="date" value={form.date_approval} onChange={set('date_approval')} />
        </div>
      </div>
      <div className="comms-add-line-form__row">
        <div className="comms-edit-field comms-edit-field--num">
          <label>Hours</label>
          <input type="number" min="0" step="0.5" value={form.hours} onChange={set('hours')} placeholder="0" />
        </div>
        <div className="comms-edit-field comms-edit-field--num">
          <label>Materials ex-GST</label>
          <input type="number" min="0" step="0.01" value={form.materials_cost} onChange={set('materials_cost')} placeholder="0.00" />
        </div>
        <div className="comms-edit-field comms-edit-field--num">
          <label>Value ex-GST</label>
          <input type="number" min="0" step="0.01" value={form.price_ex_gst} onChange={set('price_ex_gst')} placeholder="0.00" />
        </div>
      </div>
      {err && <div className="comms-save-error" role="alert">{err}</div>}
      <div className="comms-add-line-form__actions">
        <button type="submit" className="comms-save-btn" disabled={saving}>{saving ? 'Adding…' : 'Add line'}</button>
        <button type="button" className="comms-cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ── Job card ─────────────────────────────────────────────────────────────────

function JobCard({
  job, canEdit, onJobUpdated,
}: {
  job:          CommsJob;
  canEdit:      boolean;
  onJobUpdated: (updated: Partial<CommsJob> & { job_id: string }) => void;
}) {
  const cardId       = useId();
  const cardDetailId = `${cardId}-detail`;
  const tabPanelId   = `${cardId}-tabpanel`;

  const [open, setOpen]           = useState(false);
  const [lines, setLines]         = useState<PoLine[] | null>(null);
  const [events, setEvents]       = useState<CommsEvent[]>([]);
  const [loading, setLoading]     = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab]             = useState<'lines' | 'history'>('lines');

  // Operational edit state
  const [assignedTo, setAssignedTo] = useState(job.assigned_to ?? '');
  const [notes, setNotes]           = useState(job.notes ?? '');
  const [status, setStatus]         = useState<JobStatus>(job.status);

  // Header edit state
  const [siteCode, setSiteCode]             = useState(job.site_code);
  const [siteName, setSiteName]             = useState(job.site_name ?? '');
  const [client, setClient]                 = useState(job.client);
  const [jobNumber, setJobNumber]           = useState(job.job_number ?? '');
  const [description, setDescription]       = useState(job.description ?? '');
  const [startDate, setStartDate]           = useState(job.start_date ?? '');
  const [targetCompletion, setTargetCompletion] = useState(job.target_completion ?? '');
  const [onHoldSince, setOnHoldSince]       = useState(job.on_hold_since ?? '');

  const [saving, setSaving]       = useState(false);
  const [showAddLine, setShowAddLine] = useState(false);

  // Full line edit state
  const [editLineId, setEditLineId]     = useState<string | null>(null);
  const [lineEditForm, setLineEditForm] = useState<LineEditForm | null>(null);
  const [savingLine, setSavingLine]     = useState(false);
  const [deleteLineId, setDeleteLineId] = useState<string | null>(null);
  const [deletingLine, setDeletingLine] = useState(false);

  const overdue = isJobOverdue(job);

  const fetchDetail = useCallback(async (force = false) => {
    if (!force && lines !== null) return;
    setLoading(true);
    try {
      const res = await fetch(`/.netlify/functions/comms-jobs?id=${job.job_id}`, { credentials: 'include' });
      const data = await res.json();
      if (data.ok) {
        setLines(data.lines);
        setEvents(data.events ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [job.job_id, lines]);

  const handleToggle = () => {
    setOpen((v) => !v);
    if (!open) fetchDetail();
  };

  const patchJob = useCallback(async (patch: Record<string, unknown>) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/.netlify/functions/comms-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id, patch }),
      });
      const data = await res.json();
      if (data.ok) {
        onJobUpdated({ job_id: job.job_id, ...patch });
      } else {
        setSaveError(data.error ?? 'Save failed');
      }
    } catch {
      setSaveError('Network error');
    } finally {
      setSaving(false);
    }
  }, [job.job_id, onJobUpdated]);

  const toggleMilestone = (field: 'mop_received' | 'pre_cable_done' | 'post_dock_done' | 'invoice_raised') => {
    patchJob({ [field]: !job[field] });
  };

  const saveEdits = () => {
    const patch: Record<string, unknown> = {};
    // Operational fields
    if (assignedTo !== (job.assigned_to ?? '')) patch.assigned_to = assignedTo || null;
    if (notes      !== (job.notes      ?? '')) patch.notes       = notes || null;
    if (status     !== job.status)             patch.status      = status;
    // Header fields
    if (siteCode        !== job.site_code)              patch.site_code         = siteCode.trim().toUpperCase() || job.site_code;
    if (siteName        !== (job.site_name ?? ''))       patch.site_name         = siteName.trim() || null;
    if (client          !== job.client)                  patch.client            = client.trim() || job.client;
    if (jobNumber       !== (job.job_number ?? ''))      patch.job_number        = jobNumber.trim() || null;
    if (description     !== (job.description ?? ''))     patch.description       = description.trim() || null;
    if (startDate       !== (job.start_date ?? ''))      patch.start_date        = startDate || null;
    if (targetCompletion !== (job.target_completion ?? '')) patch.target_completion = targetCompletion || null;

    // Auto-populate on_hold_since when transitioning to on_hold
    let effectiveHoldSince = onHoldSince;
    if (status === 'on_hold' && !effectiveHoldSince) {
      effectiveHoldSince = todayIso();
      setOnHoldSince(effectiveHoldSince);
    } else if (status !== 'on_hold') {
      effectiveHoldSince = '';
    }
    if (effectiveHoldSince !== (job.on_hold_since ?? '')) patch.on_hold_since = effectiveHoldSince || null;

    if (Object.keys(patch).length === 0) return;
    patchJob(patch);
  };

  const startLineEdit = (line: PoLine) => {
    setDeleteLineId(null);
    setEditLineId(line.line_id);
    setLineEditForm({
      po_number:       line.po_number       ?? '',
      description:     line.description,
      requestor:       line.requestor       ?? '',
      fid_number:      line.fid_number      ?? '',
      quote_number:    line.quote_number     ?? '',
      date_approval:   line.date_approval   ? line.date_approval.slice(0, 10) : '',
      hours:           line.hours           != null ? String(line.hours)           : '',
      materials_cost:  line.materials_cost  != null ? String(line.materials_cost)  : '',
      price_ex_gst:    line.price_ex_gst    != null ? String(line.price_ex_gst)    : '',
      invoice_number:  line.invoice_number  ?? '',
      invoiced_amount: line.invoiced_amount != null ? String(line.invoiced_amount) : '',
      complete_notes:  line.complete_notes  ?? '',
    });
  };

  const cancelLineEdit = () => { setEditLineId(null); setLineEditForm(null); };

  const saveLineEdit = async () => {
    if (!editLineId || !lineEditForm) return;
    setSavingLine(true);
    try {
      const res = await fetch('/.netlify/functions/comms-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: job.job_id,
          line_id: editLineId,
          line_patch: {
            po_number:       lineEditForm.po_number.trim()       || null,
            description:     lineEditForm.description.trim(),
            requestor:       lineEditForm.requestor.trim()       || null,
            fid_number:      lineEditForm.fid_number.trim()      || null,
            quote_number:    lineEditForm.quote_number.trim()    || null,
            date_approval:   lineEditForm.date_approval          || null,
            hours:           lineEditForm.hours         ? parseFloat(lineEditForm.hours)         : null,
            materials_cost:  lineEditForm.materials_cost ? parseFloat(lineEditForm.materials_cost) : null,
            price_ex_gst:    lineEditForm.price_ex_gst  ? parseFloat(lineEditForm.price_ex_gst)  : null,
            invoice_number:  lineEditForm.invoice_number.trim()  || null,
            invoiced_amount: lineEditForm.invoiced_amount ? parseFloat(lineEditForm.invoiced_amount) : null,
            complete_notes:  lineEditForm.complete_notes.trim()  || null,
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setLines((prev) =>
          prev ? prev.map((l) => l.line_id === editLineId ? { ...l, ...data.line } : l) : prev,
        );
        cancelLineEdit();
        fetchDetail(true);
      }
    } finally {
      setSavingLine(false);
    }
  };

  const confirmDeleteLine = async () => {
    if (!deleteLineId) return;
    setDeletingLine(true);
    try {
      const res = await fetch('/.netlify/functions/comms-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id, line_id: deleteLineId, delete_line: true }),
      });
      const data = await res.json();
      if (data.ok) {
        setLines((prev) => prev ? prev.filter((l) => l.line_id !== deleteLineId) : prev);
        setDeleteLineId(null);
        fetchDetail(true);
      }
    } finally {
      setDeletingLine(false);
    }
  };

  const invoiceNeeded = job.total_value > 0 && !job.invoice_raised && (job.post_dock_done || job.status === 'complete');
  const staffListId   = 'comms-staff-list';

  return (
    <div className={`comms-job-card comms-job-card--${job.status}${open ? ' comms-job-card--expanded' : ''}${overdue ? ' comms-job-card--overdue' : ''}`}>
      {/* ── Header ── */}
      <button
        type="button"
        className="comms-job-card__header"
        onClick={handleToggle}
        aria-expanded={open}
        aria-controls={cardDetailId}
      >
        <div className="comms-job-card__left">
          <div className="comms-job-card__site">
            {job.site_code} · {job.site_name ?? job.client}
            {job.job_number ? ` · Job #${job.job_number}` : ''}
          </div>
          <div className="comms-job-card__desc">{job.description ?? '—'}</div>
          <div className="comms-job-card__meta">
            <span>{STATUS_LABELS[job.status]}</span>
            {overdue && (
              <span className="comms-overdue-badge"><AlertCircle size={10} /> Overdue</span>
            )}
            {job.client !== 'Microsoft' && <span className="comms-client-tag">{job.client}</span>}
            {job.total_hours > 0 && <span>{Math.round(job.total_hours)}h</span>}
            {job.line_count > 1 && <span>{job.line_count} PO lines</span>}
            {job.target_completion && <span>Target: {job.target_completion}</span>}
          </div>
        </div>
        <div className="comms-job-card__right">
          <div className="comms-job-card__value">{fmtMoney(job.total_value)}</div>
          {job.assigned_to
            ? <span className="comms-assigned">{job.assigned_to}</span>
            : <span className="comms-unassigned">Unassigned</span>}
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {/* ── Milestone pills ── */}
      <div className="comms-milestones">
        <MilestonePill label="MOP"       fullLabel="MOP received"   done={job.mop_received}   canEdit={canEdit} onClick={() => toggleMilestone('mop_received')} />
        <MilestonePill label="Pre-cable" fullLabel="Pre-cable done" done={job.pre_cable_done} canEdit={canEdit} onClick={() => toggleMilestone('pre_cable_done')} />
        <MilestonePill label="Post-dock" fullLabel="Post-dock done" done={job.post_dock_done} canEdit={canEdit} onClick={() => toggleMilestone('post_dock_done')} />
        <MilestonePill label="Invoiced"  fullLabel="Invoice raised" done={job.invoice_raised} canEdit={canEdit} onClick={() => toggleMilestone('invoice_raised')} />
        {invoiceNeeded && !job.invoice_raised && (
          <span className="comms-invoice-flag comms-invoice-flag--needed">Invoice needed</span>
        )}
        {job.invoice_raised && job.total_invoiced > 0 && (
          <span className="comms-invoice-flag comms-invoice-flag--raised">
            {fmtMoney(job.total_invoiced)} invoiced
          </span>
        )}
      </div>

      {saveError && <div className="comms-save-error" role="alert">{saveError}</div>}

      {/* ── Expanded detail ── */}
      {open && (
        <div id={cardDetailId}>
          {/* Sub-tabs */}
          <div className="comms-detail-tabs" role="tablist" aria-label="Job details">
            {(['lines', 'history'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                type="button"
                aria-selected={tab === t}
                aria-controls={tabPanelId}
                className={`comms-detail-tab${tab === t ? ' comms-detail-tab--active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'lines' ? 'PO Lines' : 'History'}
              </button>
            ))}
          </div>

          <div id={tabPanelId} role="tabpanel" className="comms-job-card__detail">
            {loading && <div className="comms-loading" style={{ padding: '12px 0' }}>Loading…</div>}

            {/* PO lines tab */}
            {tab === 'lines' && !loading && (
              <>
                {lines && lines.length > 0 && (
                  <div className="comms-lines-scroll">
                    <table className="comms-lines-table">
                      <thead>
                        <tr>
                          <th>PO #</th>
                          <th>FID #</th>
                          <th>Description</th>
                          <th>Quote</th>
                          <th>Requestor</th>
                          <th>Approved</th>
                          <th className="num">Hours</th>
                          <th className="num">Materials</th>
                          <th className="num">Value</th>
                          <th className="num">Invoice #</th>
                          <th className="num">Invoiced</th>
                          {canEdit && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => (
                          <Fragment key={l.line_id}>
                            <tr className={editLineId === l.line_id ? 'comms-line-row--editing' : ''}>
                              <td>{l.po_number ?? '—'}</td>
                              <td>{l.fid_number ?? '—'}</td>
                              <td>{l.description}</td>
                              <td>{l.quote_number ?? '—'}</td>
                              <td>{l.requestor ?? '—'}</td>
                              <td>{l.date_approval ? l.date_approval.slice(0, 10) : '—'}</td>
                              <td className="num">{l.hours ?? '—'}</td>
                              <td className="num">{fmtMoney(l.materials_cost)}</td>
                              <td className="num">{fmtMoney(l.price_ex_gst)}</td>
                              <td className="num">{l.invoice_number ?? '—'}</td>
                              <td className="num">{l.invoiced_amount != null ? fmtMoney(l.invoiced_amount) : '—'}</td>
                              {canEdit && (
                                <td className="comms-line-actions">
                                  {deleteLineId === l.line_id ? (
                                    <>
                                      <span className="comms-line-delete-confirm">Remove?</span>
                                      <button type="button" className="comms-line-edit-btn" onClick={confirmDeleteLine} disabled={deletingLine} aria-label="Confirm delete">
                                        <Check size={12} />
                                      </button>
                                      <button type="button" className="comms-line-edit-btn" onClick={() => setDeleteLineId(null)} aria-label="Cancel delete">
                                        <X size={12} />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button type="button" className="comms-line-edit-btn" onClick={() => startLineEdit(l)} aria-label={`Edit ${l.description}`}>
                                        <Pencil size={12} />
                                      </button>
                                      <button type="button" className="comms-line-edit-btn comms-line-edit-btn--danger" onClick={() => { cancelLineEdit(); setDeleteLineId(l.line_id); }} aria-label={`Delete ${l.description}`}>
                                        <Trash2 size={12} />
                                      </button>
                                    </>
                                  )}
                                </td>
                              )}
                            </tr>
                            {editLineId === l.line_id && lineEditForm && (
                              <tr className="comms-line-edit-row">
                                <td colSpan={canEdit ? 12 : 11}>
                                  <div className="comms-line-edit-form">
                                    <div className="comms-line-edit-form__row">
                                      <div className="comms-edit-field comms-edit-field--grow">
                                        <label>Description *</label>
                                        <input type="text" value={lineEditForm.description} onChange={(e) => setLineEditForm((f) => f ? { ...f, description: e.target.value } : f)} />
                                      </div>
                                      <div className="comms-edit-field"><label>PO #</label><input type="text" value={lineEditForm.po_number} onChange={(e) => setLineEditForm((f) => f ? { ...f, po_number: e.target.value } : f)} /></div>
                                      <div className="comms-edit-field"><label>FID #</label><input type="text" value={lineEditForm.fid_number} onChange={(e) => setLineEditForm((f) => f ? { ...f, fid_number: e.target.value } : f)} /></div>
                                      <div className="comms-edit-field"><label>Requestor</label><input type="text" value={lineEditForm.requestor} onChange={(e) => setLineEditForm((f) => f ? { ...f, requestor: e.target.value } : f)} /></div>
                                      <div className="comms-edit-field"><label>Quote #</label><input type="text" value={lineEditForm.quote_number} onChange={(e) => setLineEditForm((f) => f ? { ...f, quote_number: e.target.value } : f)} /></div>
                                      <div className="comms-edit-field"><label>Date approved</label><input type="date" value={lineEditForm.date_approval} onChange={(e) => setLineEditForm((f) => f ? { ...f, date_approval: e.target.value } : f)} /></div>
                                    </div>
                                    <div className="comms-line-edit-form__row">
                                      <div className="comms-edit-field comms-edit-field--num"><label>Hours</label><input type="number" min="0" step="0.5" value={lineEditForm.hours} onChange={(e) => setLineEditForm((f) => f ? { ...f, hours: e.target.value } : f)} placeholder="0" /></div>
                                      <div className="comms-edit-field comms-edit-field--num"><label>Materials ex-GST</label><input type="number" min="0" step="0.01" value={lineEditForm.materials_cost} onChange={(e) => setLineEditForm((f) => f ? { ...f, materials_cost: e.target.value } : f)} placeholder="0.00" /></div>
                                      <div className="comms-edit-field comms-edit-field--num"><label>Value ex-GST</label><input type="number" min="0" step="0.01" value={lineEditForm.price_ex_gst} onChange={(e) => setLineEditForm((f) => f ? { ...f, price_ex_gst: e.target.value } : f)} placeholder="0.00" /></div>
                                      <div className="comms-edit-field"><label>Invoice #</label><input type="text" value={lineEditForm.invoice_number} onChange={(e) => setLineEditForm((f) => f ? { ...f, invoice_number: e.target.value } : f)} placeholder="Inv #" /></div>
                                      <div className="comms-edit-field comms-edit-field--num"><label>Invoiced amount</label><input type="number" min="0" step="0.01" value={lineEditForm.invoiced_amount} onChange={(e) => setLineEditForm((f) => f ? { ...f, invoiced_amount: e.target.value } : f)} placeholder="0.00" /></div>
                                      <div className="comms-edit-field comms-edit-field--grow"><label>Complete notes</label><input type="text" value={lineEditForm.complete_notes} onChange={(e) => setLineEditForm((f) => f ? { ...f, complete_notes: e.target.value } : f)} /></div>
                                    </div>
                                    <div className="comms-line-edit-form__actions">
                                      <button type="button" className="comms-save-btn comms-save-btn--sm" onClick={saveLineEdit} disabled={savingLine}>{savingLine ? 'Saving…' : 'Save changes'}</button>
                                      <button type="button" className="comms-cancel-btn comms-cancel-btn--sm" onClick={cancelLineEdit}>Cancel</button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {lines && lines.length === 0 && (
                  <div style={{ color: 'var(--eq-ink-40)', fontSize: '0.8rem' }}>No PO lines recorded.</div>
                )}

                {canEdit && !showAddLine && (
                  <button type="button" className="comms-add-line-btn" onClick={() => setShowAddLine(true)}>
                    <Plus size={13} /> Add PO line
                  </button>
                )}
                {canEdit && showAddLine && (
                  <AddLineForm
                    jobId={job.job_id}
                    onAdded={(line) => {
                      setLines((prev) => (prev ? [...prev, line] : [line]));
                      setShowAddLine(false);
                      fetchDetail(true);
                    }}
                    onCancel={() => setShowAddLine(false)}
                  />
                )}
              </>
            )}

            {/* History tab */}
            {tab === 'history' && !loading && (
              <div className="comms-history">
                {events.length === 0 && (
                  <div style={{ color: 'var(--eq-ink-40)', fontSize: '0.8rem' }}>No activity recorded yet.</div>
                )}
                {events.map((ev) => (
                  <div key={ev.event_id} className="comms-history__row">
                    <span className="comms-history__date">{fmtDate(ev.created_at)}</span>
                    <span className="comms-history__note">{ev.note ?? ev.action}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Edit bar ── */}
          {canEdit && (
            <div className="comms-edit-bar">
              {/* Row 1: operational */}
              <div className="comms-edit-bar__row">
                <div className="comms-edit-field">
                  <label htmlFor={`${cardId}-status`}>Status</label>
                  <select
                    id={`${cardId}-status`}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as JobStatus)}
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div className="comms-edit-field comms-edit-field--grow">
                  <label htmlFor={`${cardId}-assigned`}>Assigned to</label>
                  <input
                    id={`${cardId}-assigned`}
                    type="text"
                    list={staffListId}
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    placeholder="Tech name"
                  />
                </div>
                <div className="comms-edit-field comms-edit-field--grow2">
                  <label htmlFor={`${cardId}-notes`}>Notes</label>
                  <input
                    id={`${cardId}-notes`}
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. 3 racks damaged, awaiting replacements"
                  />
                </div>
                {status === 'on_hold' && (
                  <div className="comms-edit-field">
                    <label htmlFor={`${cardId}-hold-since`}>On hold since</label>
                    <input
                      id={`${cardId}-hold-since`}
                      type="date"
                      value={onHoldSince}
                      onChange={(e) => setOnHoldSince(e.target.value)}
                    />
                  </div>
                )}
              </div>
              {/* Row 2: header fields */}
              <div className="comms-edit-bar__row comms-edit-bar__row--header">
                <div className="comms-edit-field">
                  <label htmlFor={`${cardId}-site-code`}>Site code</label>
                  <input
                    id={`${cardId}-site-code`}
                    type="text"
                    value={siteCode}
                    onChange={(e) => setSiteCode(e.target.value)}
                    placeholder="SYD27"
                  />
                </div>
                <div className="comms-edit-field comms-edit-field--grow">
                  <label htmlFor={`${cardId}-site-name`}>Site name</label>
                  <input
                    id={`${cardId}-site-name`}
                    type="text"
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    placeholder="Equinix SY9"
                  />
                </div>
                <div className="comms-edit-field">
                  <label htmlFor={`${cardId}-client`}>Client</label>
                  <input
                    id={`${cardId}-client`}
                    type="text"
                    value={client}
                    onChange={(e) => setClient(e.target.value)}
                    placeholder="Microsoft"
                  />
                </div>
                <div className="comms-edit-field">
                  <label htmlFor={`${cardId}-job-number`}>Job #</label>
                  <input
                    id={`${cardId}-job-number`}
                    type="text"
                    value={jobNumber}
                    onChange={(e) => setJobNumber(e.target.value)}
                    placeholder="SKS-1234"
                  />
                </div>
                <div className="comms-edit-field comms-edit-field--grow2">
                  <label htmlFor={`${cardId}-desc`}>Description</label>
                  <input
                    id={`${cardId}-desc`}
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Job description"
                  />
                </div>
                <div className="comms-edit-field">
                  <label htmlFor={`${cardId}-start`}>Start date</label>
                  <input
                    id={`${cardId}-start`}
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="comms-edit-field">
                  <label htmlFor={`${cardId}-target`}>Target completion</label>
                  <input
                    id={`${cardId}-target`}
                    type="date"
                    value={targetCompletion}
                    onChange={(e) => setTargetCompletion(e.target.value)}
                  />
                </div>
              </div>
              <div className="comms-edit-bar__row comms-edit-bar__row--actions">
                <button
                  type="button"
                  className="comms-save-btn"
                  onClick={saveEdits}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main module ───────────────────────────────────────────────────────────────

export default function CommsModule() {
  const session = useSession();
  const canEdit = useCan(COMMS_UPDATE_PERM);

  const [jobs, setJobs]       = useState<CommsJob[]>([]);
  const [staff, setStaff]     = useState<StaffMember[]>([]);
  const [tab, setTab]         = useState<TabKey>('active');
  const [search, setSearch]   = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch('/.netlify/functions/comms-jobs', { credentials: 'include' }).then((r) => r.json()),
      fetch('/.netlify/functions/comms-jobs?resource=staff', { credentials: 'include' }).then((r) => r.json()),
    ])
      .then(([jobsData, staffData]) => {
        if (jobsData.ok) setJobs(jobsData.jobs);
        else setError(
          jobsData.error === 'not_found'
            ? 'This module is not available for your account.'
            : (jobsData.error ?? 'Failed to load jobs'),
        );
        if (staffData.ok) setStaff(staffData.staff ?? []);
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, []);

  const handleJobUpdated = useCallback((updated: Partial<CommsJob> & { job_id: string }) => {
    setJobs((prev) => prev.map((j) => (j.job_id === updated.job_id ? { ...j, ...updated } : j)));
  }, []);

  const handleJobCreated = useCallback((job: CommsJob) => {
    setJobs((prev) => [job, ...prev]);
    setShowCreate(false);
    setTab('all');
  }, []);

  const tabFiltered  = tab === 'all' ? jobs : jobs.filter((j) => j.status === tab);
  const filtered     = search ? tabFiltered.filter((j) => matchesSearch(j, search)) : tabFiltered;

  const counts: Partial<Record<TabKey, number>> = { all: jobs.length };
  for (const j of jobs) counts[j.status] = (counts[j.status] ?? 0) + 1;

  const activeJobs    = jobs.filter((j) => j.status === 'active');
  const totalActive   = activeJobs.reduce((s, j) => s + j.total_value, 0);
  const totalInvoiced = activeJobs.reduce((s, j) => s + j.total_invoiced, 0);
  const uninvoiced    = activeJobs.filter((j) => j.post_dock_done && !j.invoice_raised).length;
  const unassigned    = activeJobs.filter((j) => !j.assigned_to).length;
  const overdueCount  = jobs.filter(isJobOverdue).length;

  if (!session) return null;

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      {/* Staff datalist — available to all JobCard inputs in this tree */}
      <datalist id="comms-staff-list">
        {staff.map((s) => <option key={s.id} value={s.name} />)}
      </datalist>

      {/* ── Page header ── */}
      <div className="comms-header">
        <div>
          <h1 className="comms-header__title">NSW Comms — Job Pipeline</h1>
          <div className="comms-header__sub">Microsoft / Equinix NSW jobs · SKS Technologies</div>
        </div>
        <div className="comms-header__actions">
          <div className="comms-search">
            <Search size={14} className="comms-search__icon" aria-hidden="true" />
            <input
              type="search"
              className="comms-search__input"
              placeholder="Search site, job #, client…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search jobs"
            />
          </div>
          <button
            type="button"
            className="comms-icon-btn"
            onClick={() => exportCSV(filtered)}
            title="Export current view to CSV"
            aria-label="Export to CSV"
          >
            <Download size={15} />
          </button>
          {canEdit && (
            <button
              type="button"
              className="comms-save-btn"
              onClick={() => setShowCreate((v) => !v)}
            >
              <Plus size={14} /> New job
            </button>
          )}
        </div>
      </div>

      {/* ── Create job form ── */}
      {showCreate && canEdit && (
        <CreateJobForm
          onCreated={handleJobCreated}
          onCancel={() => setShowCreate(false)}
          staffListId="comms-staff-list"
        />
      )}

      {/* ── KPI bar ── */}
      <div className="comms-kpi-bar">
        <div className="comms-kpi">
          <div className="comms-kpi__label">Active jobs</div>
          <div className="comms-kpi__value comms-kpi__value--sky">{activeJobs.length}</div>
        </div>
        <div className="comms-kpi">
          <div className="comms-kpi__label">Active value</div>
          <div className="comms-kpi__value">{fmtMoney(totalActive)}</div>
        </div>
        <div className="comms-kpi">
          <div className="comms-kpi__label">Invoiced</div>
          <div className="comms-kpi__value">{fmtMoney(totalInvoiced)}</div>
        </div>
        <div className="comms-kpi">
          <div className="comms-kpi__label">Invoice needed</div>
          <div className={`comms-kpi__value ${uninvoiced > 0 ? 'comms-kpi__value--amber' : ''}`}>{uninvoiced}</div>
        </div>
        <div className="comms-kpi">
          <div className="comms-kpi__label">Unassigned</div>
          <div className={`comms-kpi__value ${unassigned > 0 ? 'comms-kpi__value--red' : ''}`}>{unassigned}</div>
        </div>
        <div className="comms-kpi">
          <div className="comms-kpi__label">Overdue</div>
          <div className={`comms-kpi__value ${overdueCount > 0 ? 'comms-kpi__value--red' : ''}`}>{overdueCount}</div>
        </div>
      </div>

      {/* ── Monday brief ── */}
      {!loading && !error && <MondayBrief jobs={jobs} />}

      {/* ── Tabs ── */}
      <div className="comms-tabs" role="tablist" aria-label="Filter by status">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            className={`comms-tab${tab === t.key ? ' comms-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {(counts[t.key] ?? 0) > 0 && (
              <span className="comms-tab__count">{counts[t.key]}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      {loading && <div className="comms-loading">Loading jobs…</div>}
      {error   && <div className="comms-empty">{error}</div>}
      {!loading && !error && (
        <div className="comms-job-list">
          {filtered.length === 0 && (
            <div className="comms-empty">
              {search
                ? `No jobs matching "${search}".`
                : `No ${tab === 'all' ? '' : STATUS_LABELS[tab as JobStatus] + ' '}jobs found.`}
            </div>
          )}
          {filtered.map((job) => (
            <JobCard
              key={job.job_id}
              job={job}
              canEdit={canEdit}
              onJobUpdated={handleJobUpdated}
            />
          ))}
        </div>
      )}
    </HubLayout>
  );
}
