// Platform-admin tenant provisioning dashboard.
//
// Lists all shell_control.tenants joined to tenant_routing (left join).
// Platform-admin only — gated via is_platform_admin check on mount.
//
// Capabilities:
//   - View every tenant and its data-plane provisioning status
//   - Add a new tenant (identity layer: tenants + module_entitlements + tenant_config)
//   - Provision a data-plane Supabase project for a tenant
//   - Retry provisioning after failure
//   - Poll provision-status every 3s while a tenant is in the `provisioning` state

import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Plus, ChevronUp, Database } from 'lucide-react';
import { useSession } from '../session';
import { HubLayout } from '../components/HubLayout';
import { EqError } from '../components/EqError';
import { Skeleton } from '../components/Skeleton';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

type RoutingStatus =
  | 'not_provisioned'
  | 'provisioning'
  | 'provisioning_failed'
  | 'active'
  | 'suspended'
  | 'archived';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  brand_color: string | null;
  tier: string;
  active: boolean;
  created_at: string;
  routing: {
    status: string;
    supabase_url: string | null;
    last_error: string | null;
    last_error_at: string | null;
  } | null;
}

interface StatusBadgeProps { status: RoutingStatus }

const STATUS_META: Record<RoutingStatus, { label: string; cls: string }> = {
  not_provisioned:    { label: 'No data plane',        cls: 'eq-pill eq-pill--neutral' },
  provisioning:       { label: 'Provisioning…',        cls: 'eq-pill eq-pill--warn' },
  provisioning_failed:{ label: 'Provisioning failed',  cls: 'eq-pill eq-pill--err' },
  active:             { label: 'Active',                cls: 'eq-pill eq-pill--ok' },
  suspended:          { label: 'Suspended',             cls: 'eq-pill eq-pill--neutral' },
  archived:           { label: 'Archived',              cls: 'eq-pill eq-pill--neutral' },
};

function StatusBadge({ status }: StatusBadgeProps) {
  const meta = STATUS_META[status] ?? { label: status, cls: 'eq-pill eq-pill--neutral' };
  return <span className={meta.cls}>{meta.label}</span>;
}

const ALL_MODULES = ['cards', 'field', 'service', 'intake', 'quotes'] as const;

export default function AdminTenantsPage() {
  const { session } = useSession();
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [provisioningId, setProvisioningId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // "Add tenant" form state
  const [newSlug, setNewSlug] = useState('');
  const [newName, setNewName] = useState('');
  const [newTier, setNewTier] = useState<'trial' | 'standard' | 'advanced' | 'enterprise'>('standard');
  const [newModules, setNewModules] = useState<Set<string>>(new Set(['cards', 'field', 'service']));
  const [addErr, setAddErr] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  const loadTenants = async () => {
    setErr(null);
    try {
      const res = await fetch('/.netlify/functions/admin-tenants', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { tenants: TenantRow[] };
      setTenants(body.tenants);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadTenants(); }, []);

  // Poll provision-status for any tenant currently provisioning
  const startPolling = (tenantId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setProvisioningId(tenantId);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/.netlify/functions/provision-status?tenant_id=${tenantId}`, { credentials: 'include' });
        if (!res.ok) return;
        const body = (await res.json()) as { status: string };
        if (body.status !== 'provisioning') {
          if (pollRef.current) clearInterval(pollRef.current);
          setProvisioningId(null);
          void loadTenants();
        }
      } catch {
        // silent — poll failures don't interrupt the user
      }
    }, 3_000);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Start polling for any tenant that's already mid-provision on load
  useEffect(() => {
    if (!tenants) return;
    const inFlight = tenants.find((t) => t.routing?.status === 'provisioning');
    if (inFlight && provisioningId !== inFlight.id) {
      startPolling(inFlight.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenants]);

  const provision = async (tenantId: string) => {
    try {
      const res = await fetch('/.netlify/functions/provision-tenant', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      startPolling(tenantId);
      void loadTenants();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleAddTenant = async () => {
    setAddErr(null);
    setAddLoading(true);
    try {
      const res = await fetch('/.netlify/functions/admin-tenants', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: newSlug,
          name: newName,
          tier: newTier,
          modules: [...newModules],
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setShowAddForm(false);
      setNewSlug('');
      setNewName('');
      setNewModules(new Set(['cards', 'field', 'service']));
      void loadTenants();
    } catch (e) {
      setAddErr((e as Error).message);
    } finally {
      setAddLoading(false);
    }
  };

  if (!session?.user.is_platform_admin) {
    return (
      <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
        <div className="eq-page__header">
          <h1 className="eq-page__title">Not allowed</h1>
          <p className="eq-page__lede">This page is restricted to platform administrators.</p>
        </div>
      </HubLayout>
    );
  }

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <div className="eq-page__header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h1 className="eq-page__title" style={{ margin: 0 }}>Tenants</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="eq-btn eq-btn--ghost eq-btn--sm" onClick={() => void loadTenants()} title="Refresh">
              <RefreshCw size={14} />
            </button>
            <button
              className="eq-btn eq-btn--primary eq-btn--sm"
              onClick={() => setShowAddForm((v) => !v)}
            >
              {showAddForm ? <ChevronUp size={14} /> : <Plus size={14} />}
              {showAddForm ? 'Cancel' : 'Add tenant'}
            </button>
          </div>
        </div>
        <p className="eq-page__lede" style={{ marginTop: 4 }}>
          All workspaces and their data-plane provisioning status.
        </p>
      </div>

      {/* ── Add tenant form ─────────────────────────────────────────────── */}
      {showAddForm && (
        <div className="eq-card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>New tenant</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label className="eq-field">
              <span className="eq-field__label">Slug</span>
              <input
                className="eq-input"
                placeholder="e.g. acme-corp"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="eq-field">
              <span className="eq-field__label">Name</span>
              <input
                className="eq-input"
                placeholder="e.g. Acme Corp"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
          </div>
          <label className="eq-field" style={{ marginBottom: 12 }}>
            <span className="eq-field__label">Tier</span>
            <select className="eq-input" value={newTier} onChange={(e) => setNewTier(e.target.value as typeof newTier)}>
              <option value="trial">Trial</option>
              <option value="standard">Standard</option>
              <option value="advanced">Advanced</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </label>
          <fieldset style={{ border: 'none', padding: 0, marginBottom: 16 }}>
            <legend className="eq-field__label" style={{ marginBottom: 8 }}>Modules</legend>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {ALL_MODULES.map((m) => (
                <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={newModules.has(m)}
                    onChange={(e) => {
                      setNewModules((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(m); else next.delete(m);
                        return next;
                      });
                    }}
                  />
                  {m}
                </label>
              ))}
            </div>
          </fieldset>
          {addErr && <p style={{ color: 'var(--eq-err)', fontSize: 13, marginBottom: 12 }}>{addErr}</p>}
          <button
            className="eq-btn eq-btn--primary eq-btn--sm"
            onClick={() => void handleAddTenant()}
            disabled={addLoading || !newSlug || !newName}
          >
            {addLoading ? <Loader2 size={14} className="eq-spin" /> : null}
            {addLoading ? 'Creating…' : 'Create tenant'}
          </button>
        </div>
      )}

      {err && <EqError title="Failed to load tenants" message={err} onRetry={loadTenants} />}

      {/* ── Tenant list ─────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map((i) => <Skeleton key={i} variant="row" width="100%" />)}
        </div>
      ) : (
        <table className="eq-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Data plane</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(tenants ?? []).map((t) => {
              const routingStatus: RoutingStatus = t.routing?.status as RoutingStatus ?? 'not_provisioned';
              const isProvisioning = provisioningId === t.id || routingStatus === 'provisioning';
              const canProvision = routingStatus === 'not_provisioned' || routingStatus === 'provisioning_failed';

              return (
                <tr key={t.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                    <div style={{ color: 'var(--eq-ink-40)', fontSize: 12 }}>{t.slug}</div>
                  </td>
                  <td>
                    <span className="eq-pill eq-pill--neutral" style={{ textTransform: 'capitalize' }}>{t.tier}</span>
                  </td>
                  <td>
                    <StatusBadge status={routingStatus} />
                    {t.routing?.last_error && (
                      <div style={{ color: 'var(--eq-err)', fontSize: 11, marginTop: 4, maxWidth: 280 }} title={t.routing.last_error}>
                        {t.routing.last_error.slice(0, 80)}{t.routing.last_error.length > 80 ? '…' : ''}
                      </div>
                    )}
                  </td>
                  <td>
                    {t.routing?.supabase_url ? (
                      <span style={{ fontSize: 12, color: 'var(--eq-ink-60)', fontFamily: 'monospace' }}>
                        {new URL(t.routing.supabase_url).hostname}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--eq-ink-30)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {isProvisioning ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--eq-ink-60)' }}>
                        <Loader2 size={13} className="eq-spin" /> Provisioning…
                      </span>
                    ) : canProvision ? (
                      <button
                        className="eq-btn eq-btn--ghost eq-btn--sm"
                        onClick={() => void provision(t.id)}
                        title={routingStatus === 'provisioning_failed' ? 'Retry provisioning' : 'Provision data plane'}
                      >
                        {routingStatus === 'provisioning_failed'
                          ? <><RefreshCw size={13} /> Retry</>
                          : <><Database size={13} /> Provision</>}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </HubLayout>
  );
}
