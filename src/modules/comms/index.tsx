import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Circle, AlertTriangle, Plus, X } from 'lucide-react';
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
  mop_received:      boolean;
  pre_cable_done:    boolean;
  post_dock_done:    boolean;
  invoice_raised:    boolean;
  notes:             string | null;
  total_value:       number;
  total_invoiced:    number;
  total_hours:       number;
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

type TabKey = 'all' | JobStatus;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n === 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}k`;
  return `$${n.toLocaleString()}`;
}

const STATUS_LABELS: Record<JobStatus, string> = {
  quoted:   'Quoted',
  active:   'Active',
  on_hold:  'On Hold',
  complete: 'Complete',
  closed:   'Closed',
};

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'active',   label: 'Active' },
  { key: 'quoted',   label: 'Quoted' },
  { key: 'on_hold',  label: 'On Hold' },
  { key: 'complete', label: 'Complete' },
];

// ── Monday brief ─────────────────────────────────────────────────────────────

function MondayBrief({ jobs }: { jobs: CommsJob[] }) {
  const readyToInvoice   = jobs.filter((j) => j.post_dock_done && !j.invoice_raised && j.total_value > 0 && j.status !== 'closed');
  const unassignedActive = jobs.filter((j) => j.status === 'active' && !j.assigned_to);
  const longOnHold       = jobs.filter((j) => j.status === 'on_hold');

  const total = readyToInvoice.length + unassignedActive.length + longOnHold.length;
  if (total === 0) return null;

  return (
    <div className="comms-brief" aria-label="Action items">
      <div className="comms-brief__header">
        <AlertTriangle size={14} aria-hidden="true" />
        <span>{total} action{total !== 1 ? 's' : ''} needed</span>
      </div>
      {readyToInvoice.map((j) => (
        <div key={j.job_id} className="comms-brief__item comms-brief__item--invoice">
          <strong>{j.site_code}{j.job_number ? ` #${j.job_number}` : ''}</strong>
          {j.description ? ` — ${j.description}` : ''}
          <span className="comms-brief__value">Invoice {fmtMoney(j.total_value - j.total_invoiced)} outstanding</span>
        </div>
      ))}
      {unassignedActive.map((j) => (
        <div key={j.job_id} className="comms-brief__item comms-brief__item--assign">
          <strong>{j.site_code}{j.job_number ? ` #${j.job_number}` : ''}</strong>
          {j.description ? ` — ${j.description}` : ''}
          <span className="comms-brief__value">Unassigned · {fmtMoney(j.total_value)}</span>
        </div>
      ))}
      {longOnHold.map((j) => (
        <div key={j.job_id} className="comms-brief__item comms-brief__item--hold">
          <strong>{j.site_code}</strong>
          {j.description ? ` — ${j.description}` : ''}
          <span className="comms-brief__value">On hold · {fmtMoney(j.total_value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Milestone toggle ─────────────────────────────────────────────────────────

function MilestonePill({
  label,
  fullLabel,
  done,
  canEdit,
  onClick,
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
        done ? 'comms-milestone--done' : 'comms-milestone--pending',
        canEdit ? 'comms-milestone--clickable' : '',
      ].join(' ')}
      onClick={canEdit ? onClick : undefined}
      aria-label={`${fullLabel}: ${done ? 'complete' : 'pending'}${canEdit ? '. Click to toggle' : ''}`}
      aria-pressed={done}
    >
      {done ? <CheckCircle2 size={11} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />}
      {label}
    </button>
  );
}

// ── Add PO line form ─────────────────────────────────────────────────────────

interface NewLineState {
  po_number:    string;
  description:  string;
  requestor:    string;
  quote_number: string;
  hours:        string;
  price_ex_gst: string;
}

const EMPTY_LINE: NewLineState = {
  po_number: '', description: '', requestor: '', quote_number: '', hours: '', price_ex_gst: '',
};

function AddLineForm({ jobId, onAdded, onCancel }: { jobId: string; onAdded: () => void; onCancel: () => void }) {
  const [line, setLine]     = useState<NewLineState>(EMPTY_LINE);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const set = (k: keyof NewLineState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setLine((prev) => ({ ...prev, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!line.description.trim()) { setError('Description is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/.netlify/functions/comms-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          line: {
            po_number:    line.po_number.trim()    || null,
            description:  line.description.trim(),
            requestor:    line.requestor.trim()    || null,
            quote_number: line.quote_number.trim() || null,
            hours:        line.hours        ? parseFloat(line.hours)        : null,
            price_ex_gst: line.price_ex_gst ? parseFloat(line.price_ex_gst) : null,
          },
        }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? 'Failed to add line'); return; }
      onAdded();
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="comms-add-line-form" onSubmit={handleSubmit} aria-label="Add PO line">
      <div className="comms-add-line-form__row">
        <div className="comms-edit-field">
          <label htmlFor={`po-${jobId}`}>PO number</label>
          <input id={`po-${jobId}`} type="text" value={line.po_number} onChange={set('po_number')} placeholder="e.g. 0101653687" />
        </div>
        <div className="comms-edit-field comms-edit-field--grow">
          <label htmlFor={`desc-${jobId}`}>Description <span aria-hidden="true">*</span></label>
          <input id={`desc-${jobId}`} type="text" value={line.description} onChange={set('description')} placeholder="Work description" required />
        </div>
        <div className="comms-edit-field">
          <label htmlFor={`req-${jobId}`}>Requestor</label>
          <input id={`req-${jobId}`} type="text" value={line.requestor} onChange={set('requestor')} placeholder="e.g. AJ" />
        </div>
        <div className="comms-edit-field">
          <label htmlFor={`quote-${jobId}`}>Quote #</label>
          <input id={`quote-${jobId}`} type="text" value={line.quote_number} onChange={set('quote_number')} placeholder="SKS quote ref" />
        </div>
        <div className="comms-edit-field comms-edit-field--num">
          <label htmlFor={`hours-${jobId}`}>Hours</label>
          <input id={`hours-${jobId}`} type="number" min="0" step="0.5" value={line.hours} onChange={set('hours')} placeholder="0" />
        </div>
        <div className="comms-edit-field comms-edit-field--num">
          <label htmlFor={`value-${jobId}`}>Value ex GST</label>
          <input id={`value-${jobId}`} type="number" min="0" step="0.01" value={line.price_ex_gst} onChange={set('price_ex_gst')} placeholder="0.00" />
        </div>
      </div>
      {error && <div className="comms-add-line-form__error" role="alert">{error}</div>}
      <div className="comms-add-line-form__actions">
        <button type="submit" className="comms-save-btn" disabled={saving}>
          {saving ? 'Adding…' : 'Add line'}
        </button>
        <button type="button" className="comms-cancel-btn" onClick={onCancel}>
          <X size={13} aria-hidden="true" /> Cancel
        </button>
      </div>
    </form>
  );
}

// ── Job card ─────────────────────────────────────────────────────────────────

function JobCard({
  job,
  canEdit,
  onJobUpdated,
}: {
  job: CommsJob;
  canEdit: boolean;
  onJobUpdated: (updated: CommsJob) => void;
}) {
  const cardDetailId = `comms-card-detail-${job.job_id}`;
  const [open, setOpen]         = useState(false);
  const [lines, setLines]       = useState<PoLine[] | null>(null);
  const [loading, setLoading]   = useState(false);
  const [showAddLine, setShowAddLine] = useState(false);

  const [assignedTo, setAssignedTo] = useState(job.assigned_to ?? '');
  const [notes, setNotes]           = useState(job.notes ?? '');
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);

  const fetchLines = useCallback(async (force = false) => {
    if (!force && lines !== null) return;
    setLoading(true);
    try {
      const res = await fetch(`/.netlify/functions/comms-jobs?id=${job.job_id}`, { credentials: 'include' });
      const data = await res.json();
      if (data.ok) {
        setLines(data.lines);
        onJobUpdated({ ...job, ...data.job });
      }
    } finally {
      setLoading(false);
    }
  }, [job, onJobUpdated]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && lines === null) fetchLines();
  };

  const patchJob = useCallback(async (patch: Partial<CommsJob>) => {
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
        onJobUpdated({ ...job, ...patch });
      } else {
        setSaveError(data.error ?? 'Failed to save');
      }
    } catch {
      setSaveError('Network error — changes not saved');
    } finally {
      setSaving(false);
    }
  }, [job, onJobUpdated]);

  const toggleMilestone = (field: 'mop_received' | 'pre_cable_done' | 'post_dock_done' | 'invoice_raised') => {
    patchJob({ [field]: !job[field] });
  };

  const saveAssignment = () => {
    patchJob({ assigned_to: assignedTo.trim() || null, notes: notes.trim() || null });
  };

  const invoiceNeeded = job.total_value > 0 && !job.invoice_raised &&
    (job.post_dock_done || job.status === 'complete');

  return (
    <div className={`comms-job-card comms-job-card--${job.status}`}>
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
          {open
            ? <ChevronDown size={14} aria-hidden="true" />
            : <ChevronRight size={14} aria-hidden="true" />}
        </div>
      </button>

      {/* ── Milestone pills ── */}
      <div className="comms-milestones">
        <MilestonePill label="MOP"       fullLabel="Method of Procedure received" done={job.mop_received}   canEdit={canEdit} onClick={() => toggleMilestone('mop_received')} />
        <MilestonePill label="Pre-cable" fullLabel="Pre-cable works complete"      done={job.pre_cable_done} canEdit={canEdit} onClick={() => toggleMilestone('pre_cable_done')} />
        <MilestonePill label="Post-dock" fullLabel="Post-dock works complete"      done={job.post_dock_done} canEdit={canEdit} onClick={() => toggleMilestone('post_dock_done')} />
        <MilestonePill label="Invoiced"  fullLabel="Invoice raised"                done={job.invoice_raised} canEdit={canEdit} onClick={() => toggleMilestone('invoice_raised')} />
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
        <div id={cardDetailId} className="comms-job-card__detail">
          {loading && <div className="comms-loading comms-loading--inline">Loading…</div>}

          {!loading && lines && lines.length > 0 && (
            <div className="comms-lines-scroll">
              <table className="comms-lines-table" aria-label="PO lines">
                <thead>
                  <tr>
                    <th scope="col">PO #</th>
                    <th scope="col">Description</th>
                    <th scope="col">Quote</th>
                    <th scope="col">Requestor</th>
                    <th scope="col" className="num">Hours</th>
                    <th scope="col" className="num">Value</th>
                    <th scope="col" className="num">Invoiced</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.line_id}>
                      <td>{l.po_number ?? '—'}</td>
                      <td>{l.description}</td>
                      <td>{l.quote_number ?? '—'}</td>
                      <td>{l.requestor ?? '—'}</td>
                      <td className="num">{l.hours ?? '—'}</td>
                      <td className="num">{fmtMoney(l.price_ex_gst)}</td>
                      <td className="num">{l.invoiced_amount != null ? fmtMoney(l.invoiced_amount) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && lines && lines.length === 0 && (
            <div className="comms-lines-empty">No PO lines recorded.</div>
          )}

          {canEdit && (
            <div className="comms-add-line-section">
              {showAddLine ? (
                <AddLineForm
                  jobId={job.job_id}
                  onAdded={() => { setShowAddLine(false); fetchLines(true); }}
                  onCancel={() => setShowAddLine(false)}
                />
              ) : (
                <button type="button" className="comms-add-line-btn" onClick={() => setShowAddLine(true)}>
                  <Plus size={13} aria-hidden="true" /> Add PO line
                </button>
              )}
            </div>
          )}

          {canEdit && (
            <div className="comms-edit-bar">
              <div className="comms-edit-field comms-edit-field--grow">
                <label htmlFor={`assign-${job.job_id}`}>Assigned to</label>
                <input
                  id={`assign-${job.job_id}`}
                  type="text"
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  placeholder="Tech name"
                />
              </div>
              <div className="comms-edit-field comms-edit-field--grow2">
                <label htmlFor={`notes-${job.job_id}`}>Notes</label>
                <input
                  id={`notes-${job.job_id}`}
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. 3 racks damaged, awaiting replacements"
                />
              </div>
              <button type="button" className="comms-save-btn" onClick={saveAssignment} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
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
  const [tab, setTab]         = useState<TabKey>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/.netlify/functions/comms-jobs', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setJobs(d.jobs);
        else setError(
          d.error === 'not_found'
            ? 'This module is not available for your account.'
            : (d.error ?? 'Failed to load jobs'),
        );
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, []);

  const handleJobUpdated = useCallback((updated: CommsJob) => {
    setJobs((prev) => prev.map((j) => (j.job_id === updated.job_id ? { ...j, ...updated } : j)));
  }, []);

  const filtered = tab === 'all' ? jobs : jobs.filter((j) => j.status === tab);

  const counts: Partial<Record<TabKey, number>> = { all: jobs.length };
  for (const j of jobs) counts[j.status] = (counts[j.status] ?? 0) + 1;

  const activeJobs    = jobs.filter((j) => j.status === 'active');
  const totalActive   = activeJobs.reduce((s, j) => s + j.total_value, 0);
  const totalInvoiced = jobs.reduce((s, j) => s + j.total_invoiced, 0);
  const uninvoiced    = jobs.filter((j) => j.post_dock_done && !j.invoice_raised && j.status !== 'closed').length;
  const unassigned    = activeJobs.filter((j) => !j.assigned_to).length;

  const tabPanelId = 'comms-tabpanel';

  if (!session) return null;

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <div className="comms-header">
        <div>
          <h1 className="comms-header__title">NSW Comms — Job Pipeline</h1>
          <div className="comms-header__sub">Microsoft / Equinix NSW jobs · SKS Technologies</div>
        </div>
      </div>

      <div className="comms-kpi-bar" aria-label="Summary">
        <div className="comms-kpi">
          <div className="comms-kpi__label">Active jobs</div>
          <div className="comms-kpi__value comms-kpi__value--sky">{activeJobs.length}</div>
        </div>
        <div className="comms-kpi">
          <div className="comms-kpi__label">Active value</div>
          <div className="comms-kpi__value">{fmtMoney(totalActive)}</div>
        </div>
        <div className="comms-kpi">
          <div className="comms-kpi__label">Total invoiced</div>
          <div className="comms-kpi__value">{fmtMoney(totalInvoiced)}</div>
        </div>
        <div className="comms-kpi">
          <div className="comms-kpi__label">Invoice needed</div>
          <div className={`comms-kpi__value${uninvoiced > 0 ? ' comms-kpi__value--amber' : ''}`}>{uninvoiced}</div>
        </div>
        <div className="comms-kpi">
          <div className="comms-kpi__label">Unassigned</div>
          <div className={`comms-kpi__value${unassigned > 0 ? ' comms-kpi__value--red' : ''}`}>{unassigned}</div>
        </div>
      </div>

      {!loading && !error && <MondayBrief jobs={jobs} />}

      <div className="comms-tabs" role="tablist" aria-label="Filter by status">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={tabPanelId}
            className={`comms-tab${tab === t.key ? ' comms-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {(counts[t.key] ?? 0) > 0 && (
              <span className="comms-tab__count" aria-label={`${counts[t.key]} jobs`}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <div className="comms-loading" role="status">Loading jobs…</div>}
      {error   && <div className="comms-empty"   role="alert">{error}</div>}
      {!loading && !error && (
        <div id={tabPanelId} role="tabpanel" className="comms-job-list">
          {filtered.length === 0 && (
            <div className="comms-empty">
              No {tab === 'all' ? '' : STATUS_LABELS[tab as JobStatus] + ' '}jobs found.
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
