// Customers — the CRM hub. Two panes: a searchable customer list (left) and the
// selected customer's detail (right) with its Sites (each showing the on-site
// contact) and Contacts as expand/collapse sections. An "Unassigned" bucket
// surfaces sites/contacts with no customer_id. Standalone /data/site and
// /data/contact routes stay for power users; this is the primary way in.
//
// Data: /.netlify/functions/crm-customers (list / detail / unassigned).

import { useState, useEffect, useCallback } from 'react';
import {
  Building2, MapPin, User, Phone, Mail, ChevronDown, AlertTriangle, Search,
} from 'lucide-react';
import { HubLayout } from '../components/HubLayout';
import { Gate } from '../permissions/Gate';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { EqError } from '../components/EqError';

const SIDEBAR_RECORDS = defaultSidebarRecords();
const UNASSIGNED = '__unassigned__';

// ── Types ──────────────────────────────────────────────────────────────────
interface CustomerListItem {
  id: string; name: string; group: string | null; state: string | null;
  active: boolean; site_count: number; contact_count: number;
}
interface SiteItem {
  id: string; name: string; kind: string | null; suburb: string | null; state: string | null;
  contact: { name: string; phone: string | null; email: string | null } | null;
}
interface ContactItem { id: string; name: string; role: string | null; email: string | null; phone: string | null }
interface CustomerDetail {
  customer: { id: string; name: string; group: string | null; state: string | null; active: boolean; phone: string | null; email: string | null };
  sites: SiteItem[];
  contacts: ContactItem[];
}

// ── API ────────────────────────────────────────────────────────────────────
async function crmFetch(qs: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/.netlify/functions/crm-customers${qs}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '–';
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function CustomersHubPage() {
  return (
    <Gate perm="entity.view">
      <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
        <CustomersHubInner />
      </HubLayout>
    </Gate>
  );
}

function CustomersHubInner() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [orphan, setOrphan] = useState<{ sites: number; contacts: number }>({ sites: 0, contacts: 0 });
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [unassigned, setUnassigned] = useState<{ sites: SiteItem[]; contacts: ContactItem[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await crmFetch('?action=list');
      setCustomers((data.customers as CustomerListItem[]) ?? []);
      setOrphan((data.unassigned as { sites: number; contacts: number }) ?? { sites: 0, contacts: 0 });
    } catch {
      setError('Unable to load customers — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setUnassigned(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      try {
        if (selectedId === UNASSIGNED) {
          const data = await crmFetch('?action=unassigned');
          if (!cancelled) { setUnassigned({ sites: (data.sites as SiteItem[]) ?? [], contacts: (data.contacts as ContactItem[]) ?? [] }); setDetail(null); }
        } else {
          const data = await crmFetch(`?action=detail&id=${encodeURIComponent(selectedId)}`);
          if (!cancelled) { setDetail(data as unknown as CustomerDetail); setUnassigned(null); }
        }
      } catch {
        if (!cancelled) setError('Unable to load that customer.');
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const q = filter.trim().toLowerCase();
  const visible = q
    ? customers.filter((c) => c.name.toLowerCase().includes(q) || (c.group ?? '').toLowerCase().includes(q))
    : customers;

  return (
    <div>
      <div className="eq-page__header">
        <p style={eyebrow}>RECORDS · CRM</p>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 className="eq-page__title">Customers</h1>
            <p className="eq-page__lede">The spine of your records — each customer owns its sites and contacts.</p>
          </div>
        </div>
      </div>

      {error && <EqError title="Something went wrong" message={error} onRetry={() => void loadList()} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 360px) 1fr', gap: 0, border: '1px solid var(--eq-border)', borderRadius: 8, overflow: 'hidden', minHeight: 480 }}>
        {/* Left — list */}
        <div style={{ borderRight: '1px solid var(--eq-border)', display: 'flex', flexDirection: 'column', background: '#fff' }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--eq-border)' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--eq-grey)' }} />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Search ${customers.length} customers…`}
                style={{ width: '100%', padding: '8px 10px 8px 30px', border: '1px solid var(--eq-border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <p style={{ color: 'var(--eq-grey)', fontSize: 13, padding: 16 }}>Loading…</p>
            ) : (
              <>
                {visible.map((c) => (
                  <CustomerRow key={c.id} c={c} active={selectedId === c.id} onClick={() => setSelectedId(c.id)} />
                ))}
                {(orphan.sites > 0 || orphan.contacts > 0) && (
                  <button onClick={() => setSelectedId(UNASSIGNED)} style={{ ...rowBtn, background: selectedId === UNASSIGNED ? 'var(--eq-ice, #eaf5fb)' : '#fff', borderLeft: selectedId === UNASSIGNED ? '3px solid var(--eq-sky)' : '3px solid transparent' }}>
                    <span style={{ ...avatar, background: 'transparent', border: '1px dashed var(--eq-g300, #d4ccbe)', color: 'var(--eq-grey)' }}><AlertTriangle size={15} /></span>
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--eq-ink)' }}>Unassigned</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--eq-grey)' }}>Orphan records</span>
                    </span>
                    <span style={countPills}>
                      <span><MapPin size={11} /> {orphan.sites}</span>
                      <span><User size={11} /> {orphan.contacts}</span>
                    </span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right — detail */}
        <div style={{ overflowY: 'auto', background: 'var(--eq-canvas, #f5f4f0)' }}>
          {detailLoading ? (
            <p style={{ color: 'var(--eq-grey)', fontSize: 13, padding: 24 }}>Loading…</p>
          ) : selectedId === UNASSIGNED && unassigned ? (
            <UnassignedDetail data={unassigned} />
          ) : detail ? (
            <CustomerDetailView d={detail} />
          ) : (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--eq-grey)' }}>
              <Building2 size={32} style={{ marginBottom: 12 }} />
              <p style={{ fontSize: 14, margin: 0 }}>Select a customer to see its sites and contacts.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Left-pane row ──────────────────────────────────────────────────────────
function CustomerRow({ c, active, onClick }: { c: CustomerListItem; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...rowBtn, background: active ? 'var(--eq-ice, #eaf5fb)' : '#fff', borderLeft: active ? '3px solid var(--eq-sky)' : '3px solid transparent' }}>
      <span style={avatar}>{initials(c.name)}</span>
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5, color: 'var(--eq-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
        <span style={{ fontSize: 11.5, color: 'var(--eq-grey)' }}>{[c.group, c.state].filter(Boolean).join(' · ') || '—'}</span>
      </span>
      <span style={countPills}>
        <span><MapPin size={11} /> {c.site_count}</span>
        <span><User size={11} /> {c.contact_count}</span>
      </span>
    </button>
  );
}

// ── Right-pane: customer detail ─────────────────────────────────────────────
function CustomerDetailView({ d }: { d: CustomerDetail }) {
  const { customer, sites, contacts } = d;
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <span style={{ ...avatar, width: 48, height: 48, fontSize: 16, borderRadius: 10 }}>{initials(customer.name)}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--eq-ink)' }}>{customer.name}</h2>
            {customer.active && <span style={okPill}>● Active</span>}
            {customer.group && <span style={groupPill}>{customer.group}</span>}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 13, color: 'var(--eq-deep, #2986b4)', flexWrap: 'wrap' }}>
            {customer.phone && <a href={`tel:${customer.phone}`} style={metaLink}><Phone size={14} /> {customer.phone}</a>}
            {customer.email && <a href={`mailto:${customer.email}`} style={metaLink}><Mail size={14} /> {customer.email}</a>}
          </div>
        </div>
      </div>

      <Section icon={<MapPin size={15} />} title="Sites" count={sites.length} defaultOpen>
        {sites.length === 0
          ? <EmptyNote icon={<MapPin size={28} />} text="No sites yet" />
          : sites.map((s, i) => <SiteAccordion key={s.id} s={s} defaultOpen={i === 0} />)}
      </Section>

      <Section icon={<User size={15} />} title="Contacts" count={contacts.length} defaultOpen={sites.length === 0}>
        {contacts.length === 0
          ? <EmptyNote icon={<User size={28} />} text="No contacts yet" />
          : contacts.map((c) => <ContactRow key={c.id} c={c} />)}
      </Section>
    </div>
  );
}

function SiteAccordion({ s, defaultOpen }: { s: SiteItem; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: '1px solid var(--eq-border)', borderRadius: 6, marginBottom: 8, background: '#fff', overflow: 'hidden' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ ...avatar, width: 30, height: 30, borderRadius: 6, background: 'var(--eq-surface, #eeecea)', color: 'var(--eq-ink)' }}><MapPin size={14} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5, color: 'var(--eq-ink)' }}>{s.name}</span>
          <span style={{ fontSize: 12, color: 'var(--eq-grey)' }}>{[s.suburb, s.state].filter(Boolean).join(', ') || '—'}</span>
        </span>
        {s.kind && <span style={kindPill}>{s.kind}</span>}
        <ChevronDown size={16} style={{ color: 'var(--eq-grey)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }} />
      </button>
      {open && (
        <div style={{ padding: '10px 12px 12px 52px', background: 'var(--eq-g50, #f6f3ee)', borderTop: '1px solid var(--eq-border)' }}>
          {s.contact ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--eq-grey)' }}>ON-SITE</span>
              <span style={{ ...avatar, width: 30, height: 30 }}>{initials(s.contact.name)}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 13, color: 'var(--eq-ink)' }}>{s.contact.name}</span>
                {s.contact.phone && <span style={{ fontSize: 12, color: 'var(--eq-grey)' }}>{s.contact.phone}</span>}
              </span>
              {s.contact.phone && <a href={`tel:${s.contact.phone}`} style={reachBtn}><Phone size={13} /> Call</a>}
              {s.contact.email && <a href={`mailto:${s.contact.email}`} style={reachBtn}><Mail size={13} /> Email</a>}
            </div>
          ) : (
            <p style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--eq-grey)', margin: 0 }}>No on-site contact recorded.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ContactRow({ c }: { c: ContactItem }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--eq-border)', borderRadius: 6, marginBottom: 6, background: '#fff' }}>
      <span style={{ ...avatar, width: 34, height: 34 }}>{initials(c.name)}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5, color: 'var(--eq-ink)' }}>{c.name}</span>
        <span style={{ fontSize: 12, color: 'var(--eq-grey)' }}>{c.role ?? c.email ?? '—'}</span>
      </span>
      {c.phone && <a href={`tel:${c.phone}`} style={reachBtn}><Phone size={13} /> Call</a>}
      {c.email && <a href={`mailto:${c.email}`} style={reachBtn}><Mail size={13} /> Email</a>}
    </div>
  );
}

// ── Unassigned bucket ───────────────────────────────────────────────────────
function UnassignedDetail({ data }: { data: { sites: SiteItem[]; contacts: ContactItem[] } }) {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <span style={{ ...avatar, width: 48, height: 48, borderRadius: 10, background: 'transparent', border: '1px dashed var(--eq-g300, #d4ccbe)', color: 'var(--eq-grey)' }}><AlertTriangle size={20} /></span>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--eq-ink)' }}>Unassigned</h2>
      </div>
      <div style={{ padding: '10px 14px', background: 'var(--eq-warn-bg, #fffbeb)', border: '1px solid #f3e2bd', borderRadius: 6, fontSize: 13, color: 'var(--eq-ink)', marginBottom: 16 }}>
        {data.sites.length} site{data.sites.length === 1 ? '' : 's'} and {data.contacts.length} contact{data.contacts.length === 1 ? '' : 's'} have no customer. Assign each to a customer to fold it into the hierarchy.
      </div>
      <Section icon={<MapPin size={15} />} title="Sites" count={data.sites.length} defaultOpen>
        {data.sites.map((s, i) => <SiteAccordion key={s.id} s={s} defaultOpen={i === 0} />)}
      </Section>
      <Section icon={<User size={15} />} title="Contacts" count={data.contacts.length} defaultOpen={data.sites.length === 0}>
        {data.contacts.map((c) => <ContactRow key={c.id} c={c} />)}
      </Section>
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────
function Section({ icon, title, count, defaultOpen, children }: { icon: React.ReactNode; title: string; count: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div style={{ border: '1px solid var(--eq-border)', borderRadius: 8, marginBottom: 12, background: '#fff' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer' }}>
        <span style={{ ...avatar, width: 30, height: 30, borderRadius: 6, background: 'var(--eq-ice, #eaf5fb)', color: 'var(--eq-deep, #2986b4)' }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--eq-ink)' }}>{title}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: count === 0 ? 'var(--eq-grey)' : '#fff', background: count === 0 ? 'transparent' : 'var(--eq-ink)', border: count === 0 ? '1px solid var(--eq-border)' : 'none', borderRadius: 9999, padding: '1px 8px', minWidth: 18, textAlign: 'center' }}>{count}</span>
        <span style={{ flex: 1 }} />
        <ChevronDown size={16} style={{ color: 'var(--eq-grey)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }} />
      </button>
      {open && <div style={{ padding: '0 14px 14px' }}>{children}</div>}
    </div>
  );
}

function EmptyNote({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--eq-grey)' }}>
      <div style={{ marginBottom: 8 }}>{icon}</div>
      <p style={{ fontSize: 13, margin: 0 }}>{text}</p>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const eyebrow: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--eq-deep, #2986b4)', margin: '0 0 4px' };
const avatar: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 38, height: 38, borderRadius: 8, background: 'var(--eq-sky)', color: '#fff', fontSize: 13, fontWeight: 700 };
const rowBtn: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', border: 'none', borderBottom: '1px solid var(--eq-border)', cursor: 'pointer' };
const countPills: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end', fontSize: 11, fontWeight: 700, color: 'var(--eq-grey)' };
const okPill: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#15803D', background: '#F0FDF4', borderRadius: 9999, padding: '2px 9px' };
const groupPill: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--eq-clay, #a8572b)', border: '1px solid var(--eq-clay, #a8572b)', background: 'var(--eq-clay-bg, #fbf1e9)', borderRadius: 9999, padding: '2px 9px', textTransform: 'uppercase' };
const kindPill: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: 'var(--eq-grey)', background: 'var(--eq-g100, #efeae1)', borderRadius: 4, padding: '2px 7px', textTransform: 'uppercase' };
const metaLink: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--eq-deep, #2986b4)', textDecoration: 'none' };
const reachBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '5px 10px', border: '1px solid var(--eq-border)', borderRadius: 6, color: 'var(--eq-ink)', textDecoration: 'none', background: '#fff' };
