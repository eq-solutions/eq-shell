// CustomersPage — Tabbed Customers / Sites / Contacts view
// Route: /:tenant/customers

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Table, type TableColumn } from '@eq-solutions/ui';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { entityActions } from '../lib/entityActions';

const SIDEBAR_RECORDS = defaultSidebarRecords();

// ─── TYPES ───────────────────────────────────────────────────────────────────

type Tab = 'customers' | 'sites' | 'contacts';

interface CustomerItem {
  id: string;
  name: string;
  group: string | null;
  state: string | null;
  active: boolean;
  site_count: number;
  contact_count: number;
}

interface SiteItem {
  id: string;
  name: string;
  kind: string | null;
  suburb: string | null;
  state: string | null;
  customer_id: string | null;
  contact: { name: string; phone: string | null; email: string | null } | null;
}

interface ContactItem {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
  customer_id: string | null;
}

interface CustomerDetail {
  id: string;
  name: string;
  group: string | null;
  state: string | null;
  active: boolean;
  phone: string | null;
  email: string | null;
  sites: { id: string; name: string; kind: string | null; suburb: string | null; state: string | null; contact: { name: string; phone: string | null; email: string | null } | null }[];
  contacts: { id: string; name: string; role: string | null; email: string | null; phone: string | null }[];
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const AV_COLOURS = ['#3DA8D8','#8B5CF6','#F59E0B','#10B981','#EF4444','#6366F1','#EC4899','#14B8A6'];

function avatarColour(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AV_COLOURS[h % AV_COLOURS.length];
}
function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}
function personName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(' ') || 'Unnamed';
}

// ─── API ─────────────────────────────────────────────────────────────────────

interface CrmListResp {
  ok: boolean;
  customers?: CustomerItem[];
  unassigned?: { sites: number; contacts: number };
  error?: string;
}
interface EntityResp {
  ok: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
}

async function crmFetch(params: Record<string, string>): Promise<Response> {
  const qs = new URLSearchParams(params);
  return fetch(`/.netlify/functions/crm-customers?${qs}`, { credentials: 'include' });
}
async function entityFetch(entity: string, extra: Record<string, string> = {}): Promise<EntityResp> {
  const qs = new URLSearchParams({ entity, limit: '1000', offset: '0', ...extra });
  const res = await fetch(`/.netlify/functions/entity-rows?${qs}`, { credentials: 'include' });
  return res.json() as Promise<EntityResp>;
}

function mapSite(row: Record<string, unknown>): SiteItem {
  return {
    id:          String(row['site_id'] ?? row['id'] ?? ''),
    name:        (row['name']        as string | null) ?? 'Unnamed site',
    kind:        (row['site_type']   as string | null) ?? null,
    suburb:      (row['suburb']      as string | null) ?? null,
    state:       (row['state']       as string | null) ?? null,
    customer_id: (row['customer_id'] as string | null) ?? null,
    contact: null,
  };
}
function mapContact(row: Record<string, unknown>): ContactItem {
  const first = (row['first_name'] as string | null) ?? null;
  const last  = (row['last_name']  as string | null) ?? null;
  return {
    id:          String(row['contact_id'] ?? row['id'] ?? ''),
    name:        [first, last].filter(Boolean).join(' ') || 'Unnamed',
    first_name:  first,
    last_name:   last,
    position:    (row['position']     as string | null) ?? null,
    email:       (row['email']        as string | null) ?? null,
    phone:       ((row['mobile_phone'] ?? row['work_phone']) as string | null) ?? null,
    customer_id: (row['customer_id']  as string | null) ?? null,
  };
}

// ─── COLUMN DEFINITIONS ───────────────────────────────────────────────────────

const CUSTOMER_COLS: TableColumn<CustomerItem>[] = [
  {
    key: 'name',
    header: 'Company',
    sortAccessor: (c) => c.name,
    render: (c) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: avatarColour(c.id), color: 'white', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {initials(c.name)}
        </div>
        <span style={{ fontWeight: 700, color: '#1A1A2E', fontSize: 13 }}>{c.name}</span>
      </div>
    ),
  },
  {
    key: 'group',
    header: 'Group',
    sortAccessor: (c) => c.group,
    render: (c) => <span style={{ color: '#64748B' }}>{c.group ?? '—'}</span>,
  },
  {
    key: 'state',
    header: 'State',
    sortAccessor: (c) => c.state,
    render: (c) => <span style={{ color: '#64748B' }}>{c.state ?? '—'}</span>,
  },
  {
    key: 'site_count',
    header: 'Sites',
    align: 'center',
    sortAccessor: (c) => c.site_count,
    render: (c) =>
      c.site_count > 0
        ? <span style={{ background: 'rgba(61,168,216,0.1)', color: '#2986B4', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, display: 'inline-block' }}>{c.site_count}</span>
        : <span style={{ color: '#CBD5E1' }}>—</span>,
  },
  {
    key: 'contact_count',
    header: 'Contacts',
    align: 'center',
    sortAccessor: (c) => c.contact_count,
    render: (c) =>
      c.contact_count > 0
        ? <span style={{ background: 'rgba(61,168,216,0.1)', color: '#2986B4', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, display: 'inline-block' }}>{c.contact_count}</span>
        : <span style={{ color: '#CBD5E1' }}>—</span>,
  },
  {
    key: 'status',
    header: 'Status',
    sortAccessor: (c) => (c.active ? 'Active' : 'Inactive'),
    render: (c) => (
      <span style={c.active
        ? { background: '#DCFCE7', color: '#15803D', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, display: 'inline-block' }
        : { background: '#F1F5F9', color: '#64748B', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, display: 'inline-block' }}>
        {c.active ? 'Active' : 'Inactive'}
      </span>
    ),
  },
];

const SITE_COLS: TableColumn<SiteItem>[] = [
  {
    key: 'name',
    header: 'Site name',
    sortAccessor: (site) => site.name,
    render: (site) => <span style={{ fontWeight: 700, color: '#1A1A2E', fontSize: 13 }}>{site.name}</span>,
  },
  {
    key: 'kind',
    header: 'Type',
    sortAccessor: (site) => site.kind,
    render: (site) => <span style={{ color: '#64748B' }}>{site.kind ?? '—'}</span>,
  },
  {
    key: 'suburb',
    header: 'Suburb',
    sortAccessor: (site) => site.suburb,
    render: (site) => <span style={{ color: '#64748B' }}>{site.suburb ?? '—'}</span>,
  },
  {
    key: 'state',
    header: 'State',
    sortAccessor: (site) => site.state,
    render: (site) => <span style={{ color: '#64748B' }}>{site.state ?? '—'}</span>,
  },
];

const CONTACT_COLS: TableColumn<ContactItem>[] = [
  {
    key: 'name',
    header: 'Name',
    sortAccessor: (c) => personName(c.first_name, c.last_name),
    render: (c) => {
      const name = personName(c.first_name, c.last_name);
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: avatarColour(c.id), color: 'white', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {initials(name)}
          </div>
          <span style={{ fontWeight: 700, color: '#1A1A2E', fontSize: 13 }}>{name}</span>
        </div>
      );
    },
  },
  {
    key: 'position',
    header: 'Role',
    sortAccessor: (c) => c.position,
    render: (c) => <span style={{ color: '#64748B' }}>{c.position ?? '—'}</span>,
  },
  {
    key: 'phone',
    header: 'Phone',
    render: (c) => <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: 11 }}>{c.phone ?? '—'}</span>,
  },
  {
    key: 'email',
    header: 'Email',
    render: (c) => <span style={{ color: '#94A3B8', fontSize: 11 }}>{c.email ?? '—'}</span>,
  },
];

// ─── PAGE ────────────────────────────────────────────────────────────────────

export function CustomersPage() {
  const [tab,       setTab]       = useState<Tab>('customers');
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [sites,     setSites]     = useState<SiteItem[]>([]);
  const [contacts,  setContacts]  = useState<ContactItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [selId,     setSelId]     = useState<string | null>(null);
  const [detail,    setDetail]    = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reload,    setReload]    = useState(0);

  // Fetch all data on mount and after mutations
  useEffect(() => {
    setLoading(true);
    Promise.all([
      crmFetch({ action: 'list' }).then((r) => r.json() as Promise<CrmListResp>),
      entityFetch('site'),
      entityFetch('contact'),
    ])
      .then(([custResp, siteResp, contResp]) => {
        if (!custResp.ok) { setError(custResp.error ?? 'Failed to load customers'); return; }
        setCustomers(custResp.customers ?? []);
        if (siteResp.ok) setSites((siteResp.rows ?? []).map(mapSite));
        if (contResp.ok) setContacts((contResp.rows ?? []).map(mapContact));
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [reload]);

  const handleMutated = useCallback(() => setReload((n) => n + 1), []);

  // Fetch customer detail when selected
  useEffect(() => {
    if (!selId || tab !== 'customers') { setDetail(null); return; }
    setDetailLoading(true);
    crmFetch({ action: 'detail', id: selId })
      .then((r) => r.json() as Promise<{ ok: boolean; customer?: { id: string; name: string; group: string | null; state: string | null; active: boolean; phone: string | null; email: string | null }; sites?: CustomerDetail['sites']; contacts?: CustomerDetail['contacts'] }>)
      .then((r) => {
        if (r.ok && r.customer) {
          setDetail({ ...r.customer, sites: r.sites ?? [], contacts: r.contacts ?? [] });
        }
      })
      .catch(() => {})
      .finally(() => setDetailLoading(false));
  }, [selId, tab]);

  const selectRow = useCallback((id: string) => {
    setSelId((prev) => (prev === id ? null : id));
  }, []);

  const switchTab = useCallback((t: Tab) => {
    setTab(t);
    setSelId(null);
    setDetail(null);
  }, []);

  const panelOpen = selId !== null && tab === 'customers';

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS} fullWidth>
      <div style={s.page}>

        {/* Zone A — header */}
        <div style={s.ph}>
          <div>
            <h1 style={s.title}>Customers</h1>
            <p style={s.subtitle}>
              {loading ? 'Loading…' : `${customers.length} customers · ${sites.length} sites · ${contacts.length} contacts`}
            </p>
          </div>
        </div>

        {/* Zone B — tab bar */}
        <div style={s.tabBar}>
          {([
            { key: 'customers' as Tab, label: 'Customers', count: customers.length },
            { key: 'sites'     as Tab, label: 'Sites',     count: sites.length     },
            { key: 'contacts'  as Tab, label: 'Contacts',  count: contacts.length  },
          ]).map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              style={{ ...s.tab, ...(tab === key ? s.tabOn : {}) }}
              onClick={() => switchTab(key)}
            >
              {label}
              <span style={{ ...s.tabCount, ...(tab === key ? s.tabCountOn : {}) }}>{count}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        {error ? (
          <div style={s.empty}>
            <p style={{ fontWeight: 700, color: '#EF4444' }}>{error}</p>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
              {tab === 'customers' && (
                <CustomersTab
                  rows={customers}
                  loading={loading}
                  selId={selId}
                  onSelect={selectRow}
                  onMutated={handleMutated}
                />
              )}
              {tab === 'sites' && (
                <SitesTab rows={sites} loading={loading} onMutated={handleMutated} />
              )}
              {tab === 'contacts' && (
                <ContactsTab rows={contacts} loading={loading} onMutated={handleMutated} />
              )}
            </div>
            {/* Split panel — customers tab only */}
            <div style={{ ...s.pw, ...(panelOpen ? s.pwOpen : {}) }}>
              <div style={s.pi}>
                {selId && (
                  <CustomerPanel
                    detail={detail}
                    loading={detailLoading}
                    onClose={() => setSelId(null)}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </HubLayout>
  );
}

// ─── CUSTOMERS TAB ───────────────────────────────────────────────────────────

function CustomersTab({ rows, loading, selId, onSelect, onMutated }: {
  rows: CustomerItem[];
  loading: boolean;
  selId: string | null;
  onSelect: (id: string) => void;
  onMutated: () => void;
}) {
  return (
    <Table
      columns={CUSTOMER_COLS}
      rows={rows}
      getRowId={(c) => c.id}
      slicers={[
        { key: 'all',    label: 'All' },
        { key: 'active', label: 'Active only', filter: (c) => c.active },
      ]}
      globalSearch={{ placeholder: 'Search customers…' }}
      columnToggle
      exportable={{ filename: 'customers.csv' }}
      rowIndicator={(c) => c.active ? null : { color: 'var(--eq-gray-400)' }}
      loading={loading}
      emptyMessage="No customers found"
      onRowClick={(c) => onSelect(c.id)}
      rowStyle={(c) => c.id === selId ? { background: '#e1f1fb' } : undefined}
      pagination={{ pageSize: 50 }}
      summary={(v, t) => <>Showing <strong>{v}</strong> of <strong>{t.toLocaleString()}</strong></>}
      onArchive={async (rows) => { await entityActions('customer', rows.map((c) => c.id), 'archive'); onMutated(); }}
      archiveConfirm={{ description: (n) => `${n} customer${n === 1 ? '' : 's'} will be set to inactive.` }}
      onDelete={async (rows) => { await entityActions('customer', rows.map((c) => c.id), 'delete'); onMutated(); }}
      deleteConfirm={{ description: (n) => `${n} customer${n === 1 ? '' : 's'} and all linked contacts will be permanently removed.` }}
      onActionError={(action, err) => console.error(`[customers] bulk ${action} failed`, err)}
    />
  );
}

// ─── SITES TAB ───────────────────────────────────────────────────────────────

function SitesTab({ rows, loading, onMutated }: { rows: SiteItem[]; loading: boolean; onMutated: () => void }) {
  return (
    <Table
      columns={SITE_COLS}
      rows={rows}
      getRowId={(site) => site.id}
      globalSearch={{ placeholder: 'Search sites…' }}
      columnToggle
      exportable={{ filename: 'sites.csv' }}
      loading={loading}
      emptyMessage="No sites found"
      onArchive={async (rows) => { await entityActions('site', rows.map((s) => s.id), 'archive'); onMutated(); }}
      archiveConfirm={{ description: (n) => `${n} site${n === 1 ? '' : 's'} will be set to inactive.` }}
      onDelete={async (rows) => { await entityActions('site', rows.map((s) => s.id), 'delete'); onMutated(); }}
      deleteConfirm={{ description: (n) => `${n} site${n === 1 ? '' : 's'} will be permanently removed.` }}
      onActionError={(action, err) => console.error(`[sites] bulk ${action} failed`, err)}
    />
  );
}

// ─── CONTACTS TAB ─────────────────────────────────────────────────────────────

function ContactsTab({ rows, loading, onMutated }: { rows: ContactItem[]; loading: boolean; onMutated: () => void }) {
  return (
    <Table
      columns={CONTACT_COLS}
      rows={rows}
      getRowId={(c) => c.id}
      globalSearch={{ placeholder: 'Search contacts…' }}
      columnToggle
      exportable={{ filename: 'contacts.csv' }}
      loading={loading}
      emptyMessage="No contacts found"
      onArchive={async (rows) => { await entityActions('contact', rows.map((c) => c.id), 'archive'); onMutated(); }}
      archiveConfirm={{ description: (n) => `${n} contact${n === 1 ? '' : 's'} will be set to inactive.` }}
      onDelete={async (rows) => { await entityActions('contact', rows.map((c) => c.id), 'delete'); onMutated(); }}
      deleteConfirm={{ description: (n) => `${n} contact${n === 1 ? '' : 's'} will be permanently removed.` }}
      onActionError={(action, err) => console.error(`[contacts] bulk ${action} failed`, err)}
    />
  );
}

// ─── CUSTOMER SPLIT PANEL ─────────────────────────────────────────────────────

function CustomerPanel({ detail, loading, onClose }: {
  detail: CustomerDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <div style={s.phead}>
        {detail && (
          <div style={{ width: 36, height: 36, borderRadius: 8, background: avatarColour(detail.id), color: 'white', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {initials(detail.name)}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.pname}>{detail?.name ?? ' '}</div>
          <div style={s.prole}>{detail?.group ?? ' '}</div>
        </div>
        <button type="button" style={s.pcls} onClick={onClose} aria-label="Close panel">
          <X size={14} />
        </button>
      </div>
      <div style={s.pbody}>
        {loading ? (
          <div style={{ color: '#94A3B8', fontSize: 12, padding: '12px 0' }}>Loading…</div>
        ) : detail ? (
          <>
            <PField label="Status"    value={detail.active ? 'Active' : 'Inactive'} />
            {detail.state && <PField label="State" value={detail.state} />}
            {detail.phone && <PField label="Phone" value={detail.phone} />}
            {detail.email && <PField label="Email" value={detail.email} />}

            <div style={s.psec}>Sites ({detail.sites.length})</div>
            {detail.sites.length === 0
              ? <p style={s.emptyNote}>No sites</p>
              : detail.sites.map((site) => (
                <div key={site.id} style={s.detailCard}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1A1A2E' }}>{site.name}</div>
                  {(site.suburb || site.state) && (
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                      {[site.suburb, site.state].filter(Boolean).join(', ')}
                    </div>
                  )}
                  {site.contact && (
                    <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>
                      {site.contact.name}
                    </div>
                  )}
                </div>
              ))}

            <div style={s.psec}>Contacts ({detail.contacts.length})</div>
            {detail.contacts.length === 0
              ? <p style={s.emptyNote}>No contacts</p>
              : detail.contacts.map((c) => (
                <div key={c.id} style={s.detailCard}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1A1A2E' }}>{c.name}</div>
                  {c.role && <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{c.role}</div>}
                  {c.phone && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{c.phone}</div>}
                  {c.email && <div style={{ fontSize: 11, color: '#94A3B8' }}>{c.email}</div>}
                </div>
              ))}
          </>
        ) : null}
      </div>
      <div style={s.pfoot}>
        <button type="button" style={{ ...s.btnPrimary, flex: 1, justifyContent: 'center' }}>Edit customer</button>
      </div>
    </>
  );
}

// ─── SHARED SUB-COMPONENTS ────────────────────────────────────────────────────

function PField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#1A1A2E' }}>{value}</div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page:       { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', fontFamily: 'inherit' },
  ph:         { padding: '16px 24px 0', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexShrink: 0 },
  title:      { fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: '#1A1A2E' },
  subtitle:   { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  tabBar:     { padding: '12px 24px 0', display: 'flex', alignItems: 'flex-end', gap: 2, borderBottom: '1px solid #E2E8F0', flexShrink: 0 },
  tab:        { padding: '6px 14px', fontSize: 12, fontWeight: 600, color: '#64748B', cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: -1, borderRadius: '5px 5px 0 0', border: 'none', background: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', userSelect: 'none' },
  tabOn:      { color: '#3DA8D8', borderBottomColor: '#3DA8D8', fontWeight: 700 },
  tabCount:   { background: '#F1F5F9', color: '#64748B', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10 },
  tabCountOn: { background: 'rgba(61,168,216,0.12)', color: '#3DA8D8' },
  empty:      { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#94A3B8' },
  emptyNote:  { fontSize: 11, color: '#94A3B8', fontStyle: 'italic' },
  pw:         { width: 0, flexShrink: 0, overflow: 'hidden', transition: 'width .22s cubic-bezier(.4,0,.2,1)', borderLeft: '0px solid #E2E8F0', background: 'white' },
  pwOpen:     { width: 320, borderLeftWidth: 1 },
  pi:         { width: 320, height: '100%', display: 'flex', flexDirection: 'column' },
  phead:      { padding: '14px 16px 12px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'flex-start', gap: 10, flexShrink: 0 },
  pname:      { fontSize: 14, fontWeight: 800, color: '#1A1A2E', lineHeight: 1.2 },
  prole:      { fontSize: 11, color: '#64748B', marginTop: 2 },
  pcls:       { width: 26, height: 26, borderRadius: 6, border: '1px solid #E2E8F0', background: 'white', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  pbody:      { flex: 1, overflowY: 'auto', padding: '14px 16px' },
  psec:       { fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#94A3B8', padding: '12px 0 6px' },
  pfoot:      { padding: '10px 16px 14px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 8, flexShrink: 0 },
  detailCard: { padding: '8px 10px', borderRadius: 6, border: '1px solid #E2E8F0', marginBottom: 5, background: '#FAFAFA' },
  btnPrimary: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: 'none', background: '#3DA8D8', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
};
