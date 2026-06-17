// CustomersPage — rich list + detail panel
// Route: /:tenant/customers

import { useCallback, useEffect, useState } from 'react';
import { Pencil, X, Search, Building2, GitMerge, Link, Archive, UserPlus, Phone, Mail, AlertTriangle, Trash2 } from 'lucide-react';
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

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bpty\.?\s*ltd\.?/g, '')
    .replace(/\blimited\b/g, '')
    .replace(/\bp\/l\b/g, '')
    .replace(/\b(the|and|&|co\.?)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findDupGroups(customers: CustomerItem[]): CustomerItem[][] {
  const byNorm = new Map<string, CustomerItem[]>();
  for (const c of customers.filter((x) => x.active)) {
    const key = normalizeName(c.name);
    if (!key) continue;
    const g = byNorm.get(key) ?? [];
    g.push(c);
    byNorm.set(key, g);
  }
  return [...byNorm.values()].filter((g) => g.length >= 2);
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

  const [showArchived,  setShowArchived]  = useState(false);
  const [selCustomerId, setSelCustomerId] = useState<string | null>(null);
  const [detail,        setDetail]        = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailReload,  setDetailReload]  = useState(0);

  const [editCustomer, setEditCustomer] = useState<CustomerDetail | null>(null);
  const [editSite,     setEditSite]     = useState<DetailSite | null>(null);
  const [editContact,  setEditContact]  = useState<DetailContact | null>(null);

  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [mergeOpen,     setMergeOpen]     = useState(false);
  const [archivingBulk, setArchivingBulk] = useState(false);

  const [addContactOpen, setAddContactOpen] = useState(false);
  const [addSiteOpen,    setAddSiteOpen]    = useState(false);

  const [dupGroups, setDupGroups] = useState<CustomerItem[][]>([]);
  const [dupIdx,    setDupIdx]    = useState(0);

  const [linkContactId, setLinkContactId] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState('');

  const toggleSelected = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

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

  useEffect(() => {
    setDupGroups(findDupGroups(customers));
    setDupIdx(0);
  }, [customers]);

  const handleBulkArchive = useCallback(async () => {
    if (archivingBulk) return;
    setArchivingBulk(true);
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) => crmWrite({ action: 'archive_customer', id })));
    setArchivingBulk(false);
    setSelectedIds(new Set());
    if (selCustomerId && ids.includes(selCustomerId)) setSelCustomerId(null);
    setReload((n) => n + 1);
  }, [archivingBulk, selectedIds, selCustomerId]);

  const jumpToDupGroup = useCallback(() => {
    const group = dupGroups[dupIdx];
    if (!group) return;
    setSelectedIds(new Set(group.map((c) => c.id)));
    setDupIdx((i) => (i + 1) % dupGroups.length);
    setMergeOpen(true);
  }, [dupGroups, dupIdx]);

  const activeCount   = customers.filter((c) => c.active).length;
  const archivedCount = customers.length - activeCount;

  const filtered = customers.filter((c) => {
    if (!showArchived && !c.active) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const allContacts = detail?.contacts ?? [];
  const filteredContacts = contactSearch.trim()
    ? allContacts.filter((c) => {
        const q = contactSearch.toLowerCase();
        return c.name.toLowerCase().includes(q)
          || (c.role ?? '').toLowerCase().includes(q)
          || (c.email ?? '').toLowerCase().includes(q);
      })
    : allContacts;

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
        <div style={s.layout}>

          {/* ── Left panel: customer list ─────────────────────────────── */}
          <div style={s.listPanel}>
            <div style={s.listHead}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <h1 style={s.title}>Customers</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {dupGroups.length > 0 && selectedIds.size === 0 && (
                    <button
                      type="button"
                      title={`${dupGroups.length} possible duplicate group${dupGroups.length === 1 ? '' : 's'}`}
                      style={s.warnChip}
                      onClick={jumpToDupGroup}
                    >
                      <AlertTriangle size={11} />
                      {dupGroups.length} dup{dupGroups.length === 1 ? '' : 's'}
                    </button>
                  )}
                  {selectedIds.size >= 2 && (
                    <button type="button" style={s.chipBtn} onClick={() => setMergeOpen(true)}>
                      <GitMerge size={11} />Merge
                    </button>
                  )}
                  {selectedIds.size >= 1 && (
                    <button
                      type="button"
                      style={{ ...s.chipBtn, color: '#EF4444', borderColor: '#FECACA' }}
                      onClick={handleBulkArchive}
                      disabled={archivingBulk}
                    >
                      <Archive size={11} />
                      {archivingBulk ? 'Archiving…' : `Archive ${selectedIds.size}`}
                    </button>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ ...s.subtitle, marginBottom: 0 }}>
                  {loading ? 'Loading…' : `${filtered.length} customer${filtered.length === 1 ? '' : 's'}`}
                  {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
                </p>
                {!loading && archivedCount > 0 && (
                  <button
                    type="button"
                    style={{ fontSize: 10, fontWeight: 600, color: showArchived ? '#2986B4' : '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
                    onClick={() => setShowArchived((v) => !v)}
                  >
                    {showArchived ? `Hide archived` : `+${archivedCount} archived`}
                  </button>
                )}
              </div>
              <div style={s.searchWrap}>
                <Search size={13} style={{ color: '#94A3B8', flexShrink: 0 }} aria-hidden />
                <input
                  type="text"
                  placeholder="Search customers…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={s.searchInput}
                  aria-label="Search customers"
                />
                {search && (
                  <button type="button" style={s.clearBtn} onClick={() => setSearch('')} aria-label="Clear">
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            <div style={s.listBody}>
              {error ? (
                <p style={{ padding: '20px 16px', fontSize: 12, color: '#EF4444' }}>{error}</p>
              ) : loading ? (
                <p style={{ padding: '20px 16px', fontSize: 12, color: '#94A3B8' }}>Loading…</p>
              ) : filtered.length === 0 ? (
                <p style={{ padding: '20px 16px', fontSize: 12, color: '#94A3B8' }}>No customers found</p>
              ) : (
                filtered.map((c) => {
                  const isSel = selCustomerId === c.id;
                  const isChk = selectedIds.has(c.id);
                  return (
                    <div key={c.id} style={{ position: 'relative' }}>
                      <input
                        type="checkbox"
                        checked={isChk}
                        onChange={() => {}}
                        onClick={(e) => toggleSelected(c.id, e)}
                        style={{ position: 'absolute', left: 14, top: 18, zIndex: 1, cursor: 'pointer', accentColor: '#3DA8D8' }}
                        aria-label={`Select ${c.name}`}
                      />
                      <button
                        type="button"
                        style={{
                          ...s.custRow,
                          ...(isSel ? s.custRowSel : {}),
                          ...(isChk && !isSel ? { background: '#F0F9FF' } : {}),
                          opacity: c.active ? 1 : 0.45,
                        }}
                        onClick={() => {
                          setSelCustomerId(isSel ? null : c.id);
                        }}
                      >
                        <div style={{ ...s.av, background: avatarColour(c.id), flexShrink: 0 }}>
                          {initials(c.name)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={s.custName}>{c.name}</div>
                          {(c.group || c.state) && (
                            <div style={s.custMeta}>{[c.group, c.state].filter(Boolean).join(' · ')}</div>
                          )}
                          <div style={s.custCounts}>
                            {c.site_count > 0 && (
                              <span style={s.countPill}>
                                <Building2 size={9} aria-hidden style={{ display: 'inline', verticalAlign: 'middle' }} />
                                {' '}{c.site_count}
                              </span>
                            )}
                            {c.contact_count > 0 && (
                              <span style={s.countPill}>
                                <UserPlus size={9} aria-hidden style={{ display: 'inline', verticalAlign: 'middle' }} />
                                {' '}{c.contact_count}
                              </span>
                            )}
                            {!c.active && <span style={{ ...s.countPill, color: '#94A3B8' }}>archived</span>}
                          </div>
                        </div>
                        {isSel && (
                          <div style={{ width: 3, height: 36, background: '#3DA8D8', borderRadius: 2, flexShrink: 0 }} aria-hidden />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Right panel: detail ───────────────────────────────────── */}
          <div style={s.detailPanel}>
            {!selCustomerId ? (
              <div style={s.emptyState}>
                <div style={s.emptyIcon}><Building2 size={32} style={{ color: '#CBD5E1' }} aria-hidden /></div>
                <p style={s.emptyTitle}>No customer selected</p>
                <p style={s.emptyHint}>Pick a customer from the list to view their profile, sites, and contacts.</p>
              </div>
            ) : detailLoading ? (
              <div style={s.emptyState}>
                <p style={{ fontSize: 13, color: '#94A3B8' }}>Loading…</p>
              </div>
            ) : !detail ? null : (
              <div style={s.detailScroll}>

                {/* ── Customer header ── */}
                <div style={s.custHeader}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ ...s.avLg, background: avatarColour(detail.id) }}>
                        {initials(detail.name)}
                      </div>
                      <div>
                        <h2 style={s.detailName}>{detail.name}</h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
                          {detail.group && <span style={s.pill}>{detail.group}</span>}
                          {detail.state && <span style={s.pill}>{detail.state}</span>}
                          {!detail.active && <span style={{ ...s.pill, background: '#FEF2F2', color: '#B91C1C', borderColor: '#FECACA' }}>Archived</span>}
                        </div>
                      </div>
                    </div>
                    <button type="button" style={s.editBtn} onClick={() => setEditCustomer(detail)} aria-label="Edit customer">
                      <Pencil size={13} />
                    </button>
                  </div>

                  {(detail.phone || detail.email || detail.suburb || detail.state) && (
                    <div style={s.contactLines}>
                      {detail.phone && (
                        <a href={`tel:${detail.phone}`} style={s.contactLine}>
                          <Phone size={12} style={{ color: '#94A3B8', flexShrink: 0 }} aria-hidden />
                          {detail.phone}
                        </a>
                      )}
                      {detail.email && (
                        <a href={`mailto:${detail.email}`} style={s.contactLine}>
                          <Mail size={12} style={{ color: '#94A3B8', flexShrink: 0 }} aria-hidden />
                          {detail.email}
                        </a>
                      )}
                      {(detail.suburb || detail.state) && (
                        <span style={{ ...s.contactLine, textDecoration: 'none', color: '#64748B' }}>
                          <Building2 size={12} style={{ color: '#CBD5E1', flexShrink: 0 }} aria-hidden />
                          {[detail.suburb, detail.state].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Sites ── */}
                <div style={s.section}>
                  <div style={s.sectionHead}>
                    <span style={s.sectionLabel}>Sites</span>
                    <span style={s.sectionCount}>{detail.sites.length}</span>
                    <button
                      type="button"
                      style={{ ...s.editBtnSm, marginLeft: 'auto' }}
                      title="Add site"
                      onClick={() => setAddSiteOpen(true)}
                      aria-label="Add site"
                    >
                      <Building2 size={11} />
                    </button>
                  </div>
                  {detail.sites.length === 0 ? (
                    <p style={s.sectionEmpty}>No sites on file</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {detail.sites.map((site) => (
                        <div key={site.id} style={s.siteCard}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span style={s.siteName}>{site.name}</span>
                                {site.code && <span style={s.siteCode}>{site.code}</span>}
                                {site.kind && <span style={s.siteKind}>{site.kind}</span>}
                              </div>
                              {(site.suburb || site.state) && (
                                <p style={s.siteLoc}>{[site.suburb, site.state].filter(Boolean).join(', ')}</p>
                              )}
                              {site.contact && (
                                <div style={s.siteContactRow}>
                                  <div style={{ ...s.avSm, background: '#3DA8D8', flexShrink: 0 }}>
                                    {initials(site.contact.name)}
                                  </div>
                                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#475569' }}>{site.contact.name}</span>
                                  {site.contact.phone && (
                                    <a href={`tel:${site.contact.phone}`} style={s.inlineLink}>
                                      <Phone size={10} aria-hidden />{site.contact.phone}
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              style={s.editBtnSm}
                              onClick={() => setEditSite(site)}
                              aria-label={`Edit ${site.name}`}
                            >
                              <Pencil size={11} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Contacts ── */}
                <div style={s.section}>
                  <div style={s.sectionHead}>
                    <span style={s.sectionLabel}>Contacts</span>
                    <span style={s.sectionCount}>{allContacts.length}</span>
                    <button
                      type="button"
                      style={{ ...s.editBtnSm, marginLeft: 'auto' }}
                      title="Add contact"
                      onClick={() => setAddContactOpen(true)}
                      aria-label="Add contact"
                    >
                      <UserPlus size={11} />
                    </button>
                  </div>

                  {allContacts.length > 4 && (
                    <div style={{ ...s.searchWrap, marginBottom: 12 }}>
                      <Search size={12} style={{ color: '#94A3B8', flexShrink: 0 }} aria-hidden />
                      <input
                        type="text"
                        placeholder="Filter contacts…"
                        value={contactSearch}
                        onChange={(e) => setContactSearch(e.target.value)}
                        style={{ ...s.searchInput, fontSize: 12 }}
                        aria-label="Filter contacts"
                      />
                      {contactSearch && (
                        <button type="button" style={s.clearBtn} onClick={() => setContactSearch('')} aria-label="Clear">
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  )}

                  {allContacts.length === 0 ? (
                    <p style={s.sectionEmpty}>No contacts on file</p>
                  ) : filteredContacts.length === 0 ? (
                    <p style={s.sectionEmpty}>No contacts match &ldquo;{contactSearch}&rdquo;</p>
                  ) : (
                    <div>
                      {contactLetters.map((letter) => (
                        <div key={letter}>
                          <div style={s.alphaHeader}>{letter}</div>
                          {contactGroups[letter].map((c) => (
                            <div key={c.id} style={s.contactRow}>
                              <div style={{ ...s.av, background: avatarColour(c.id), flexShrink: 0 }}>
                                {initials(c.name)}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={s.contactName}>{c.name}</div>
                                {c.role && <div style={s.contactRole}>{c.role}</div>}
                                <div style={{ display: 'flex', gap: 14, marginTop: 4, flexWrap: 'wrap' }}>
                                  {c.phone && (
                                    <a href={`tel:${c.phone}`} style={s.contactLink}>
                                      <Phone size={10} aria-hidden style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />
                                      {c.phone}
                                    </a>
                                  )}
                                  {c.email && (
                                    <a href={`mailto:${c.email}`} style={s.contactLink}>
                                      <Mail size={10} aria-hidden style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />
                                      {c.email}
                                    </a>
                                  )}
                                </div>
                                {(c.extra_customers ?? []).length > 0 && (
                                  <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
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
                              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                <button
                                  type="button"
                                  style={s.editBtnSm}
                                  title="Link to another customer"
                                  onClick={() => setLinkContactId(c.id)}
                                  aria-label={`Link ${c.name}`}
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
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>

        </div>
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
      {addContactOpen && selCustomerId && (
        <AddContactModal
          customerId={selCustomerId}
          onClose={() => setAddContactOpen(false)}
          onSaved={() => { setAddContactOpen(false); handleMutated(); }}
        />
      )}
      {addSiteOpen && selCustomerId && (
        <AddSiteModal
          customerId={selCustomerId}
          onClose={() => setAddSiteOpen(false)}
          onSaved={() => { setAddSiteOpen(false); handleMutated(); }}
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
            The contact will appear in both customers&rsquo; contact lists.
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
          <div style={{ borderTop: '1px solid #FEE2E2', marginTop: 16, paddingTop: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#EF4444', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
              Danger zone
            </div>
            {danger === 'archive' ? (
              <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '10px 12px' }}>
                <p style={{ fontSize: 12, color: '#92400E', margin: '0 0 8px' }}>
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
                <p style={{ fontSize: 12, color: '#7F1D1D', margin: '0 0 8px' }}>
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

// ─── ADD CONTACT MODAL ───────────────────────────────────────────────────────

function AddContactModal({ customerId, onClose, onSaved }: {
  customerId: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ first_name: '', last_name: '', role: '', email: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState<string | null>(null);
  const set = (f: keyof typeof form) => (v: string) => setForm((p) => ({ ...p, [f]: v }));

  const save = async () => {
    if (!form.first_name.trim() && !form.last_name.trim()) { setErr('First or last name is required'); return; }
    setSaving(true); setErr(null);
    const res = await crmWrite({ action: 'add_contact', id: customerId, customer_id: customerId, ...form });
    setSaving(false);
    if (!res.ok) { setErr(res.error ?? 'Save failed'); return; }
    onSaved();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={{ ...s.modal, width: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <span style={s.modalTitle}>Add contact</span>
          <button type="button" style={s.pcls} onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div style={s.modalBody}>
          <FormField label="First name" value={form.first_name} onChange={set('first_name')} />
          <FormField label="Last name"  value={form.last_name}  onChange={set('last_name')} />
          <FormField label="Role"       value={form.role}       onChange={set('role')} />
          <FormField label="Email"      value={form.email}      onChange={set('email')}  type="email" />
          <FormField label="Mobile"     value={form.phone}      onChange={set('phone')} />
        </div>
        {err && <div style={s.modalErr}>{err}</div>}
        <div style={s.modalFoot}>
          <button type="button" style={s.btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...s.btnPrimary, opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving}>
            {saving ? 'Adding…' : 'Add contact'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ADD SITE MODAL ───────────────────────────────────────────────────────────

function AddSiteModal({ customerId, onClose, onSaved }: {
  customerId: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '', code: '', suburb: '', state: '',
    site_contact_name: '', site_contact_phone: '', site_contact_email: '',
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState<string | null>(null);
  const set = (f: keyof typeof form) => (v: string) => setForm((p) => ({ ...p, [f]: v }));

  const save = async () => {
    if (!form.name.trim()) { setErr('Site name is required'); return; }
    setSaving(true); setErr(null);
    const res = await crmWrite({ action: 'add_site', id: customerId, ...form });
    setSaving(false);
    if (!res.ok) { setErr(res.error ?? 'Save failed'); return; }
    onSaved();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={{ ...s.modal, width: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <span style={s.modalTitle}>Add site</span>
          <button type="button" style={s.pcls} onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div style={s.modalBody}>
          <FormField label="Site name *" value={form.name}   onChange={set('name')} />
          <FormField label="Code"        value={form.code}   onChange={set('code')} />
          <FormField label="Suburb"      value={form.suburb} onChange={set('suburb')} />
          <FormField label="State"       value={form.state}  onChange={set('state')} />
          <div style={{ borderTop: '1px solid #E2E8F0', margin: '12px 0', paddingTop: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
              Site contact (optional)
            </div>
            <FormField label="Name"  value={form.site_contact_name}  onChange={set('site_contact_name')} />
            <FormField label="Phone" value={form.site_contact_phone} onChange={set('site_contact_phone')} />
            <FormField label="Email" value={form.site_contact_email} onChange={set('site_contact_email')} type="email" />
          </div>
        </div>
        {err && <div style={s.modalErr}>{err}</div>}
        <div style={s.modalFoot}>
          <button type="button" style={s.btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...s.btnPrimary, opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving}>
            {saving ? 'Adding…' : 'Add site'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  // Layout
  page:         { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  layout:       { flex: 1, display: 'flex', overflow: 'hidden' },

  // List panel
  listPanel:    { width: 300, flexShrink: 0, borderRight: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#FAFBFC' },
  listHead:     { padding: '18px 16px 12px', borderBottom: '1px solid #E2E8F0', flexShrink: 0 },
  title:        { fontSize: 16, fontWeight: 700, color: '#1A1A2E', margin: 0, letterSpacing: '-0.01em' },
  subtitle:     { fontSize: 11, color: '#94A3B8', marginTop: 2, marginBottom: 10 },
  searchWrap:   { display: 'flex', alignItems: 'center', gap: 7, background: 'white', border: '1px solid #E2E8F0', borderRadius: 8, padding: '7px 10px' },
  searchInput:  { flex: 1, fontSize: 12, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', color: '#1A1A2E' },
  clearBtn:     { width: 18, height: 18, borderRadius: 4, border: 'none', background: '#F1F5F9', color: '#94A3B8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
  listBody:     { flex: 1, overflowY: 'auto' },

  // Customer rows
  custRow:      { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px 11px 34px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', borderBottom: '1px solid #F1F5F9' },
  custRowSel:   { background: '#EAF5FB', borderLeft: '3px solid #3DA8D8', paddingLeft: 31 },
  custName:     { fontSize: 13, fontWeight: 600, color: '#1A1A2E', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  custMeta:     { fontSize: 11, color: '#64748B', marginTop: 2 },
  custCounts:   { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 },
  countPill:    { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#94A3B8', background: '#F1F5F9', borderRadius: 4, padding: '1px 5px' },

  // Avatar
  av:           { width: 30, height: 30, borderRadius: 8, color: 'white', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  avLg:         { width: 44, height: 44, borderRadius: 10, color: 'white', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avSm:         { width: 20, height: 20, borderRadius: 5, color: 'white', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' },

  // Action chips
  chipBtn:      { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 6, border: '1px solid #E2E8F0', background: 'white', color: '#475569', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  warnChip:     { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 6, border: '1px solid #FED7AA', background: '#FFF7ED', color: '#D97706', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },

  // Detail panel
  detailPanel:  { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'white' },
  detailScroll: { flex: 1, overflowY: 'auto', padding: '0 0 40px' },

  // Empty state
  emptyState:   { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '40px 24px' },
  emptyIcon:    { width: 56, height: 56, borderRadius: 14, background: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  emptyTitle:   { fontSize: 14, fontWeight: 600, color: '#64748B', margin: 0 },
  emptyHint:    { fontSize: 12, color: '#94A3B8', textAlign: 'center', maxWidth: 280, margin: 0, lineHeight: 1.6 },

  // Customer header in detail
  custHeader:   { padding: '24px 28px 20px', borderBottom: '1px solid #F1F5F9' },
  detailName:   { fontSize: 18, fontWeight: 700, color: '#1A1A2E', margin: 0, letterSpacing: '-0.02em' },
  pill:         { display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 500, color: '#475569', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 5, padding: '2px 8px' },
  contactLines: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 },
  contactLine:  { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#3DA8D8', textDecoration: 'none' },

  // Sections
  section:      { padding: '20px 28px' },
  sectionHead:  { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 },
  sectionLabel: { fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '.06em', textTransform: 'uppercase' },
  sectionCount: { fontSize: 11, fontWeight: 600, color: '#CBD5E1', background: '#F8FAFC', borderRadius: 4, padding: '1px 6px' },
  sectionEmpty: { fontSize: 12, color: '#94A3B8', margin: 0 },

  // Site cards
  siteCard:     { background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '12px 14px' },
  siteName:     { fontSize: 13, fontWeight: 600, color: '#1A1A2E' },
  siteCode:     { fontSize: 10, fontWeight: 600, color: '#2986B4', background: '#EAF5FB', border: '1px solid #BAE4F7', borderRadius: 4, padding: '1px 6px' },
  siteKind:     { fontSize: 10, color: '#64748B', background: '#F1F5F9', borderRadius: 4, padding: '1px 6px' },
  siteLoc:      { fontSize: 11, color: '#64748B', margin: '2px 0 6px' },
  siteContactRow: { display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, padding: '5px 8px', background: 'white', border: '1px solid #E2E8F0', borderRadius: 6 },
  inlineLink:   { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#3DA8D8', textDecoration: 'none' },

  // Contact rows
  alphaHeader:  { fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#CBD5E1', padding: '8px 0 4px', borderBottom: '1px solid #F1F5F9', marginBottom: 2 },
  contactRow:   { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 0', borderBottom: '1px solid #F8FAFC' },
  contactName:  { fontSize: 13, fontWeight: 600, color: '#1A1A2E' },
  contactRole:  { fontSize: 11, color: '#64748B', marginTop: 1 },
  contactLink:  { fontSize: 11, color: '#2986B4', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' },

  // Edit buttons
  editBtn:      { width: 30, height: 30, borderRadius: 7, border: '1px solid #E2E8F0', background: 'white', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  editBtnSm:    { width: 24, height: 24, borderRadius: 5, border: '1px solid #E2E8F0', background: 'white', color: '#94A3B8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },

  // Chips
  linkChip:     { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: '#2986B4', background: '#EAF5FB', border: '1px solid #BAE4F7', borderRadius: 5, padding: '1px 5px 1px 6px' },
  chipX:        { width: 13, height: 13, border: 'none', background: 'transparent', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, borderRadius: 3 },

  // Modals
  overlay:      { position: 'fixed', inset: 0, background: 'rgba(15,20,40,0.35)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal:        { background: 'white', borderRadius: 12, width: 420, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' },
  modalHead:    { padding: '14px 16px 12px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  modalTitle:   { fontSize: 14, fontWeight: 700, color: '#1A1A2E' },
  modalBody:    { flex: 1, overflowY: 'auto', padding: '16px' },
  modalErr:     { padding: '0 16px 8px', color: '#EF4444', fontSize: 12 },
  modalFoot:    { padding: '10px 16px 14px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 },
  pcls:         { width: 26, height: 26, borderRadius: 6, border: '1px solid #E2E8F0', background: 'white', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  btnPrimary:   { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: 'none', background: '#3DA8D8', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  btnSecondary: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: '1px solid #E2E8F0', background: 'white', color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
};
