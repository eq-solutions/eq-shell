import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Circle } from 'lucide-react';
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
  if (!n) return '—';
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

// ── Milestone toggle ─────────────────────────────────────────────────────────

function MilestonePill({
  label,
  done,
  canEdit,
  onClick,
}: {
  label: string;
  done: boolean;
  canEdit: boolean;
  onClick?: () => void;
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
      title={canEdit ? (done ? 'Mark as not done' : 'Mark as done') : undefined}
    >
      {done ? <CheckCircle2 size={11} /> : <Circle size={11} />}
      {label}
    </button>
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
  const [open, setOpen]   = useState(false);
  const [lines, setLines] = useState<PoLine[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Edit state
  const [assignedTo, setAssignedTo]   = useState(job.assigned_to ?? '');
  const [notes, setNotes]             = useState(job.notes ?? '');
  const [saving, setSaving]           = useState(false);

  const fetchLines = useCallback(async () => {
    if (lines !== null) return;
    setLoading(true);
    try {
      const res = await fetch(`/.netlify/functions/comms-jobs?id=${job.job_id}`, { credentials: 'include' });
      const data = await res.json();
      if (data.ok) setLines(data.lines);
    } finally {
      setLoading(false);
    }
  }, [job.job_id, lines]);

  const handleToggle = () => {
    setOpen((v) => !v);
    if (!open) fetchLines();
  };

  const patchJob = useCallback(async (patch: Partial<CommsJob>) => {
    setSaving(true);
    try {
      const res = await fetch('/.netlify/functions/comms-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id, patch }),
      });
      const data = await res.json();
      if (data.ok) onJobUpdated({ ...job, ...patch });
    } finally {
      setSaving(false);
    }
  }, [job, onJobUpdated]);

  const toggleMilestone = (field: 'mop_received' | 'pre_cable_done' | 'post_dock_done' | 'invoice_raised') => {
    patchJob({ [field]: !job[field] });
  };

  const saveAssignment = () => {
    patchJob({ assigned_to: assignedTo || null, notes: notes || null });
  };

  const invoiceNeeded = job.total_value > 0 && !job.invoice_raised && (job.post_dock_done || job.status === 'complete');

  return (
    <div className={`comms-job-card comms-job-card--${job.status}`}>
      {/* ── Header row ── */}
      <div className="comms-job-card__header" onClick={handleToggle}>
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
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {/* ── Milestone pills ── */}
      <div className="comms-milestones">
        <MilestonePill label="MOP" done={job.mop_received} canEdit={canEdit} onClick={() => toggleMilestone('mop_received')} />
        <MilestonePill label="Pre-cable" done={job.pre_cable_done} canEdit={canEdit} onClick={() => toggleMilestone('pre_cable_done')} />
        <MilestonePill label="Post-dock" done={job.post_dock_done} canEdit={canEdit} onClick={() => toggleMilestone('post_dock_done')} />
        <MilestonePill label="Invoiced" done={job.invoice_raised} canEdit={canEdit} onClick={() => toggleMilestone('invoice_raised')} />
        {invoiceNeeded && !job.invoice_raised && (
          <span className="comms-invoice-flag comms-invoice-flag--needed">Invoice needed</span>
        )}
        {job.invoice_raised && job.total_invoiced > 0 && (
          <span className="comms-invoice-flag comms-invoice-flag--raised">
            {fmtMoney(job.total_invoiced)} invoiced
          </span>
        )}
      </div>

      {/* ── Expanded detail ── */}
      {open && (
        <>
          <div className="comms-job-card__detail">
            {loading && <div className="comms-loading" style={{ padding: '12px 0' }}>Loading…</div>}
            {lines && lines.length > 0 && (
              <table className="comms-lines-table">
                <thead>
                  <tr>
                    <th>PO #</th>
                    <th>Description</th>
                    <th>Quote</th>
                    <th>Requestor</th>
                    <th className="num">Hours</th>
                    <th className="num">Value</th>
                    <th className="num">Invoiced</th>
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
                      <td className="num">{l.invoiced_amount ? fmtMoney(l.invoiced_amount) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {lines && lines.length === 0 && (
              <div style={{ color: 'var(--eq-ink-40)', fontSize: '0.8rem' }}>No PO lines recorded.</div>
            )}
          </div>

          {/* ── Edit bar (managers + supervisors only) ── */}
          {canEdit && (
            <div className="comms-edit-bar">
              <div className="comms-edit-field">
                <label>Assigned to</label>
                <input
                  type="text"
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  placeholder="Tech name"
                />
              </div>
              <div className="comms-edit-field" style={{ flex: 2 }}>
                <label>Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. 3 racks damaged, awaiting replacements"
                />
              </div>
              <button
                type="button"
                className="comms-save-btn"
                onClick={saveAssignment}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main module ───────────────────────────────────────────────────────────────

export default function CommsModule() {
  const session  = useSession();
  const canEdit  = useCan(COMMS_UPDATE_PERM);

  const [jobs, setJobs]   = useState<CommsJob[]>([]);
  const [tab, setTab]     = useState<TabKey>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/.netlify/functions/comms-jobs', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setJobs(d.jobs);
        else setError(d.error ?? 'Failed to load jobs');
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, []);

  const handleJobUpdated = useCallback((updated: CommsJob) => {
    setJobs((prev) => prev.map((j) => (j.job_id === updated.job_id ? { ...j, ...updated } : j)));
  }, []);

  const filtered = tab === 'all' ? jobs : jobs.filter((j) => j.status === tab);

  // Counts per tab
  const counts: Partial<Record<TabKey, number>> = { all: jobs.length };
  for (const j of jobs) counts[j.status] = (counts[j.status] ?? 0) + 1;

  // KPIs
  const activeJobs  = jobs.filter((j) => j.status === 'active');
  const totalActive = activeJobs.reduce((s, j) => s + j.total_value, 0);
  const totalInvoiced = activeJobs.reduce((s, j) => s + j.total_invoiced, 0);
  const uninvoiced    = activeJobs.filter((j) => j.post_dock_done && !j.invoice_raised).length;
  const unassigned    = activeJobs.filter((j) => !j.assigned_to).length;

  if (!session) return null;

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      {/* ── Page header ── */}
      <div className="comms-header">
        <div>
          <h1 className="comms-header__title">NSW Comms — Job Pipeline</h1>
          <div className="comms-header__sub">Microsoft / Equinix NSW jobs · SKS Technologies</div>
        </div>
      </div>

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
      </div>

      {/* ── Tabs ── */}
      <div className="comms-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
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
            <div className="comms-empty">No {tab === 'all' ? '' : STATUS_LABELS[tab as JobStatus] + ' '}jobs found.</div>
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
