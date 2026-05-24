// Jobs module — /:tenant/jobs
//
// Lists all canonical jobs for the tenant. Jobs are the FK target for
// Service work orders and Field timesheets. Created here or via Intake.
//
// Columns: external_id (Workbench job #), title, customer, site, status, dates.

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Gate } from '../../permissions/Gate';
import { HubLayout } from '../../components/HubLayout';
import { Skeleton } from '../../components/Skeleton';
import { EqError } from '../../components/EqError';
import { createSupabaseClient } from '../../lib/supabaseJwt';

interface Job {
  job_id: string;
  external_id: string | null;
  title: string | null;
  status: string;
  started_at: string | null;
  target_completion: string | null;
  customer_id: string | null;
  site_id: string | null;
  customers: { company_name: string | null } | null;
  sites: { name: string } | null;
}

interface CustomerOption { customer_id: string; company_name: string | null; }
interface SiteOption    { site_id: string; name: string; customer_id: string | null; }

const STATUS_OPTIONS = ['active', 'on_hold', 'complete', 'cancelled'] as const;
type JobStatus = (typeof STATUS_OPTIONS)[number];

const STATUS_LABELS: Record<JobStatus, string> = {
  active:    'Active',
  on_hold:   'On hold',
  complete:  'Complete',
  cancelled: 'Cancelled',
};

function statusPill(status: string) {
  const map: Record<string, string> = {
    active:    'eq-pill--ok',
    on_hold:   'eq-pill--warn',
    complete:  'eq-pill--info',
    cancelled: 'eq-pill',
  };
  return `eq-pill ${map[status] ?? 'eq-pill'}`;
}

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Create form ──────────────────────────────────────────────────────────────

interface CreateFormProps {
  customers: CustomerOption[];
  sites: SiteOption[];
  onCreated: (job: Job) => void;
  onCancel: () => void;
}

function CreateForm({ customers, sites, onCreated, onCancel }: CreateFormProps) {
  const [externalId, setExternalId] = useState('');
  const [title, setTitle] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState<JobStatus>('active');
  const [startedAt, setStartedAt] = useState('');
  const [targetCompletion, setTargetCompletion] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const filteredSites = customerId
    ? sites.filter(s => s.customer_id === customerId || !s.customer_id)
    : sites;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const sb = await createSupabaseClient();
      const payload: Record<string, unknown> = { status };
      if (externalId.trim()) payload.external_id = externalId.trim();
      if (title.trim())      payload.title = title.trim();
      if (customerId)        payload.customer_id = customerId;
      if (siteId)            payload.site_id = siteId;
      if (startedAt)         payload.started_at = startedAt;
      if (targetCompletion)  payload.target_completion = targetCompletion;
      payload.schema_version = '1.0.0';

      const { data, error } = await sb
        .schema('app_data')
        .from('jobs')
        .insert(payload)
        .select('*, customers(company_name), sites(name)')
        .single();

      if (error) { setErr(error.message); return; }
      onCreated(data as Job);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', height: 38, padding: '0 10px',
    border: '1px solid var(--eq-border)', borderRadius: 6,
    background: 'var(--eq-bg)', color: 'var(--eq-ink)', fontSize: 14,
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 600,
    color: 'var(--eq-grey)', textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 6,
  };

  return (
    <div style={{ background: 'var(--eq-ice)', border: '1px solid var(--eq-border)', borderRadius: 8, padding: 24, marginBottom: 24 }}>
      <h3 style={{ margin: '0 0 20px', fontSize: 16 }}>New job</h3>
      <form onSubmit={onSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Job number (external)</label>
            <input value={externalId} onChange={e => setExternalId(e.target.value)} placeholder="e.g. WB-12345" style={inputStyle} disabled={busy} />
          </div>
          <div>
            <label style={labelStyle}>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Brief description" style={inputStyle} disabled={busy} />
          </div>
          <div>
            <label style={labelStyle}>Customer</label>
            <select value={customerId} onChange={e => { setCustomerId(e.target.value); setSiteId(''); }} style={inputStyle} disabled={busy}>
              <option value="">— none —</option>
              {customers.map(c => (
                <option key={c.customer_id} value={c.customer_id}>
                  {c.company_name ?? c.customer_id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Site</label>
            <select value={siteId} onChange={e => setSiteId(e.target.value)} style={inputStyle} disabled={busy}>
              <option value="">— none —</option>
              {filteredSites.map(s => (
                <option key={s.site_id} value={s.site_id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as JobStatus)} style={inputStyle} disabled={busy}>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Start date</label>
            <input type="date" value={startedAt} onChange={e => setStartedAt(e.target.value)} style={inputStyle} disabled={busy} />
          </div>
          <div>
            <label style={labelStyle}>Target completion</label>
            <input type="date" value={targetCompletion} onChange={e => setTargetCompletion(e.target.value)} style={inputStyle} disabled={busy} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" className="eq-btn-primary" disabled={busy} style={{ width: 'auto', padding: '0 20px' }}>
            {busy ? 'Creating…' : 'Create job'}
          </button>
          <button type="button" className="eq-btn-ghost" onClick={onCancel} disabled={busy} style={{ width: 'auto', padding: '0 16px' }}>
            Cancel
          </button>
        </div>
        {err && <div className="eq-err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      </form>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

function JobsInner() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  void tenantSlug;

  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const sb = await createSupabaseClient();
      const [jobsRes, customersRes, sitesRes] = await Promise.all([
        sb.schema('app_data').from('jobs')
          .select('*, customers(company_name), sites(name)')
          .order('created_at', { ascending: false })
          .limit(500),
        sb.schema('app_data').from('customers')
          .select('customer_id, company_name')
          .eq('active', true)
          .order('company_name'),
        sb.schema('app_data').from('sites')
          .select('site_id, name, customer_id')
          .eq('active', true)
          .order('name'),
      ]);
      if (jobsRes.error)     throw new Error(jobsRes.error.message);
      if (customersRes.error) throw new Error(customersRes.error.message);
      if (sitesRes.error)    throw new Error(sitesRes.error.message);
      setJobs(jobsRes.data as Job[]);
      setCustomers(customersRes.data as CustomerOption[]);
      setSites(sitesRes.data as SiteOption[]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = (jobs ?? []).filter(j => {
    if (filterStatus && j.status !== filterStatus) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (j.external_id ?? '').toLowerCase().includes(q) ||
      (j.title ?? '').toLowerCase().includes(q) ||
      (j.customers?.company_name ?? '').toLowerCase().includes(q) ||
      (j.sites?.name ?? '').toLowerCase().includes(q)
    );
  });

  const counts = STATUS_OPTIONS.reduce((acc, s) => {
    acc[s] = (jobs ?? []).filter(j => j.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <HubLayout>
      <div className="eq-page__header">
        <div>
          <h1 className="eq-page__title">Jobs</h1>
          <p className="eq-page__lede">
            {loading ? 'Loading…' : `${jobs?.length ?? 0} jobs · FK target for Service work orders and Field timesheets`}
          </p>
        </div>
        <button
          type="button"
          className="eq-btn-primary"
          style={{ width: 'auto', padding: '0 20px', alignSelf: 'flex-start' }}
          onClick={() => setShowCreate(v => !v)}
        >
          {showCreate ? 'Cancel' : '+ New job'}
        </button>
      </div>

      {showCreate && (
        <CreateForm
          customers={customers}
          sites={sites}
          onCreated={(job) => {
            setJobs(prev => [job, ...(prev ?? [])]);
            setShowCreate(false);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {err && <EqError title="Couldn't load jobs" message={err} onRetry={load} />}

      {!err && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="search"
              placeholder="Search job #, title, customer, site…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: '1 1 260px', height: 36, padding: '0 12px', border: '1px solid var(--eq-border)', borderRadius: 6, background: 'var(--eq-bg)', color: 'var(--eq-ink)', fontSize: 14 }}
            />
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              style={{ height: 36, padding: '0 10px', border: '1px solid var(--eq-border)', borderRadius: 6, background: 'var(--eq-bg)', color: 'var(--eq-ink)', fontSize: 14 }}
            >
              <option value="">All statuses ({jobs?.length ?? 0})</option>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]} ({counts[s] ?? 0})</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} variant="text" width="100%" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="eq-empty">
              <p className="eq-empty__title">{search || filterStatus ? 'No matching jobs' : 'No jobs yet'}</p>
              <p>{search || filterStatus ? 'Try a different search or filter.' : 'Create a job above or import via Intake.'}</p>
            </div>
          ) : (
            <div className="eq-table-wrap">
              <table className="eq-table">
                <thead>
                  <tr>
                    <th>Job #</th>
                    <th>Title</th>
                    <th>Customer</th>
                    <th>Site</th>
                    <th>Status</th>
                    <th>Start</th>
                    <th>Target</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(j => (
                    <tr key={j.job_id}>
                      <td>
                        <code style={{ fontSize: 12, background: 'var(--eq-ice)', padding: '2px 6px', borderRadius: 4 }}>
                          {j.external_id ?? <span className="eq-table__mute">—</span>}
                        </code>
                      </td>
                      <td>{j.title ?? <span className="eq-table__mute">Untitled</span>}</td>
                      <td>{j.customers?.company_name ?? <span className="eq-table__mute">—</span>}</td>
                      <td>{j.sites?.name ?? <span className="eq-table__mute">—</span>}</td>
                      <td><span className={statusPill(j.status)}>{STATUS_LABELS[j.status as JobStatus] ?? j.status}</span></td>
                      <td className="eq-table__mute">{fmt(j.started_at)}</td>
                      <td className="eq-table__mute">{fmt(j.target_completion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </HubLayout>
  );
}

export default function JobsModule() {
  return (
    <Gate
      perm="admin.list_users"
      fallback={
        <HubLayout>
          <div className="eq-empty">
            <p className="eq-empty__title">Not allowed</p>
            <p>Manager access required to view jobs.</p>
          </div>
        </HubLayout>
      }
    >
      <JobsInner />
    </Gate>
  );
}
