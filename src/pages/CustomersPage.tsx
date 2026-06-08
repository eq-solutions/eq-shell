// CustomersPage — Tabbed Customers / Sites / Contacts view
// Route: /:tenant/customers

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

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
  const qs = new URLSearchParams({ entity, page: '1', per_page: '500', ...extra });
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
  return {
    id:          String(row['contact_id'] ?? row['id'] ?? ''),
    first_name:  (row['first_name']   as string | null) ?? null,
    last_name:   (row['last_name']    as string | null) ?? null,
    position:    (row['position']     as string | null) ?? null,
    email:       (row['email']        as string | null) ?? null,
    phone:       ((row['mobile_phone'] ?? row['work_phone']) as string | null) ?? null,
    customer_id: (row['customer_id']  as string | null) ?? null,
  };
}

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
  const [query,     setQuery]     = useState('');
  const [onlyActive, setOnlyActive] = useState(false);

  // Fetch all data on mount
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
  }, []);

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
    setQuery('');
  }, []);

  // Filtered data
  const filteredCustomers = useMemo(() => {
    const q = query.toLowerCase().trim();
    return customers.filter((c) => {
      if (onlyActive && !c.active) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [customers, query, onlyActive]);

  const filteredSites = useMemo(() => {
    const q = query.toLowerCase().trim();
    return sites.filter((s) => !q || s.name.toLowerCase().includes(q) || s.suburb?.toLowerCase().includes(q) || false);
  }, [sites, query]);

  const filteredContacts = useMemo(() => {
    const q = query.toLowerCase().trim();
    return contacts.filter((c) => {
      const name = personName(c.first_name, c.last_name);
      return !q || name.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q) || false;
    });
  }, [contacts, query]);

  const panelOpen = selId !== null && tab === 'customers';

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS} fullWidth>
      <div style={s.page}>

        {/* Header */}
        <div style={s.ph}>
          <div>
            <h1 style={s.title}>Customers</h1>
            <p style={s.subtitle}>
              {loading ? 'Loading…' : `${customers.length} customers · ${sites.length} sites · ${contacts.length} contacts`}
            </p>
          </div>
        </div>

        {/* Tab bar */}
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

        {/* Filter bar */}
        <div style={s.fb}>
          {tab === 'customers' && (
            <button
              type="button"
              style={{ ...s.chip, ...(onlyActive ? s.chipOn : {}) }}
              onClick={() => setOnlyActive((v) => !v)}
            >
              ✓ Active only
              {onlyActive && <span style={{ opacity: 0.6, marginLeft: 3 }}>×</span>}
            </button>
          )}
          <div style={{ position: 'relative', marginLeft: tab === 'customers' ? 0 : undefined }}>
            <span style={s.searchIcon}>🔍</span>
            <input
              style={s.search}
              placeholder={`Search ${tab}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
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
                  rows={filteredCustomers}
                  loading={loading}
                  selId={selId}
                  onSelect={selectRow}
                />
              )}
              {tab === 'sites' && (
                <SitesTab rows={filteredSites} loading={loading} />
              )}
              {tab === 'contacts' && (
                <ContactsTab rows={filteredContacts} loading={loading} />
              )}
            </div>
            {/* Split panel — only for customers tab */}
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

function CustomersTab({ rows, loading, selId, onSelect }: {
  rows: CustomerItem[];
  loading: boolean;
  selId: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading) return <LoadingState />;
  if (!rows.length) return <EmptyState icon="🏢" msg="No customers found" />;
  return (
    <table style={s.table}>
      <thead>
        <tr>
          {['Company', 'Group', 'State', 'Sites', 'Contacts', 'Status', ''].map((h) => (
            <th key={h} style={s.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr
            key={c.id}
            style={{ ...s.tr, ...(c.id === selId ? s.trSel : {}) }}
            onClick={() => onSelect(c.id)}
          >
            <td style={s.td}>
              <div style={s.nameCell}>
                <div style={{ ...s.av, borderRadius: 7, background: avatarColour(c.id) }}>
                  {initials(c.name)}
                </div>
                <div style={s.pn}>{c.name}</div>
              </div>
            </td>
            <td style={{ ...s.td, color: '#64748B' }}>{c.group ?? '—'}</td>
            <td style={{ ...s.td, color: '#64748B' }}>{c.state ?? '—'}</td>
            <td style={{ ...s.td, textAlign: 'center' }}>
              {c.site_count > 0
                ? <span style={s.countBadge}>{c.site_count}</span>
                : <span style={{ color: '#CBD5E1' }}>—</span>}
            </td>
            <td style={{ ...s.td, textAlign: 'center' }}>
              {c.contact_count > 0
                ? <span style={s.countBadge}>{c.contact_count}</span>
                : <span style={{ color: '#CBD5E1' }}>—</span>}
            </td>
            <td style={s.td}>
              <span style={c.active ? s.badgeGreen : s.badgeGrey}>
                {c.active ? 'Active' : 'Inactive'}
              </span>
            </td>
            <td style={s.td}>
              <div style={s.rowActions}>
                <button type="button" style={s.ra} onClick={(e) => { e.stopPropagation(); onSelect(c.id); }}>View</button>
                <button type="button" style={s.ra}>Edit</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── SITES TAB ───────────────────────────────────────────────────────────────

function SitesTab({ rows, loading }: { rows: SiteItem[]; loading: boolean }) {
  if (loading) return <LoadingState />;
  if (!rows.length) return <EmptyState icon="📍" msg="No sites found" />;
  return (
    <table style={s.table}>
      <thead>
        <tr>
          {['Site name', 'Type', 'Suburb', 'State', ''].map((h) => (
            <th key={h} style={s.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((site) => (
          <tr key={site.id} style={s.tr}>
            <td style={s.td}><div style={s.pn}>{site.name}</div></td>
            <td style={{ ...s.td, color: '#64748B' }}>{site.kind ?? '—'}</td>
            <td style={{ ...s.td, color: '#64748B' }}>{site.suburb ?? '—'}</td>
            <td style={{ ...s.td, color: '#64748B' }}>{site.state ?? '—'}</td>
            <td style={s.td}>
              <div style={s.rowActions}>
                <button type="button" style={s.ra}>View</button>
                <button type="button" style={s.ra}>Edit</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── CONTACTS TAB ─────────────────────────────────────────────────────────────

function ContactsTab({ rows, loading }: { rows: ContactItem[]; loading: boolean }) {
  if (loading) return <LoadingState />;
  if (!rows.length) return <EmptyState icon="👤" msg="No contacts found" />;
  return (
    <table style={s.table}>
      <thead>
        <tr>
          {['Name', 'Role', 'Phone', 'Email', ''].map((h) => (
            <th key={h} style={s.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const name = personName(c.first_name, c.last_name);
          return (
            <tr key={c.id} style={s.tr}>
              <td style={s.td}>
                <div style={s.nameCell}>
                  <div style={{ ...s.av, background: avatarColour(c.id) }}>{initials(name)}</div>
                  <div style={s.pn}>{name}</div>
                </div>
              </td>
              <td style={{ ...s.td, color: '#64748B' }}>{c.position ?? '—'}</td>
              <td style={{ ...s.td, color: '#475569', fontFamily: 'monospace', fontSize: 11 }}>{c.phone ?? '—'}</td>
              <td style={{ ...s.td, color: '#94A3B8', fontSize: 11 }}>{c.email ?? '—'}</td>
              <td style={s.td}>
                <div style={s.rowActions}>
                  <button type="button" style={s.ra}>View</button>
                  <button type="button" style={s.ra}>Edit</button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
          <div style={{ ...s.av, borderRadius: 8, background: avatarColour(detail.id), width: 36, height: 36, fontSize: 12, fontWeight: 800 }}>
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
                      📞 {site.contact.name}
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

function LoadingState() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#94A3B8' }}>
      Loading…
    </div>
  );
}

function EmptyState({ icon, msg }: { icon: string; msg: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8, color: '#94A3B8' }}>
      <span style={{ fontSize: 28 }}>{icon}</span>
      <strong style={{ color: '#475569' }}>{msg}</strong>
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

// ─── STYLES ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page:        { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', fontFamily: 'inherit' },
  ph:          { padding: '16px 24px 0', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexShrink: 0 },
  title:       { fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: '#1A1A2E' },
  subtitle:    { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  tabBar:      { padding: '12px 24px 0', display: 'flex', alignItems: 'flex-end', gap: 2, borderBottom: '1px solid #E2E8F0', flexShrink: 0 },
  tab:         { padding: '6px 14px', fontSize: 12, fontWeight: 600, color: '#64748B', cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: -1, borderRadius: '5px 5px 0 0', border: 'none', background: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', userSelect: 'none' },
  tabOn:       { color: '#3DA8D8', borderBottomColor: '#3DA8D8', fontWeight: 700 },
  tabCount:    { background: '#F1F5F9', color: '#64748B', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10 },
  tabCountOn:  { background: 'rgba(61,168,216,0.12)', color: '#3DA8D8' },
  fb:          { padding: '9px 24px', display: 'flex', alignItems: 'center', gap: 6, background: 'white', borderBottom: '1px solid #F1F5F9', flexShrink: 0 },
  chip:        { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid #E2E8F0', background: 'white', color: '#475569', fontFamily: 'inherit' },
  chipOn:      { background: 'rgba(61,168,216,0.08)', borderColor: 'rgba(61,168,216,0.35)', color: '#2986B4' },
  search:      { padding: '5px 10px 5px 28px', border: '1px solid #E2E8F0', borderRadius: 7, fontFamily: 'inherit', fontSize: 12, color: '#1A1A2E', outline: 'none', width: 200, background: 'white' },
  searchIcon:  { position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', fontSize: 12, pointerEvents: 'none' },
  empty:       { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#94A3B8' },
  emptyNote:   { fontSize: 11, color: '#94A3B8', fontStyle: 'italic' },
  table:       { width: '100%', borderCollapse: 'collapse' },
  th:          { position: 'sticky', top: 0, zIndex: 1, background: 'white', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#94A3B8', padding: '8px 14px', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' },
  tr:          { cursor: 'pointer', borderBottom: '1px solid #F1F5F9' },
  trSel:       { background: 'rgba(61,168,216,0.05)' },
  td:          { padding: '8px 14px', verticalAlign: 'middle', fontSize: 13 },
  nameCell:    { display: 'flex', alignItems: 'center', gap: 10 },
  av:          { width: 28, height: 28, borderRadius: '50%', color: 'white', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  pn:          { fontWeight: 700, color: '#1A1A2E', fontSize: 13 },
  rowActions:  { display: 'flex', gap: 4 },
  ra:          { padding: '3px 8px', borderRadius: 5, border: '1px solid #E2E8F0', background: 'white', color: '#64748B', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  countBadge:  { background: 'rgba(61,168,216,0.1)', color: '#2986B4', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, display: 'inline-block' },
  badgeGreen:  { background: '#DCFCE7', color: '#15803D', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, display: 'inline-block' },
  badgeGrey:   { background: '#F1F5F9', color: '#64748B', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, display: 'inline-block' },
  pw:          { width: 0, flexShrink: 0, overflow: 'hidden', transition: 'width .22s cubic-bezier(.4,0,.2,1)', borderLeft: '0px solid #E2E8F0', background: 'white' },
  pwOpen:      { width: 320, borderLeftWidth: 1 },
  pi:          { width: 320, height: '100%', display: 'flex', flexDirection: 'column' },
  phead:       { padding: '14px 16px 12px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'flex-start', gap: 10, flexShrink: 0 },
  pname:       { fontSize: 14, fontWeight: 800, color: '#1A1A2E', lineHeight: 1.2 },
  prole:       { fontSize: 11, color: '#64748B', marginTop: 2 },
  pcls:        { width: 26, height: 26, borderRadius: 6, border: '1px solid #E2E8F0', background: 'white', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  pbody:       { flex: 1, overflowY: 'auto', padding: '14px 16px' },
  psec:        { fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#94A3B8', padding: '12px 0 6px' },
  pfoot:       { padding: '10px 16px 14px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 8, flexShrink: 0 },
  detailCard:  { padding: '8px 10px', borderRadius: 6, border: '1px solid #E2E8F0', marginBottom: 5, background: '#FAFAFA' },
  btnPrimary:  { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: 'none', background: '#3DA8D8', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
};
