// CustomersPage — 3-column Finder-style view
// Route: /:tenant/customers

import { useCallback, useEffect, useState } from 'react';
import { Pencil, X, ChevronRight, Search, Building2, GitMerge, Link, Trash2, Archive } from 'lucide-react';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface CustomerItem {
  id: string;
  name: string;
  group: string | null;
  state: string | null;
  active: boolean;
  site_count: number;
  contact_count: number;
}

interface DetailSite {
  id: string;
  name: string;
  kind: string | null;
  code: string | null;
  suburb: string | null;
  state: string | null;
  contact: { name: string; phone: string | null; email: string | null } | null;
}

interface DetailContact {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  extra_customers?: { id: string; name: string }[];
}

interface CustomerDetail {
  id: string;
  name: string;
  group: string | null;
  state: string | null;
  suburb: string | null;
  active: boolean;
  phone: string | null;
  email: string | null;
  sites: DetailSite[];
  contacts: DetailContact[];
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

// ─── API ─────────────────────────────────────────────────────────────────────

async function crmFetch(params: Record<string, string>): Promise<Response> {
  const qs = new URLSearchParams(params);
  return fetch(`/.netlify/functions/crm-customers?${qs}`, { credentials: 'include' });
}

async function crmWrite(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/.netlify/functions/crm-write', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

// ─── SHARED FORM FIELD ────────────────────────────────────────────────────────

function FormField({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600, marginBottom: 3, display: 'block' }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', padding: '7px 9px', fontSize: 12, border: '1px solid #E2E8F0', borderRadius: 6, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', color: '#1A1A2E', background: 'white' }}
      />
    </div>
  );
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export function CustomersPage() {
  const [customers,     setCustomers]     = useState<CustomerItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [search,        setSearch]        = useState('');
  const [reload,        setReload]        = useState(0);

  const [selCustomerId, setSelCustomerId] = useState<string | null>(null);
  const [selSiteId,     setSelSiteId]     = useState<string | null>(null);
  const [detail,        setDetail]        = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailReload,  setDetailReload]  = useState(0);

  const [editCustomer, setEditCustomer] = useState<CustomerDetail | null>(null);
  const [editSite,     setEditSite]     = useState<DetailSite | null>(null);
  const [editContact,  setEditContact]  = useState<DetailContact | null>(null);

  // Multi-select + merge
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set());
  const [mergeOpen,    setMergeOpen]    = useState(false);

  const toggleSelected = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Contact cross-link picker
  const [linkContactId,  setLinkContactId]  = useState<string | null>(null);

  // Contact column search
  const [contactSearch, setContactSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    crmFetch({ action: 'list' })
      .then((r) => r.json() as Promise<{ ok: boolean; customers?: CustomerItem[]; error?: string }>)
      .then((r) => {
        if (!r.ok) { setError(r.error ?? 'Failed to load'); return; }
        setCustomers((r.customers ?? []).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => { setContactSearch(''); }, [selCustomerId]);

  useEffect(() => {
    if (!selCustomerId) { setDetail(null); return; }
    setDetailLoading(true);
    crmFetch({ action: 'detail', id: selCustomerId })
      .then((r) => r.json() as Promise<{ ok: boolean; customer?: CustomerDetail; sites?: DetailSite[]; contacts?: DetailContact[] }>)
      .then((r) => {
        if (r.ok && r.customer) {
          setDetail({ ...r.customer, sites: r.sites ?? [], contacts: r.contacts ?? [] });
        }
      })
      .catch(() => {})
      .finally(() => setDetailLoading(false));
  }, [selCustomerId, detailReload]);

  const handleMutated = useCallback(() => {
    setReload((n) => n + 1);
    setDetailReload((n) => n + 1);
  }, []);

  const filtered = search
    ? customers.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : customers;

  const selSite   = selSiteId ? (detail?.sites.find((s) => s.id === selSiteId) ?? null) : null;
  const col2Open  = selCustomerId !== null;

  const allContacts = detail?.contacts ?? [];
  const filteredContacts = contactSearch.trim()
    ? allContacts.filter((c) => {
        const q = contactSearch.toLowerCase();
        return c.name.toLowerCase().includes(q)
          || (c.role ?? '').toLowerCase().includes(q)
          || (c.email ?? '').toLowerCase().includes(q);
      })
    : allContacts;
  // Group by first letter of last_name (fallback to name)
  const contactGroups: Record<string, typeof allContacts> = {};
  for (const c of filteredContacts) {
    const letter = ((c.last_name ?? c.name)?.[0] ?? '#').toUpperCase();
    if (!contactGroups[letter]) contactGroups[letter] = [];
    contactGroups[letter].push(c);
  }
  const contactLetters = Object.keys(contactGroups).sort();

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS} fullWidth>
      <div style={s.page}>

        {/* Header */}
        <div style={s.ph}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ ...s.title, flex: 1 }}>Customers</h1>
            {selectedIds.size >= 2 && (
              <button
                type="button"
                style={{ ...s.btnPrimary, fontSize: 11, padding: '5px 10px', gap: 5 }}
                onClick={() => setMergeOpen(true)}
              >
                <GitMerge size={12} />
                Merge {selectedIds.size}
              </button>
            )}
          </div>
          <p style={s.subtitle}>
            {loading ? 'Loading…' : `${customers.length} customer${customers.length === 1 ? '' : 's'}`}
            {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
          </p>
        </div>

        {error ? (
          <div style={s.empty}><p style={{ color: '#EF4444' }}>{error}</p></div>
        ) : (
          <div style={s.cols}>

            {/* ── Column 1: Customer list ──────────────────────────────── */}
            <div style={s.col1}>
              <div style={s.colSearch}>
                <Search size={13} style={{ color: '#94A3B8', flexShrink: 0 }} aria-hidden />
                <input
                  type="text"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={s.searchInput}
                  aria-label="Search customers"
                />
                {search && (
                  <button type="button" style={s.clearBtn} onClick={() => setSearch('')} aria-label="Clear search">
                    <X size={11} />
                  </button>
                )}
              </div>
              <div style={s.colBody}>
                {loading ? (
                  <div style={s.colEmpty}>Loading…</div>
                ) : filtered.length === 0 ? (
                  <div style={s.colEmpty}>No customers found</div>
                ) : (
                  filtered.map((c) => (
                    <div key={c.id} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => {}} // controlled via onClick
                        onClick={(e) => toggleSelected(c.id, e)}
                        style={{ position: 'absolute', left: 8, zIndex: 1, cursor: 'pointer', flexShrink: 0 }}
                        aria-label={`Select ${c.name}`}
                      />
                      <button
                        type="button"
                        style={{ ...s.custRow, paddingLeft: 30, ...(selCustomerId === c.id ? s.custRowSel : {}), ...(selectedIds.has(c.id) ? { background: '#F0F9FF' } : {}), opacity: c.active ? 1 : 0.5 }}
                        onClick={() => {
                          if (selCustomerId === c.id) { setSelCustomerId(null); setSelSiteId(null); }
                          else { setSelCustomerId(c.id); setSelSiteId(null); }
                        }}
                      >
                        <div style={{ ...s.av, background: avatarColour(c.id), flexShrink: 0 }}>
                          {initials(c.name)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={s.custName}>{c.name}</div>
                          <div style={s.custMeta}>
                            {[
                              c.site_count    > 0 ? `${c.site_count} site${c.site_count === 1 ? '' : 's'}` : null,
                              c.contact_count > 0 ? `${c.contact_count} contact${c.contact_count === 1 ? '' : 's'}` : null,
                              c.group,
                            ].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        {selCustomerId === c.id && (
                          <ChevronRight size={13} style={{ color: '#3DA8D8', flexShrink: 0 }} aria-hidden />
                        )}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ── Right area: columns 2 + 3 ───────────────────────────── */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

              {/* Column 2: Sites */}
              <div style={{ ...s.col2, ...(col2Open ? s.col2Open : {}) }}>
                <div style={s.col2Inner}>
                  <div style={s.colHead}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={s.col2Title}>{detail?.name ?? ' '}</div>
                      <div style={s.col2Sub}>
                        {detailLoading ? 'Loading…'
                          : detail ? `${detail.sites.length} site${detail.sites.length === 1 ? '' : 's'}`
                          : ''}
                      </div>
                    </div>
                    {detail && (
                      <button
                        type="button"
                        style={s.editBtn}
                        onClick={() => setEditCustomer(detail)}
                        aria-label="Edit customer"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>
                  <div style={s.colBody}>
                    {detailLoading ? (
                      <div style={s.colEmpty}>Loading…</div>
                    ) : !detail ? null : detail.sites.length === 0 ? (
                      <div style={s.colEmpty}>No sites on file</div>
                    ) : (
                      detail.sites.map((site) => (
                        <button
                          key={site.id}
                          type="button"
                          style={{ ...s.siteRow, ...(selSiteId === site.id ? s.siteRowSel : {}) }}
                          onClick={() => setSelSiteId((prev) => (prev === site.id ? null : site.id))}
                        >
                          <Building2
                            size={13}
                            style={{ color: selSiteId === site.id ? '#3DA8D8' : '#94A3B8', flexShrink: 0, marginTop: 1 }}
                            aria-hidden
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={s.siteName}>{site.name}</div>
                            {(site.suburb || site.state) && (
                              <div style={s.siteMeta}>{[site.suburb, site.state].filter(Boolean).join(', ')}</div>
                            )}
                          </div>
                          <button
                            type="button"
                            style={s.editBtnSm}
                            onClick={(e) => { e.stopPropagation(); setEditSite(site); }}
                            aria-label={`Edit ${site.name}`}
                          >
                            <Pencil size={11} />
                          </button>
                          {selSiteId === site.id && (
                            <ChevronRight size={12} style={{ color: '#3DA8D8', flexShrink: 0 }} aria-hidden />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Column 3: Contacts */}
              <div style={s.col3}>
                {!selCustomerId ? (
                  <div style={s.col3Empty}>
                    <p style={{ color: '#94A3B8', fontSize: 13 }}>Select a customer to view sites and contacts</p>
                  </div>
                ) : (
                  <>
                    <div style={s.colHead}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={s.col2Title}>
                          {selSite ? selSite.name : 'Contacts'}
                        </div>
                        {selSite && (
                          <div style={s.col2Sub}>
                            {detail ? `${allContacts.length} customer contact${allContacts.length === 1 ? '' : 's'}` : ''}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Contact search bar */}
                    {detail && allContacts.length > 4 && (
                      <div style={{ ...s.colSearch, borderTop: 'none' }}>
                        <Search size={11} style={{ color: '#94A3B8', flexShrink: 0 }} aria-hidden />
                        <input
                          type="text"
                          placeholder="Filter contacts…"
                          value={contactSearch}
                          onChange={(e) => setContactSearch(e.target.value)}
                          style={{ ...s.searchInput, fontSize: 11 }}
                          aria-label="Filter contacts"
                        />
                        {contactSearch && (
                          <button type="button" style={s.clearBtn} onClick={() => setContactSearch('')} aria-label="Clear filter">
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    )}
                    <div style={s.colBody}>
                      {detailLoading ? (
                        <div style={s.colEmpty}>Loading…</div>
                      ) : !detail ? null : (
                        <>
                          {selSite?.contact && (
                            <>
                              <div style={s.sectionLabel}>Site contact</div>
                              <div style={s.contactRow}>
                                <div style={{ ...s.av, background: '#3DA8D8', flexShrink: 0 }}>
                                  {initials(selSite.contact.name)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={s.contactName}>{selSite.contact.name}</div>
                                  {selSite.contact.phone && <div style={s.contactMeta}>{selSite.contact.phone}</div>}
                                  {selSite.contact.email && <div style={s.contactMeta}>{selSite.contact.email}</div>}
                                </div>
                              </div>
                              <div style={s.sectionLabel}>Customer contacts</div>
                            </>
                          )}

                          {allContacts.length === 0 ? (
                            <div style={s.colEmpty}>No contacts on file</div>
                          ) : filteredContacts.length === 0 ? (
                            <div style={s.colEmpty}>No contacts match "{contactSearch}"</div>
                          ) : (
                            contactLetters.map((letter) => (
                              <div key={letter}>
                                <div style={s.alphaHeader}>{letter}</div>
                                {contactGroups[letter].map((c) => (
                                  <div key={c.id} style={s.contactRow}>
                                    <div style={{ ...s.av, background: avatarColour(c.id), flexShrink: 0 }}>
                                      {initials(c.name)}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={s.contactName}>{c.name}</div>
                                      {c.role  && <div style={s.contactRole}>{c.role}</div>}
                                      {c.phone && <div style={s.contactMeta}>{c.phone}</div>}
                                      {c.email && <div style={s.contactMeta}>{c.email}</div>}
                                      {(c.extra_customers ?? []).length > 0 && (
                                        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                          {(c.extra_customers ?? []).map((ec) => (
                                            <span key={ec.id} style={s.linkChip}>
                                              {ec.name}
                                              <button
                                                type="button"
                                                style={s.chipX}
                                                title="Remove link"
                                                onClick={async () => {
                                                  await crmWrite({ action: 'unlink_contact_customer', id: c.id, customer_id: ec.id });
                                                  handleMutated();
                                                }}
                                              >
                                                <X size={9} />
                                              </button>
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      style={s.editBtnSm}
                                      title="Link to another customer"
                                      onClick={() => setLinkContactId(c.id)}
                                      aria-label={`Link ${c.name} to another customer`}
                                    >
                                      <Link size={11} />
                                    </button>
                                    <button
                                      type="button"
                                      style={s.editBtnSm}
                                      onClick={() => setEditContact(c)}
                                      aria-label={`Edit ${c.name}`}
                                    >
                                      <Pencil size={11} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ))
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {editCustomer && (
        <EditCustomerModal
          customer={editCustomer}
          onClose={() => setEditCustomer(null)}
          onSaved={() => { setEditCustomer(null); handleMutated(); }}
        />
      )}
      {editSite && (
        <EditSiteModal
          site={editSite}
          onClose={() => setEditSite(null)}
          onSaved={() => { setEditSite(null); handleMutated(); }}
          onArchived={() => { setEditSite(null); handleMutated(); }}
          onDeleted={() => {
            if (selSiteId === editSite.id) setSelSiteId(null);
            setEditSite(null);
            handleMutated();
          }}
        />
      )}
      {editContact && (
        <EditContactModal
          contact={editContact}
          onClose={() => setEditContact(null)}
          onSaved={() => { setEditContact(null); handleMutated(); }}
        />
      )}
      {mergeOpen && selectedIds.size >= 2 && (
        <MergeCustomersModal
          customers={customers.filter((c) => selectedIds.has(c.id))}
          onClose={() => setMergeOpen(false)}
          onMerged={() => {
            setMergeOpen(false);
            setSelectedIds(new Set());
            setSelCustomerId(null);
            setSelSiteId(null);
            setReload((n) => n + 1);
          }}
        />
      )}
      {linkContactId && (
        <LinkContactModal
          contactId={linkContactId}
          currentCustomerId={selCustomerId ?? ''}
          customers={customers}
          onClose={() => setLinkContactId(null)}
          onLinked={() => { setLinkContactId(null); handleMutated(); }}
        />
      )}
    </HubLayout>
  );
}

// ─── MERGE CUSTOMERS MODAL ───────────────────────────────────────────────────

function MergeCustomersModal({ customers, onClose, onMerged }: {
  customers: CustomerItem[]; onClose: () => void; onMerged: () => void;
}) {
  const [winnerId, setWinnerId] = useState(customers[0].id);
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState<string | null>(null);

  const merge = async () => {
    setSaving(true); setErr(null);
    const loserIds = customers.filter((c) => c.id !== winnerId).map((c) => c.id);
    const res = await crmWrite({ action: 'merge_customers', id: winnerId, loser_ids: loserIds });
    setSaving(false);
    if (!res.ok) { setErr(res.error ?? 'Merge failed'); return; }
    onMerged();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <span style={s.modalTitle}>Merge customers</span>
          <button type="button" style={s.pcls} onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div style={s.modalBody}>
          <p style={{ fontSize: 12, color: '#64748B', marginBottom: 14 }}>
            Sites and contacts from the others will move to the selected record. The rest will be archived.
          </p>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>
            Keep this record as master
          </div>
          {customers.map((c) => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7, border: `1.5px solid ${winnerId === c.id ? '#3DA8D8' : '#E2E8F0'}`, marginBottom: 6, cursor: 'pointer', background: winnerId === c.id ? '#EAF5FB' : 'white' }}>
              <input type="radio" name="winner" value={c.id} checked={winnerId === c.id} onChange={() => setWinnerId(c.id)} style={{ accentColor: '#3DA8D8' }} />
              <div style={{ ...s.av, background: avatarColour(c.id), flexShrink: 0 }}>{initials(c.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.custName}>{c.name}</div>
                <div style={s.custMeta}>{[c.site_count > 0 && `${c.site_count} site${c.site_count === 1 ? '' : 's'}`, c.contact_count > 0 && `${c.contact_count} contact${c.contact_count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</div>
              </div>
              {winnerId !== c.id && <span style={{ fontSize: 10, color: '#EF4444', fontWeight: 600 }}>Will be archived</span>}
            </label>
          ))}
        </div>
        {err && <div style={s.modalErr}>{err}</div>}
        <div style={s.modalFoot}>
          <button type="button" style={s.btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...s.btnPrimary, opacity: saving ? 0.6 : 1, background: '#EF4444' }} onClick={merge} disabled={saving}>
            {saving ? 'Merging…' : 'Merge and archive others'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── LINK CONTACT TO CUSTOMER MODAL ──────────────────────────────────────────

function LinkContactModal({ contactId, currentCustomerId, customers, onClose, onLinked }: {
  contactId: string; currentCustomerId: string; customers: CustomerItem[];
  onClose: () => void; onLinked: () => void;
}) {
  const options = customers.filter((c) => c.id !== currentCustomerId && c.active);
  const [targetId, setTargetId] = useState(options[0]?.id ?? '');
  const [saving, setSaving]   = useState(false);
  const [err,    setErr]      = useState<string | null>(null);

  const save = async () => {
    if (!targetId) return;
    setSaving(true); setErr(null);
    const res = await crmWrite({ action: 'link_contact_customer', id: contactId, customer_id: targetId });
    setSaving(false);
    if (!res.ok) { setErr(res.error ?? 'Link failed'); return; }
    onLinked();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={{ ...s.modal, width: 360 }} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <span style={s.modalTitle}>Link to another customer</span>
          <button type="button" style={s.pcls} onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div style={s.modalBody}>
          <p style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
            The contact will appear in both customers' contact lists.
          </p>
          {options.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94A3B8' }}>No other customers available.</p>
          ) : (
            <div>
              <label style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600, marginBottom: 3, display: 'block' }}>Customer</label>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                style={{ width: '100%', padding: '7px 9px', fontSize: 12, border: '1px solid #E2E8F0', borderRadius: 6, fontFamily: 'inherit', color: '#1A1A2E' }}
              >
                {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
        </div>
        {err && <div style={s.modalErr}>{err}</div>}
        <div style={s.modalFoot}>
          <button type="button" style={s.btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...s.btnPrimary, opacity: (saving || !targetId) ? 0.6 : 1 }} onClick={save} disabled={saving || !targetId}>
            {saving ? 'Linking…' : 'Link contact'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EDIT CUSTOMER MODAL ─────────────────────────────────────────────────────

function EditCustomerModal({ customer, onClose, onSaved }: {
  customer: CustomerDetail; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    company_name:  customer.name   ?? '',
    email:         customer.email  ?? '',
    primary_phone: customer.phone  ?? '',
    suburb:        customer.suburb ?? '',
    state:         customer.state  ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState<string | null>(null);
  const set = (f: keyof typeof form) => (v: string) => setForm((p) => ({ ...p, [f]: v }));

  const save = async () => {
    setSaving(true); setErr(null);
    const res = await crmWrite({ action: 'update_customer', id: customer.id, ...form });
    setSaving(false);
    if (!res.ok) { setErr(res.error ?? 'Save failed'); return; }
    onSaved();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <span style={s.modalTitle}>Edit customer</span>
          <button type="button" style={s.pcls} onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div style={s.modalBody}>
          <FormField label="Company name"  value={form.company_name}  onChange={set('company_name')} />
          <FormField label="Email"         value={form.email}         onChange={set('email')}         type="email" />
          <FormField label="Phone"         value={form.primary_phone} onChange={set('primary_phone')} />
          <FormField label="Suburb"        value={form.suburb}        onChange={set('suburb')} />
          <FormField label="State"         value={form.state}         onChange={set('state')} />
        </div>
        {err && <div style={s.modalErr}>{err}</div>}
        <div style={s.modalFoot}>
          <button type="button" style={s.btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...s.btnPrimary, opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EDIT SITE MODAL ──────────────────────────────────────────────────────────

function EditSiteModal({ site, onClose, onSaved, onArchived, onDeleted }: {
  site: DetailSite; onClose: () => void; onSaved: () => void;
  onArchived: () => void; onDeleted: () => void;
}) {
  const [form, setForm] = useState({
    name:               site.name           ?? '',
    code:               site.code           ?? '',
    suburb:             site.suburb         ?? '',
    state:              site.state          ?? '',
    site_contact_name:  site.contact?.name  ?? '',
    site_contact_phone: site.contact?.phone ?? '',
    site_contact_email: site.contact?.email ?? '',
  });
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState<string | null>(null);
  const [danger,  setDanger]  = useState<null | 'archive' | 'delete'>(null);
  const set = (f: keyof typeof form) => (v: string) => setForm((p) => ({ ...p, [f]: v }));

  const save = async () => {
    if (!form.name.trim()) { setErr('Site name is required'); return; }
    setSaving(true); setErr(null);
    const res = await crmWrite({ action: 'update_site', id: site.id, ...form });
    setSaving(false);
    if (!res.ok) { setErr(res.error ?? 'Save failed'); return; }
    onSaved();
  };

  const archiveSite = async () => {
    setSaving(true); setErr(null);
    const res = await crmWrite({ action: 'archive_site', id: site.id });
    setSaving(false);
    if (!res.ok) { setErr(res.error ?? 'Archive failed'); setDanger(null); return; }
    onArchived();
  };

  const deleteSite = async () => {
    setSaving(true); setErr(null);
    const res = await crmWrite({ action: 'delete_site', id: site.id });
    setSaving(false);
    if (!res.ok) {
      setErr(res.error === 'site_has_records'
        ? 'This site has linked service records and cannot be deleted. Archive it instead.'
        : (res.error ?? 'Delete failed'));
      setDanger(null);
      return;
    }
    onDeleted();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <span style={s.modalTitle}>Edit site</span>
          <button type="button" style={s.pcls} onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div style={s.modalBody}>
          <FormField label="Site name" value={form.name}   onChange={set('name')} />
          <FormField label="Code"      value={form.code}   onChange={set('code')} />
          <FormField label="Suburb"    value={form.suburb} onChange={set('suburb')} />
          <FormField label="State"     value={form.state}  onChange={set('state')} />
          <div style={{ borderTop: '1px solid #E2E8F0', margin: '12px 0', paddingTop: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
              Site contact
            </div>
            <FormField label="Name"  value={form.site_contact_name}  onChange={set('site_contact_name')} />
            <FormField label="Phone" value={form.site_contact_phone} onChange={set('site_contact_phone')} />
            <FormField label="Email" value={form.site_contact_email} onChange={set('site_contact_email')} type="email" />
          </div>
          {/* Danger zone */}
          <div style={{ borderTop: '1px solid #FEE2E2', marginTop: 16, paddingTop: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#EF4444', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
              Danger zone
            </div>
            {danger === 'archive' ? (
              <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '10px 12px' }}>
                <p style={{ fontSize: 12, color: '#92400E', marginBottom: 8, margin: '0 0 8px' }}>
                  Archive this site? It will be hidden from all lists but service history is preserved.
                </p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" style={s.btnSecondary} onClick={() => setDanger(null)} disabled={saving}>Cancel</button>
                  <button type="button" style={{ ...s.btnPrimary, background: '#F97316', opacity: saving ? 0.6 : 1 }} onClick={archiveSite} disabled={saving}>
                    {saving ? 'Archiving…' : 'Archive site'}
                  </button>
                </div>
              </div>
            ) : danger === 'delete' ? (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 12px' }}>
                <p style={{ fontSize: 12, color: '#7F1D1D', marginBottom: 8, margin: '0 0 8px' }}>
                  Permanently delete this site? This cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" style={s.btnSecondary} onClick={() => setDanger(null)} disabled={saving}>Cancel</button>
                  <button type="button" style={{ ...s.btnPrimary, background: '#EF4444', opacity: saving ? 0.6 : 1 }} onClick={deleteSite} disabled={saving}>
                    {saving ? 'Deleting…' : 'Delete permanently'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid #FED7AA', background: 'white', color: '#F97316', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                  onClick={() => setDanger('archive')}
                >
                  <Archive size={11} />Archive
                </button>
                <button
                  type="button"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid #FECACA', background: 'white', color: '#EF4444', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                  onClick={() => setDanger('delete')}
                >
                  <Trash2 size={11} />Delete
                </button>
              </div>
            )}
          </div>
        </div>
        {err && <div style={s.modalErr}>{err}</div>}
        <div style={s.modalFoot}>
          <button type="button" style={s.btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...s.btnPrimary, opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EDIT CONTACT MODAL ───────────────────────────────────────────────────────

function EditContactModal({ contact, onClose, onSaved }: {
  contact: DetailContact; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    first_name:   contact.first_name ?? '',
    last_name:    contact.last_name  ?? '',
    position:     contact.role       ?? '',
    email:        contact.email      ?? '',
    mobile_phone: contact.phone      ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState<string | null>(null);
  const set = (f: keyof typeof form) => (v: string) => setForm((p) => ({ ...p, [f]: v }));

  const save = async () => {
    setSaving(true); setErr(null);
    const res = await crmWrite({ action: 'update_contact', id: contact.id, ...form });
    setSaving(false);
    if (!res.ok) { setErr(res.error ?? 'Save failed'); return; }
    onSaved();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <span style={s.modalTitle}>Edit contact</span>
          <button type="button" style={s.pcls} onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div style={s.modalBody}>
          <FormField label="First name"  value={form.first_name}   onChange={set('first_name')} />
          <FormField label="Last name"   value={form.last_name}    onChange={set('last_name')} />
          <FormField label="Position"    value={form.position}     onChange={set('position')} />
          <FormField label="Email"       value={form.email}        onChange={set('email')}        type="email" />
          <FormField label="Mobile"      value={form.mobile_phone} onChange={set('mobile_phone')} />
        </div>
        {err && <div style={s.modalErr}>{err}</div>}
        <div style={s.modalFoot}>
          <button type="button" style={s.btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...s.btnPrimary, opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page:        { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', fontFamily: 'inherit' },
  ph:          { padding: '16px 24px 12px', flexShrink: 0, borderBottom: '1px solid #E2E8F0' },
  title:       { fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: '#1A1A2E', margin: 0 },
  subtitle:    { fontSize: 11, color: '#94A3B8', marginTop: 3, marginBottom: 0 },
  empty:       { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },

  cols:        { flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' },

  col1:        { width: 260, flexShrink: 0, borderRight: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  colSearch:   { padding: '9px 12px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 },
  searchInput: { flex: 1, fontSize: 12, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', color: '#1A1A2E' },
  clearBtn:    { width: 18, height: 18, borderRadius: 4, border: 'none', background: '#F1F5F9', color: '#94A3B8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  colBody:     { flex: 1, overflowY: 'auto', padding: '4px 0' },
  colEmpty:    { padding: '20px 14px', fontSize: 12, color: '#94A3B8' },

  custRow:     { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' },
  custRowSel:  { background: '#EAF5FB' },
  custName:    { fontSize: 12, fontWeight: 700, color: '#1A1A2E', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  custMeta:    { fontSize: 10, color: '#94A3B8', marginTop: 1 },

  av:          { width: 28, height: 28, borderRadius: 7, color: 'white', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' },

  col2:        { width: 0, flexShrink: 0, overflow: 'hidden', transition: 'width .2s cubic-bezier(.4,0,.2,1)' },
  col2Open:    { width: 240, borderRight: '1px solid #E2E8F0' },
  col2Inner:   { width: 240, height: '100%', display: 'flex', flexDirection: 'column' },
  colHead:     { padding: '9px 12px 8px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  col2Title:   { fontSize: 12, fontWeight: 700, color: '#1A1A2E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  col2Sub:     { fontSize: 10, color: '#94A3B8', marginTop: 1 },

  siteRow:     { width: '100%', display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' },
  siteRowSel:  { background: '#EAF5FB' },
  siteName:    { fontSize: 12, fontWeight: 600, color: '#1A1A2E', lineHeight: 1.3 },
  siteMeta:    { fontSize: 10, color: '#94A3B8', marginTop: 1 },

  editBtn:     { width: 26, height: 26, borderRadius: 6, border: '1px solid #E2E8F0', background: 'white', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  editBtnSm:   { width: 22, height: 22, borderRadius: 5, border: '1px solid #E2E8F0', background: 'white', color: '#94A3B8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  col3:        { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  col3Empty:   { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px' },

  sectionLabel: { fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#94A3B8', padding: '10px 14px 4px' },
  alphaHeader:  { fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#CBD5E1', padding: '8px 12px 2px', position: 'sticky' as const, top: 0, background: 'white', zIndex: 1, borderBottom: '1px solid #F1F5F9' },
  contactRow:   { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', borderBottom: '1px solid #F1F5F9' },
  contactName:  { fontSize: 12, fontWeight: 700, color: '#1A1A2E' },
  contactRole:  { fontSize: 11, color: '#64748B', marginTop: 1 },
  contactMeta:  { fontSize: 11, color: '#94A3B8', marginTop: 1 },

  overlay:     { position: 'fixed', inset: 0, background: 'rgba(15,20,40,0.35)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal:       { background: 'white', borderRadius: 12, width: 420, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' },
  modalHead:   { padding: '14px 16px 12px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  modalTitle:  { fontSize: 14, fontWeight: 700, color: '#1A1A2E' },
  modalBody:   { flex: 1, overflowY: 'auto', padding: '16px' },
  modalErr:    { padding: '0 16px 8px', color: '#EF4444', fontSize: 12 },
  modalFoot:   { padding: '10px 16px 14px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 },
  pcls:        { width: 26, height: 26, borderRadius: 6, border: '1px solid #E2E8F0', background: 'white', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  btnPrimary:  { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: 'none', background: '#3DA8D8', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  btnSecondary:{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: '1px solid #E2E8F0', background: 'white', color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },

  linkChip:    { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 600, color: '#2986B4', background: '#EAF5FB', border: '1px solid #BAE4F7', borderRadius: 5, padding: '1px 5px 1px 6px' },
  chipX:       { width: 13, height: 13, border: 'none', background: 'transparent', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, borderRadius: 3 },
};
