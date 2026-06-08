import { useEffect, useState, useCallback } from 'react';
import { Search } from 'lucide-react';
import { useSession } from '../session';
import { Gate } from '../permissions/Gate';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';
import { friendlyError } from '../lib/friendlyError';
import { createSupabaseClient } from '../lib/supabaseJwt';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SiteRow {
  id: string;
  name: string;
  abbr: string | null;
  suburb: string | null;
  state: string | null;
  active: boolean;
  field_enabled: boolean;
  service_enabled: boolean;
}

interface CustomerRow {
  customer_id: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  active: boolean | null;
  field_enabled: boolean;
  service_enabled: boolean;
}

type ActiveTab = 'sites' | 'customers';

// ── API call ──────────────────────────────────────────────────────────────────

async function setActivation(
  table: 'sites' | 'customers',
  id: string,
  updates: { field_enabled?: boolean; service_enabled?: boolean },
): Promise<void> {
  const res = await fetch('/.netlify/functions/update-data-activation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, id, ...updates }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; detail?: string };
    throw new Error(body.detail ?? body.error ?? `${res.status}`);
  }
}

// ── Toggle cell ───────────────────────────────────────────────────────────────

function ActivationToggle({
  checked,
  label,
  busy,
  onChange,
}: {
  checked: boolean;
  label: string;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.5 : 1,
        userSelect: 'none',
      }}
      title={label}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={busy}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--eq-sky, #3DA8D8)' }}
      />
    </label>
  );
}

// ── Sites tab ─────────────────────────────────────────────────────────────────

function SitesTab() {
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setErr(null);
    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb
        .schema('app_data')
        .from('sites')
        .select('site_id, name, code, suburb, state, active, field_enabled, service_enabled')
        .order('name');
      if (error) { setErr(friendlyError(error, "Couldn't load sites.")); return; }
      setSites(
        ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          id: r.site_id as string,
          name: r.name as string,
          abbr: r.code as string | null,
          suburb: r.suburb as string | null,
          state: r.state as string | null,
          active: Boolean(r.active),
          field_enabled: r.field_enabled !== undefined ? Boolean(r.field_enabled) : true,
          service_enabled: r.service_enabled !== undefined ? Boolean(r.service_enabled) : true,
        })),
      );
    } catch (e) {
      setErr(friendlyError(e, "Couldn't load sites."));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(site: SiteRow, key: 'field_enabled' | 'service_enabled', value: boolean) {
    setBusy((b) => ({ ...b, [`${site.id}-${key}`]: true }));
    // Optimistic update
    setSites((prev) => prev?.map((s) => s.id === site.id ? { ...s, [key]: value } : s) ?? null);
    try {
      await setActivation('sites', site.id, { [key]: value });
    } catch (e) {
      // Roll back on error
      setSites((prev) => prev?.map((s) => s.id === site.id ? { ...s, [key]: !value } : s) ?? null);
      setErr(friendlyError(e, 'Save failed.'));
    } finally {
      setBusy((b) => ({ ...b, [`${site.id}-${key}`]: false }));
    }
  }

  const filtered = (sites ?? []).filter((s) => {
    const q = search.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || (s.abbr ?? '').toLowerCase().includes(q) || (s.suburb ?? '').toLowerCase().includes(q);
  });

  if (err) return <EqError title="Couldn't load sites" message={err} onRetry={load} />;
  if (!sites) return <Skeleton variant="row" count={8} />;

  return (
    <>
      <div style={searchBarStyle}>
        <Search size={14} style={{ color: 'var(--eq-grey, #6b7280)', flexShrink: 0 }} aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter sites…"
          style={searchInputStyle}
        />
        <span style={countStyle}>{filtered.length} of {sites.length}</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Site</th>
              <th style={{ ...thStyle, ...centredTh }}>Field</th>
              <th style={{ ...thStyle, ...centredTh }}>Service</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={3} style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--eq-grey)' }}>No sites match</td></tr>
            )}
            {filtered.map((site) => (
              <tr key={site.id} style={trStyle}>
                <td style={tdStyle}>
                  <span style={{ fontWeight: 500 }}>{site.name}</span>
                  {(site.suburb || site.state) && (
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--eq-grey)' }}>
                      {[site.suburb, site.state].filter(Boolean).join(', ')}
                    </span>
                  )}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <ActivationToggle
                    checked={site.field_enabled}
                    label={`${site.field_enabled ? 'Remove' : 'Add'} ${site.name} from Field`}
                    busy={Boolean(busy[`${site.id}-field_enabled`])}
                    onChange={(v) => void toggle(site, 'field_enabled', v)}
                  />
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <ActivationToggle
                    checked={site.service_enabled}
                    label={`${site.service_enabled ? 'Remove' : 'Add'} ${site.name} from Service`}
                    busy={Boolean(busy[`${site.id}-service_enabled`])}
                    onChange={(v) => void toggle(site, 'service_enabled', v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Customers tab ─────────────────────────────────────────────────────────────

function CustomersTab() {
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setErr(null);
    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb
        .schema('app_data')
        .from('customers')
        .select('customer_id, company_name, first_name, last_name, active, field_enabled, service_enabled')
        .order('company_name');
      if (error) { setErr(friendlyError(error, "Couldn't load customers.")); return; }
      setCustomers(
        ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          customer_id: r.customer_id as string,
          company_name: r.company_name as string | null,
          first_name: r.first_name as string | null,
          last_name: r.last_name as string | null,
          active: r.active !== undefined ? Boolean(r.active) : true,
          field_enabled: r.field_enabled !== undefined ? Boolean(r.field_enabled) : false,
          service_enabled: r.service_enabled !== undefined ? Boolean(r.service_enabled) : true,
        })),
      );
    } catch (e) {
      setErr(friendlyError(e, "Couldn't load customers."));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(cust: CustomerRow, key: 'field_enabled' | 'service_enabled', value: boolean) {
    setBusy((b) => ({ ...b, [`${cust.customer_id}-${key}`]: true }));
    setCustomers((prev) => prev?.map((c) => c.customer_id === cust.customer_id ? { ...c, [key]: value } : c) ?? null);
    try {
      await setActivation('customers', cust.customer_id, { [key]: value });
    } catch (e) {
      setCustomers((prev) => prev?.map((c) => c.customer_id === cust.customer_id ? { ...c, [key]: !value } : c) ?? null);
      setErr(friendlyError(e, 'Save failed.'));
    } finally {
      setBusy((b) => ({ ...b, [`${cust.customer_id}-${key}`]: false }));
    }
  }

  const displayName = (c: CustomerRow) =>
    c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';

  const filtered = (customers ?? []).filter((c) => {
    const q = search.toLowerCase();
    return !q || displayName(c).toLowerCase().includes(q);
  });

  if (err) return <EqError title="Couldn't load customers" message={err} onRetry={load} />;
  if (!customers) return <Skeleton variant="row" count={8} />;

  return (
    <>
      <div style={searchBarStyle}>
        <Search size={14} style={{ color: 'var(--eq-grey, #6b7280)', flexShrink: 0 }} aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter customers…"
          style={searchInputStyle}
        />
        <span style={countStyle}>{filtered.length} of {customers.length}</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Customer</th>
              <th style={{ ...thStyle, ...centredTh }}>Field</th>
              <th style={{ ...thStyle, ...centredTh }}>Service</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={3} style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--eq-grey)' }}>No customers match</td></tr>
            )}
            {filtered.map((cust) => (
              <tr key={cust.customer_id} style={trStyle}>
                <td style={tdStyle}>
                  <span style={{ fontWeight: 500 }}>{displayName(cust)}</span>
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <ActivationToggle
                    checked={cust.field_enabled}
                    label={`${cust.field_enabled ? 'Remove' : 'Add'} ${displayName(cust)} from Field`}
                    busy={Boolean(busy[`${cust.customer_id}-field_enabled`])}
                    onChange={(v) => void toggle(cust, 'field_enabled', v)}
                  />
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <ActivationToggle
                    checked={cust.service_enabled}
                    label={`${cust.service_enabled ? 'Remove' : 'Add'} ${displayName(cust)} from Service`}
                    busy={Boolean(busy[`${cust.customer_id}-service_enabled`])}
                    onChange={(v) => void toggle(cust, 'service_enabled', v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function AdminDataActivationInner() {
  const { session } = useSession();
  const [tab, setTab] = useState<ActiveTab>('sites');

  const tenantName = session?.tenant.name ?? 'your organisation';

  return (
    <div className="eq-hub__content">
      <div className="eq-hub-content">
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>App activation</h1>
          <p style={{ fontSize: 13, color: 'var(--eq-grey)', margin: 0 }}>
            {tenantName} · choose which sites and customers appear in Field and Service
          </p>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--eq-border)' }}>
          {(['sites', 'customers'] as ActiveTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px 16px',
                fontSize: 14, fontWeight: tab === t ? 600 : 400,
                color: tab === t ? 'var(--eq-sky, #3DA8D8)' : 'var(--eq-grey)',
                borderBottom: tab === t ? '2px solid var(--eq-sky, #3DA8D8)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'sites' && <SitesTab />}
        {tab === 'customers' && <CustomersTab />}
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const searchBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 12px',
  border: '1px solid var(--eq-border)', borderRadius: 6,
  background: 'var(--eq-bg)',
  marginBottom: 16,
};

const searchInputStyle: React.CSSProperties = {
  flex: 1, border: 'none', outline: 'none',
  fontSize: 14, background: 'transparent', color: 'var(--eq-ink)',
};

const countStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--eq-grey)', flexShrink: 0,
};

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 14,
};

const thStyle: React.CSSProperties = {
  padding: '8px 16px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: 'var(--eq-grey)',
  borderBottom: '1px solid var(--eq-border)',
  background: 'var(--eq-surface, var(--gray-50))',
};

const centredTh: React.CSSProperties = {
  textAlign: 'center', width: 80,
};

const trStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--eq-border)',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 16px', verticalAlign: 'middle',
};

// ── Export ────────────────────────────────────────────────────────────────────

export default function AdminDataActivationPage() {
  return (
    <Gate
      perm="admin.list_users"
      fallback={
        <div className="eq-empty">
          <p className="eq-empty__title">Not allowed</p>
          <p>Only managers can manage app activation.</p>
        </div>
      }
    >
      <div className="eq-hub">
        <AdminDataActivationInner />
      </div>
    </Gate>
  );
}
