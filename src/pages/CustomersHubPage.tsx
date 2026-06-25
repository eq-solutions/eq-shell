// Customers — the CRM hub. Two panes: a hierarchical Records tree (left) and a
// detail panel (right). The tree shows Customer → Sites branch → Contacts branch,
// all expand/collapse inline. Clicking any node (Customer, Site, or Contact)
// loads the appropriate detail view on the right.
//
// Left pane level-filter tabs: All | Customers | Sites | Contacts
// Search filters by customer name/group; auto-expands matched customers.
//
// Data: /.netlify/functions/crm-customers (list / detail / unassigned).
// On-demand detail (sites + contacts) fetched per customer on first expand —
// cached in expandedData map, never re-fetched.
//
// Mutations: /.netlify/functions/crm-write (archive/delete/merge/link actions).

import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react';
import { DndContext, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import {
  Building2, MapPin, User, Phone, Mail, ChevronDown, ChevronRight,
  AlertTriangle, Search, Pencil, Download, Plus, X, Archive, Trash2,
  Link2, Merge, CheckCircle2,
} from 'lucide-react';
import { Button, Skeleton, Spinner } from '@eq-solutions/ui';
import { HubLayout } from '../components/HubLayout';
import { Gate } from '../permissions/Gate';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { EqError } from '../components/EqError';
import '../styles/records-tree.css';

const SIDEBAR_RECORDS = defaultSidebarRecords();
const UNASSIGNED = '__unassigned__';

const BRAND_PALETTE = ['#2986B4', '#1F4E6C', '#3DA8D8', '#5AC0E6', '#2E6E94'];
function brandColour(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return BRAND_PALETTE[h % BRAND_PALETTE.length];
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '–';
}

// ── Types ──────────────────────────────────────────────────────────────────

interface CustomerListItem {
  id: string; name: string; group: string | null; state: string | null;
  active: boolean; site_count: number; contact_count: number;
}

interface SiteItem {
  id: string; name: string; kind: string | null; suburb: string | null; state: string | null;
  contact: { name: string; phone: string | null; email: string | null } | null;
}

interface ContactItem {
  id: string; name: string; role: string | null; email: string | null; phone: string | null;
  extra_customers: { id: string; name: string }[];
  linked_sites: { id: string; name: string }[];
}

interface CustomerDetail {
  customer: {
    id: string; name: string; group: string | null; state: string | null;
    active: boolean; phone: string | null; email: string | null;
  };
  sites: SiteItem[];
  contacts: ContactItem[];
}

type Selection =
  | { kind: 'customer'; customerId: string }
  | { kind: 'site'; customerId: string; siteId: string }
  | { kind: 'contact'; customerId: string; contactId: string }
  | { kind: 'unassigned' };

type LevelFilter = 'all' | 'customers' | 'sites' | 'contacts';

// ── API ────────────────────────────────────────────────────────────────────

async function crmFetch(qs: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/.netlify/functions/crm-customers${qs}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function crmWrite(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  const res = await fetch('/.netlify/functions/crm-write', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

// ── Page shell ─────────────────────────────────────────────────────────────

export default function CustomersHubPage() {
  return (
    <Gate perm="entity.view">
      <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
        <CustomersHubInner />
      </HubLayout>
    </Gate>
  );
}

// ── Inner ──────────────────────────────────────────────────────────────────

function CustomersHubInner() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [orphan, setOrphan] = useState<{ sites: number; contacts: number }>({ sites: 0, contacts: 0 });

  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());
  const [unassignedOpen, setUnassignedOpen] = useState(false);
  const [unassignedBranchSites, setUnassignedBranchSites] = useState(true);
  const [unassignedBranchContacts, setUnassignedBranchContacts] = useState(true);

  const [expandedData, setExpandedData] = useState<Map<string, CustomerDetail>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  const [unassignedData, setUnassignedData] = useState<{ sites: SiteItem[]; contacts: ContactItem[] } | null>(null);
  const [unassignedLoading, setUnassignedLoading] = useState(false);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [filter, setFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Add-customer modal state
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);

  const treeRef = useRef<HTMLUListElement>(null);

  // ── Load list ───────────────────────────────────────────────────────────

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

  // ── Expand a customer node ──────────────────────────────────────────────

  const expandCustomer = useCallback(async (id: string) => {
    if (expandedData.has(id) || loadingIds.has(id)) return;
    setLoadingIds((prev) => new Set(prev).add(id));
    try {
      const data = await crmFetch(`?action=detail&id=${encodeURIComponent(id)}`);
      setExpandedData((prev) => {
        const next = new Map(prev);
        next.set(id, data as unknown as CustomerDetail);
        return next;
      });
    } catch {
      setError('Unable to load that customer.');
    } finally {
      setLoadingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [expandedData, loadingIds]);

  // Invalidate a customer's cached detail (used after mutations)
  const invalidateCustomer = useCallback((id: string) => {
    setExpandedData((prev) => { const next = new Map(prev); next.delete(id); return next; });
  }, []);

  const toggleCustomer = useCallback((id: string) => {
    setExpandedCustomers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else {
        next.add(id);
        void expandCustomer(id);
        setExpandedBranches((pb) => {
          const nb = new Set(pb);
          nb.add(`sites:${id}`);
          nb.add(`contacts:${id}`);
          return nb;
        });
      }
      return next;
    });
  }, [expandCustomer]);

  const toggleBranch = useCallback((key: string) => {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  }, []);

  const toggleUnassigned = useCallback(async () => {
    if (!unassignedOpen && !unassignedData && !unassignedLoading) {
      setUnassignedLoading(true);
      try {
        const data = await crmFetch('?action=unassigned');
        setUnassignedData({
          sites: (data.sites as SiteItem[]) ?? [],
          contacts: (data.contacts as ContactItem[]) ?? [],
        });
      } catch {
        setError('Unable to load unassigned records.');
      } finally {
        setUnassignedLoading(false);
      }
    }
    setUnassignedOpen((o) => !o);
  }, [unassignedOpen, unassignedData, unassignedLoading]);

  const select = useCallback((s: Selection) => {
    setSelection(s);
    setSheetOpen(true);
    if (s.kind === 'customer' && !expandedCustomers.has(s.customerId)) {
      toggleCustomer(s.customerId);
    }
  }, [expandedCustomers, toggleCustomer]);

  const isSelected = useCallback((s: Selection): boolean => {
    if (!selection) return false;
    if (s.kind !== selection.kind) return false;
    if (s.kind === 'customer' && selection.kind === 'customer') return s.customerId === selection.customerId;
    if (s.kind === 'site' && selection.kind === 'site') return s.siteId === selection.siteId;
    if (s.kind === 'contact' && selection.kind === 'contact') return s.contactId === selection.contactId;
    if (s.kind === 'unassigned' && selection.kind === 'unassigned') return true;
    return false;
  }, [selection]);

  // ── Filtering ───────────────────────────────────────────────────────────

  const q = filter.trim().toLowerCase();
  const filteredCustomers = q
    ? customers.filter((c) => c.name.toLowerCase().includes(q) || (c.group ?? '').toLowerCase().includes(q))
    : customers;

  useEffect(() => {
    if (!q) return;
    filteredCustomers.forEach((c) => {
      if (!expandedCustomers.has(c.id)) {
        setExpandedCustomers((prev) => new Set(prev).add(c.id));
        void expandCustomer(c.id);
        setExpandedBranches((pb) => {
          const nb = new Set(pb);
          nb.add(`sites:${c.id}`);
          nb.add(`contacts:${c.id}`);
          return nb;
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // ── Resolve detail for the right pane ──────────────────────────────────

  function resolveDetailData(): {
    kind: 'customer' | 'site' | 'contact' | 'unassigned' | 'none';
    customerDetail: CustomerDetail | null;
    site: SiteItem | null;
    contact: ContactItem | null;
    unassigned: { sites: SiteItem[]; contacts: ContactItem[] } | null;
  } {
    if (!selection) return { kind: 'none', customerDetail: null, site: null, contact: null, unassigned: null };
    if (selection.kind === 'unassigned') {
      return { kind: 'unassigned', customerDetail: null, site: null, contact: null, unassigned: unassignedData };
    }
    const cd = expandedData.get(selection.customerId) ?? null;
    if (selection.kind === 'customer') return { kind: 'customer', customerDetail: cd, site: null, contact: null, unassigned: null };
    if (selection.kind === 'site') {
      return { kind: 'site', customerDetail: cd, site: cd?.sites.find((s) => s.id === (selection as { siteId: string }).siteId) ?? null, contact: null, unassigned: null };
    }
    if (selection.kind === 'contact') {
      return { kind: 'contact', customerDetail: cd, site: null, contact: cd?.contacts.find((c) => c.id === (selection as { contactId: string }).contactId) ?? null, unassigned: null };
    }
    return { kind: 'none', customerDetail: null, site: null, contact: null, unassigned: null };
  }

  const detailResolved = resolveDetailData();
  const detailLoading = selection && selection.kind !== 'unassigned'
    && !expandedData.has((selection as { customerId: string }).customerId)
    && loadingIds.has((selection as { customerId: string }).customerId);

  // ── Keyboard navigation ─────────────────────────────────────────────────

  const nodeRefs = useRef<HTMLButtonElement[]>([]);
  const registerNode = useCallback((el: HTMLButtonElement | null) => {
    if (el && !nodeRefs.current.includes(el)) nodeRefs.current.push(el);
  }, []);

  function handleTreeKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const focused = document.activeElement as HTMLButtonElement | null;
    const nodes = nodeRefs.current.filter((n) => n.offsetParent !== null);
    const idx = focused ? nodes.indexOf(focused) : -1;
    if (e.key === 'ArrowDown') { e.preventDefault(); nodes[idx + 1]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); nodes[Math.max(0, idx - 1)]?.focus(); }
    else if (e.key === 'Enter' && focused) { e.preventDefault(); focused.click(); }
  }

  const countLabel = q
    ? `${filteredCustomers.length} match${filteredCustomers.length === 1 ? '' : 'es'}`
    : `${customers.length} customer${customers.length === 1 ? '' : 's'}`;

  // ── Drag-to-link ────────────────────────────────────────────────────────

  const [activeDragName, setActiveDragName] = useState<string | null>(null);
  const [dragMsg, setDragMsg] = useState<string | null>(null);

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { name: string } | undefined;
    setActiveDragName(data?.name ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragName(null);
    const { active, over } = event;
    if (!over) return;
    const data = active.data.current as { primaryCustomerId: string; name: string } | undefined;
    if (!data || data.primaryCustomerId === (over.id as string)) return;
    const targetId = over.id as string;
    const r = await crmWrite({ action: 'link_contact_customer', id: active.id as string, customer_id: targetId });
    const targetName = customers.find((c) => c.id === targetId)?.name ?? 'customer';
    const msg = r.ok ? `${data.name} linked to ${targetName}` : `Link failed: ${r.error ?? 'unknown'}`;
    setDragMsg(msg);
    setTimeout(() => setDragMsg(null), 3000);
    if (r.ok) {
      void loadList();
      invalidateCustomer(data.primaryCustomerId);
      invalidateCustomer(targetId);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="eq-page__header">
        <p style={eyebrow}>RECORDS · CRM</p>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="eq-page__title">Customers</h1>
            <p className="eq-page__lede">The spine of your records — each customer owns its sites and contacts.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" size="sm" icon={<Download size={15} />}>Export</Button>
            <Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => setAddCustomerOpen(true)}>Add customer</Button>
          </div>
        </div>
      </div>

      {error && <EqError title="Something went wrong" message={error} onRetry={() => void loadList()} />}
      {dragMsg && <div style={{ ...toastStyle, marginBottom: 0, marginTop: 8 }}><CheckCircle2 size={14} /> {dragMsg}</div>}

      <div className="crm-pane">
        {/* ── Left: tree pane ── */}
        <div className="crm-pane__list">
          <div style={{ padding: '10px 12px 0', borderBottom: 'none' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--eq-grey)', pointerEvents: 'none' }} aria-hidden="true" />
              <input
                className="crm-searchbox"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Search ${customers.length} customers…`}
                aria-label="Search customers"
                style={{ width: '100%', padding: '8px 10px 8px 30px', border: '1px solid var(--eq-border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, marginBottom: 8, fontSize: 11.5, color: 'var(--eq-grey)' }}>
              <span>{countLabel}</span>
            </div>
          </div>

          <div className="crm-tabs" role="tablist" aria-label="Level filter">
            {(['all', 'customers', 'sites', 'contacts'] as LevelFilter[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={levelFilter === t}
                className={`crm-tab${levelFilter === t ? ' is-active' : ''}`}
                onClick={() => setLevelFilter(t)}
              >
                {t === 'all' ? 'All' : t === 'customers' ? 'Customers' : t === 'sites' ? 'Sites' : 'Contacts'}
              </button>
            ))}
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Skeleton shape="circle" width={32} height={32} />
                    <div style={{ flex: 1 }}>
                      <Skeleton shape="text" width={`${55 + (i % 3) * 15}%`} />
                      <Skeleton shape="line" width="40%" style={{ marginTop: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <DndContext onDragStart={handleDragStart} onDragEnd={(e) => { void handleDragEnd(e); }} onDragCancel={() => setActiveDragName(null)}>
              <ul
                ref={treeRef}
                className="crm-tree"
                role="tree"
                aria-label="Records tree"
                onKeyDown={handleTreeKeyDown}
              >
                {levelFilter === 'all' && filteredCustomers.map((c) => (
                  <CustomerTreeNode
                    key={c.id}
                    c={c}
                    expanded={expandedCustomers.has(c.id)}
                    expandedBranches={expandedBranches}
                    detail={expandedData.get(c.id) ?? null}
                    loading={loadingIds.has(c.id)}
                    isSelected={isSelected}
                    onToggle={() => toggleCustomer(c.id)}
                    onToggleBranch={toggleBranch}
                    onSelect={select}
                    registerNode={registerNode}
                  />
                ))}

                {levelFilter === 'customers' && filteredCustomers.map((c) => (
                  <li key={c.id} className="crm-tree__customer">
                    <button
                      ref={registerNode}
                      role="treeitem"
                      aria-expanded={false}
                      className={`crm-tree__customer-row${isSelected({ kind: 'customer', customerId: c.id }) ? ' is-active' : ''}`}
                      onClick={() => select({ kind: 'customer', customerId: c.id })}
                    >
                      <AvatarSquare name={c.name} />
                      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5, color: 'var(--eq-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--eq-grey)' }}>{[c.group, c.state].filter(Boolean).join(' · ') || '—'}</span>
                      </span>
                      <span style={countPills}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><MapPin size={11} /> {c.site_count}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><User size={11} /> {c.contact_count}</span>
                      </span>
                    </button>
                  </li>
                ))}

                {levelFilter === 'sites' && filteredCustomers.map((c) => {
                  const cd = expandedData.get(c.id);
                  if (!cd && !loadingIds.has(c.id)) void expandCustomer(c.id);
                  return (
                    <li key={c.id}>
                      <div className="crm-tree__flat-header">
                        <AvatarSquare name={c.name} size={20} />
                        <span>{c.name}</span>
                        {[c.group, c.state].filter(Boolean).length > 0 && (
                          <span style={{ opacity: 0.6 }}>{[c.group, c.state].filter(Boolean).join(' · ')}</span>
                        )}
                      </div>
                      {loadingIds.has(c.id) && <TreeRowSkeleton />}
                      {cd?.sites.map((s) => (
                        <SiteLeafNode key={s.id} s={s} customerId={c.id} isSelected={isSelected} onSelect={select} registerNode={registerNode} indent={false} />
                      ))}
                    </li>
                  );
                })}

                {levelFilter === 'contacts' && filteredCustomers.map((c) => {
                  const cd = expandedData.get(c.id);
                  if (!cd && !loadingIds.has(c.id)) void expandCustomer(c.id);
                  return (
                    <li key={c.id}>
                      <div className="crm-tree__flat-header">
                        <AvatarSquare name={c.name} size={20} />
                        <span>{c.name}</span>
                        {[c.group, c.state].filter(Boolean).length > 0 && (
                          <span style={{ opacity: 0.6 }}>{[c.group, c.state].filter(Boolean).join(' · ')}</span>
                        )}
                      </div>
                      {loadingIds.has(c.id) && <TreeRowSkeleton />}
                      {cd?.contacts.map((ct) => (
                        <ContactLeafNode key={ct.id} ct={ct} customerId={c.id} isSelected={isSelected} onSelect={select} registerNode={registerNode} indent={false} />
                      ))}
                    </li>
                  );
                })}

                {levelFilter === 'all' && (orphan.sites > 0 || orphan.contacts > 0) && (
                  <li className="crm-tree__unassigned" role="treeitem" aria-expanded={unassignedOpen}>
                    <button
                      ref={registerNode}
                      className={`crm-tree__unassigned-row${isSelected({ kind: 'unassigned' }) ? ' is-active' : ''}`}
                      onClick={() => { void toggleUnassigned(); select({ kind: 'unassigned' }); }}
                      aria-expanded={unassignedOpen}
                    >
                      <ChevronRight size={14} className={`crm-tree__chevron${unassignedOpen ? ' is-open' : ''}`} aria-hidden="true" />
                      <span style={{ ...avatar, width: 32, height: 32, borderRadius: 8, background: 'transparent', border: '1px dashed var(--eq-gray-300)', color: 'var(--eq-grey)' }}>
                        <AlertTriangle size={14} aria-hidden="true" />
                      </span>
                      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5, color: 'var(--eq-ink)' }}>Unassigned</span>
                        <span style={{ fontSize: 11.5, color: 'var(--eq-grey)' }}>Orphan records</span>
                      </span>
                      <span style={countPills}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><MapPin size={11} /> {orphan.sites}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><User size={11} /> {orphan.contacts}</span>
                      </span>
                    </button>

                    {unassignedOpen && (
                      <div className="crm-tree__customer-body">
                        {unassignedLoading && <TreeRowSkeleton />}
                        {unassignedData && (
                          <>
                            <button className={`crm-tree__branch${unassignedBranchSites ? ' is-open' : ''}`} onClick={() => setUnassignedBranchSites((o) => !o)} aria-expanded={unassignedBranchSites}>
                              <ChevronRight size={12} aria-hidden="true" /><MapPin size={12} aria-hidden="true" />
                              Sites
                              <span className={`crm-tree__branch-count${unassignedData.sites.length > 0 ? ' has-items' : ''}`}>{unassignedData.sites.length}</span>
                            </button>
                            {unassignedBranchSites && unassignedData.sites.map((s) => (
                              <SiteLeafNode key={s.id} s={s} customerId={UNASSIGNED} isSelected={isSelected} onSelect={select} registerNode={registerNode} indent />
                            ))}
                            <button className={`crm-tree__branch${unassignedBranchContacts ? ' is-open' : ''}`} onClick={() => setUnassignedBranchContacts((o) => !o)} aria-expanded={unassignedBranchContacts}>
                              <ChevronRight size={12} aria-hidden="true" /><User size={12} aria-hidden="true" />
                              Contacts
                              <span className={`crm-tree__branch-count${unassignedData.contacts.length > 0 ? ' has-items' : ''}`}>{unassignedData.contacts.length}</span>
                            </button>
                            {unassignedBranchContacts && unassignedData.contacts.map((ct) => (
                              <ContactLeafNode key={ct.id} ct={ct} customerId={UNASSIGNED} isSelected={isSelected} onSelect={select} registerNode={registerNode} indent />
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                )}
              </ul>
              <DragOverlay dropAnimation={null}>
                {activeDragName && (
                  <div style={{ background: '#fff', padding: '6px 12px', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', fontSize: 13, fontWeight: 600, color: 'var(--eq-ink)', display: 'flex', alignItems: 'center', gap: 6, border: '2px solid #3DA8D8' }}>
                    <User size={13} style={{ color: '#3DA8D8' }} />
                    {activeDragName}
                  </div>
                )}
              </DragOverlay>
              </DndContext>
            )}
          </div>
        </div>

        {/* ── Right: detail pane (desktop) ── */}
        <div className="crm-pane__detail-col" style={{ overflowY: 'auto', background: 'var(--eq-content-bg, #f6f3ee)' }}>
          <DetailPane
            resolved={detailResolved}
            detailLoading={!!detailLoading}
            customers={customers}
            onLoadList={loadList}
            onInvalidateCustomer={invalidateCustomer}
          />
        </div>
      </div>

      {/* ── Mobile slide-up sheet ── */}
      <div className={`crm-detail-sheet${sheetOpen ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-label="Record detail">
        <div className="crm-detail-sheet__handle">
          <button onClick={() => setSheetOpen(false)} style={{ position: 'absolute', right: 12, top: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--eq-grey)', display: 'flex', alignItems: 'center', gap: 4 }} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <DetailPane
          resolved={detailResolved}
          detailLoading={!!detailLoading}
          customers={customers}
          onLoadList={loadList}
          onInvalidateCustomer={invalidateCustomer}
        />
      </div>

      {/* ── Add customer modal ── */}
      {addCustomerOpen && (
        <AddCustomerModal
          onClose={() => setAddCustomerOpen(false)}
          onCreated={() => { setAddCustomerOpen(false); void loadList(); }}
        />
      )}
    </div>
  );
}

// ── Tree row skeleton (inline loading state) ───────────────────────────────

function TreeRowSkeleton() {
  return (
    <div style={{ padding: '6px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
      {[70, 55, 80].map((w, i) => (
        <Skeleton key={i} shape="text" width={`${w}%`} />
      ))}
    </div>
  );
}

// ── Customer tree node ─────────────────────────────────────────────────────

interface CustomerTreeNodeProps {
  c: CustomerListItem; expanded: boolean; expandedBranches: Set<string>;
  detail: CustomerDetail | null; loading: boolean;
  isSelected: (s: Selection) => boolean;
  onToggle: () => void; onToggleBranch: (key: string) => void;
  onSelect: (s: Selection) => void; registerNode: (el: HTMLButtonElement | null) => void;
}

function CustomerTreeNode({ c, expanded, expandedBranches, detail, loading, isSelected, onToggle, onToggleBranch, onSelect, registerNode }: CustomerTreeNodeProps) {
  const sitesOpen = expandedBranches.has(`sites:${c.id}`);
  const contactsOpen = expandedBranches.has(`contacts:${c.id}`);
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: c.id });

  return (
    <li ref={setDropRef} className={`crm-tree__customer${isOver ? ' is-drop-target' : ''}`} role="treeitem" aria-expanded={expanded}>
      <button
        ref={registerNode}
        className={`crm-tree__customer-row${isSelected({ kind: 'customer', customerId: c.id }) ? ' is-active' : ''}`}
        onClick={() => { onToggle(); onSelect({ kind: 'customer', customerId: c.id }); }}
        aria-expanded={expanded}
        aria-label={`${c.name}, ${c.site_count} sites, ${c.contact_count} contacts`}
      >
        <ChevronRight size={14} className={`crm-tree__chevron${expanded ? ' is-open' : ''}`} aria-hidden="true" />
        <AvatarSquare name={c.name} />
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5, color: 'var(--eq-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
          <span style={{ fontSize: 11.5, color: 'var(--eq-grey)' }}>{[c.group, c.state].filter(Boolean).join(' · ') || '—'}</span>
        </span>
        <span style={countPills}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><MapPin size={11} /> {c.site_count}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><User size={11} /> {c.contact_count}</span>
        </span>
      </button>

      {expanded && (
        <div className="crm-tree__customer-body">
          {loading && <TreeRowSkeleton />}
          {detail && (
            <>
              <button ref={registerNode} className={`crm-tree__branch${sitesOpen ? ' is-open' : ''}`} onClick={() => onToggleBranch(`sites:${c.id}`)} aria-expanded={sitesOpen} aria-label={`Sites (${detail.sites.length})`}>
                <ChevronRight size={12} aria-hidden="true" /><MapPin size={12} aria-hidden="true" />
                Sites
                <span className={`crm-tree__branch-count${detail.sites.length > 0 ? ' has-items' : ''}`}>{detail.sites.length}</span>
              </button>
              {sitesOpen && detail.sites.map((s) => (
                <SiteLeafNode key={s.id} s={s} customerId={c.id} isSelected={isSelected} onSelect={onSelect} registerNode={registerNode} indent />
              ))}
              <button ref={registerNode} className={`crm-tree__branch${contactsOpen ? ' is-open' : ''}`} onClick={() => onToggleBranch(`contacts:${c.id}`)} aria-expanded={contactsOpen} aria-label={`Contacts (${detail.contacts.length})`}>
                <ChevronRight size={12} aria-hidden="true" /><User size={12} aria-hidden="true" />
                Contacts
                <span className={`crm-tree__branch-count${detail.contacts.length > 0 ? ' has-items' : ''}`}>{detail.contacts.length}</span>
              </button>
              {contactsOpen && detail.contacts.map((ct) => (
                <ContactLeafNode key={ct.id} ct={ct} customerId={c.id} isSelected={isSelected} onSelect={onSelect} registerNode={registerNode} indent />
              ))}
            </>
          )}
        </div>
      )}
    </li>
  );
}

// ── Site leaf node ─────────────────────────────────────────────────────────

interface SiteLeafNodeProps {
  s: SiteItem; customerId: string; isSelected: (s: Selection) => boolean;
  onSelect: (s: Selection) => void; registerNode: (el: HTMLButtonElement | null) => void; indent: boolean;
}

function SiteLeafNode({ s, customerId, isSelected, onSelect, registerNode, indent }: SiteLeafNodeProps) {
  const sel: Selection = { kind: 'site', customerId, siteId: s.id };
  return (
    <button ref={registerNode} role="treeitem" className={`crm-tree__site-row${isSelected(sel) ? ' is-active' : ''}`} style={indent ? undefined : { paddingLeft: 12 }} onClick={() => onSelect(sel)} aria-label={`Site: ${s.name}`}>
      <MapPin size={13} style={{ color: 'var(--eq-grey)', flexShrink: 0 }} aria-hidden="true" />
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 13, color: 'var(--eq-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
        {(s.suburb ?? s.state) && <span style={{ fontSize: 11, color: 'var(--eq-grey)' }}>{[s.suburb, s.state].filter(Boolean).join(', ')}</span>}
      </span>
      {s.kind && <span style={kindPill}>{s.kind}</span>}
      {s.contact && <span className="crm-tree__onsite-chip" title={s.contact.name}><User size={10} aria-hidden="true" /> {s.contact.name}</span>}
    </button>
  );
}

// ── Contact leaf node ──────────────────────────────────────────────────────

interface ContactLeafNodeProps {
  ct: ContactItem; customerId: string; isSelected: (s: Selection) => boolean;
  onSelect: (s: Selection) => void; registerNode: (el: HTMLButtonElement | null) => void; indent: boolean;
}

function ContactLeafNode({ ct, customerId, isSelected, onSelect, registerNode, indent }: ContactLeafNodeProps) {
  const sel: Selection = { kind: 'contact', customerId, contactId: ct.id };
  const { listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: ct.id,
    data: { primaryCustomerId: customerId, name: ct.name },
  });
  return (
    <button
      ref={(el) => { setDragRef(el); registerNode(el); }}
      role="treeitem"
      className={`crm-tree__contact-row${isSelected(sel) ? ' is-active' : ''}`}
      style={{ ...(indent ? undefined : { paddingLeft: 12 }), opacity: isDragging ? 0.35 : undefined, cursor: isDragging ? 'grabbing' : 'grab' }}
      onClick={() => onSelect(sel)}
      aria-label={`Contact: ${ct.name}`}
      {...listeners}
    >
      <span style={{ ...avatar, width: 28, height: 28, borderRadius: '50%', fontSize: 11, background: brandColour(ct.name), flexShrink: 0 }}>{initials(ct.name)}</span>
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 13, color: 'var(--eq-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ct.name}</span>
        <span style={{ fontSize: 11, color: 'var(--eq-grey)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ct.role ?? ct.email ?? '—'}
          {ct.extra_customers.length > 0 && <span style={{ marginLeft: 4, opacity: 0.7 }}>+{ct.extra_customers.length}</span>}
        </span>
      </span>
      <span className="crm-tree__reach">
        {ct.phone && <a href={`tel:${ct.phone}`} style={reachBtnSm} onClick={(e) => e.stopPropagation()} aria-label={`Call ${ct.name}`}><Phone size={12} /></a>}
        {ct.email && <a href={`mailto:${ct.email}`} style={reachBtnSm} onClick={(e) => e.stopPropagation()} aria-label={`Email ${ct.name}`}><Mail size={12} /></a>}
      </span>
    </button>
  );
}

// ── Right pane: detail dispatcher ─────────────────────────────────────────

type ResolvedDetail = {
  kind: 'customer' | 'site' | 'contact' | 'unassigned' | 'none';
  customerDetail: CustomerDetail | null;
  site: SiteItem | null;
  contact: ContactItem | null;
  unassigned: { sites: SiteItem[]; contacts: ContactItem[] } | null;
};

function DetailPane({
  resolved, detailLoading, customers, onLoadList, onInvalidateCustomer,
}: {
  resolved: ResolvedDetail; detailLoading: boolean;
  customers: CustomerListItem[];
  onLoadList: () => void;
  onInvalidateCustomer: (id: string) => void;
}) {
  if (detailLoading) return <DetailSkeleton />;
  if (resolved.kind === 'none') {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--eq-grey)' }}>
        <Building2 size={32} style={{ marginBottom: 12 }} />
        <p style={{ fontSize: 14, margin: 0 }}>Select a customer, site, or contact to see its details.</p>
      </div>
    );
  }
  if (resolved.kind === 'unassigned') {
    return resolved.unassigned
      ? <UnassignedDetail data={resolved.unassigned} />
      : <DetailSkeleton />;
  }
  if (resolved.kind === 'customer') {
    return resolved.customerDetail
      ? <CustomerDetailView d={resolved.customerDetail} onLoadList={onLoadList} onInvalidateCustomer={onInvalidateCustomer} />
      : <DetailSkeleton />;
  }
  if (resolved.kind === 'site' && resolved.site) {
    return <SiteDetailView s={resolved.site} customer={resolved.customerDetail?.customer ?? null} onLoadList={onLoadList} onInvalidateCustomer={onInvalidateCustomer} />;
  }
  if (resolved.kind === 'contact' && resolved.contact) {
    return <ContactDetailView ct={resolved.contact} customer={resolved.customerDetail?.customer ?? null} allCustomers={customers} allSites={resolved.customerDetail?.sites ?? []} onLoadList={onLoadList} onInvalidateCustomer={onInvalidateCustomer} />;
  }
  return <DetailSkeleton />;
}

function DetailSkeleton() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <Skeleton shape="circle" width={54} height={54} />
        <div style={{ flex: 1 }}>
          <Skeleton shape="text" width="55%" />
          <Skeleton shape="line" width="35%" style={{ marginTop: 6 }} />
        </div>
      </div>
      <Skeleton shape="card" style={{ marginBottom: 12 }} />
      <Skeleton shape="card" />
    </div>
  );
}

// ── Floating action bar ────────────────────────────────────────────────────

interface ActionBarProps {
  actions: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean; busy?: boolean }[];
}

function ActionBar({ actions }: ActionBarProps) {
  if (actions.length === 0) return null;
  return (
    <div style={{
      display: 'flex', gap: 6, padding: '10px 0 16px',
      borderTop: '1px solid var(--eq-border)', marginTop: 20,
    }}>
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={a.onClick}
          disabled={a.busy}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 12.5, padding: '6px 12px',
            border: `1px solid ${a.danger ? 'var(--eq-danger-border, #fca5a5)' : 'var(--eq-border)'}`,
            borderRadius: 6, cursor: a.busy ? 'not-allowed' : 'pointer',
            background: a.danger ? 'var(--eq-danger-bg, #fff5f5)' : '#fff',
            color: a.danger ? 'var(--eq-danger-text, #dc2626)' : 'var(--eq-ink)',
            opacity: a.busy ? 0.6 : 1,
          }}
        >
          {a.busy ? <Spinner size="sm" variant="ring" label="" /> : a.icon} {a.label}
        </button>
      ))}
    </div>
  );
}

// ── Right-pane: customer detail ────────────────────────────────────────────

function CustomerDetailView({ d, onLoadList, onInvalidateCustomer }: { d: CustomerDetail; onLoadList: () => void; onInvalidateCustomer: (id: string) => void }) {
  const { customer, sites, contacts } = d;
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function archive() {
    if (!confirm(`Archive ${customer.name}? It will be hidden from active views.`)) return;
    setBusy(true);
    const r = await crmWrite({ action: 'archive_customer', id: customer.id });
    setBusy(false);
    if (r.ok) { setToast('Archived'); onLoadList(); onInvalidateCustomer(customer.id); }
    else setToast(`Error: ${r.error ?? 'unknown'}`);
  }

  return (
    <div style={{ padding: 24 }}>
      {toast && (
        <div style={{ ...toastStyle, background: toast.startsWith('Error') ? 'var(--eq-danger-bg, #fff5f5)' : 'var(--eq-success-bg)' }}>
          <CheckCircle2 size={14} /> {toast}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <span style={{ ...avatar, width: 54, height: 54, fontSize: 18, borderRadius: 10, background: brandColour(customer.name) }}>{initials(customer.name)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--eq-ink)' }}>{customer.name}</h2>
            {customer.active && <span style={okPill}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} /> Active</span>}
            {customer.group && <span style={groupPill}>{customer.group}</span>}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 13, color: 'var(--eq-deep)', flexWrap: 'wrap' }}>
            {customer.phone && <a href={`tel:${customer.phone}`} style={metaLink}><Phone size={14} /> {customer.phone}</a>}
            {customer.email && <a href={`mailto:${customer.email}`} style={metaLink}><Mail size={14} /> {customer.email}</a>}
          </div>
        </div>
        <Button variant="ghost" size="sm" icon={<Pencil size={14} />}>Edit</Button>
      </div>

      <Section icon={<MapPin size={15} />} title="Sites" count={sites.length} defaultOpen>
        {sites.length === 0
          ? <EmptyNote icon={<MapPin size={28} />} text="No sites yet" helper="Link the first site to start mapping work and contacts to it." cta="Link a site" />
          : sites.map((s, i) => <SiteAccordion key={s.id} s={s} defaultOpen={i === 0} />)}
      </Section>

      <Section icon={<User size={15} />} title="Contacts" count={contacts.length} defaultOpen={sites.length === 0}>
        {contacts.length === 0
          ? <EmptyNote icon={<User size={28} />} text="No contacts yet" helper="Add the people you deal with here — they show against this customer everywhere." />
          : contacts.map((c) => <ContactRow key={c.id} c={c} />)}
      </Section>

      <ActionBar actions={[
        { label: 'Archive', icon: <Archive size={13} />, onClick: archive, busy },
        { label: 'Merge into…', icon: <Merge size={13} />, onClick: () => alert('Merge UI coming in Week 2') },
      ]} />
    </div>
  );
}

// ── Right-pane: site detail ────────────────────────────────────────────────

function SiteDetailView({ s, customer, onLoadList, onInvalidateCustomer }: { s: SiteItem; customer: CustomerDetail['customer'] | null; onLoadList: () => void; onInvalidateCustomer: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function archive() {
    if (!confirm(`Archive site "${s.name}"?`)) return;
    setBusy(true);
    const r = await crmWrite({ action: 'archive_site', id: s.id });
    setBusy(false);
    if (r.ok) { setToast('Archived'); if (customer) { onLoadList(); onInvalidateCustomer(customer.id); } }
    else setToast(`Error: ${r.error ?? 'unknown'}`);
  }

  async function deleteSite() {
    if (!confirm(`Permanently delete site "${s.name}"? This cannot be undone.`)) return;
    setBusy(true);
    const r = await crmWrite({ action: 'delete_site', id: s.id });
    setBusy(false);
    if (r.ok) { setToast('Deleted'); if (customer) { onLoadList(); onInvalidateCustomer(customer.id); } }
    else if (r.error === 'site_has_records') setToast('This site has linked service records — archive it instead.');
    else setToast(`Error: ${r.error ?? 'unknown'}`);
  }

  return (
    <div style={{ padding: 24 }}>
      {toast && <div style={toastStyle}><CheckCircle2 size={14} /> {toast}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <span style={{ ...avatar, width: 48, height: 48, borderRadius: 10, background: 'var(--eq-ice)', color: 'var(--eq-deep)' }}><MapPin size={20} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--eq-ink)' }}>{s.name}</h2>
            {s.kind && <span style={kindPill}>{s.kind}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {[s.suburb, s.state].filter(Boolean).length > 0 && <span style={{ fontSize: 13, color: 'var(--eq-grey)' }}>{[s.suburb, s.state].filter(Boolean).join(', ')}</span>}
            {customer && <span style={{ fontSize: 13, color: 'var(--eq-grey)' }}>· {customer.name}</span>}
          </div>
        </div>
      </div>

      {s.contact ? (
        <div style={{ border: '1px solid var(--eq-border)', borderRadius: 8, background: '#fff', padding: '14px 16px', marginBottom: 12 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--eq-grey)', margin: '0 0 10px' }}>On-site contact</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ ...avatar, width: 40, height: 40, borderRadius: '50%', background: brandColour(s.contact.name) }}>{initials(s.contact.name)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--eq-ink)' }}>{s.contact.name}</div>
              {s.contact.phone && <div style={{ fontSize: 12.5, color: 'var(--eq-grey)' }}>{s.contact.phone}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {s.contact.phone && <a href={`tel:${s.contact.phone}`} style={reachBtn}><Phone size={13} /> Call</a>}
              {s.contact.email && <a href={`mailto:${s.contact.email}`} style={reachBtn}><Mail size={13} /> Email</a>}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ border: '1px dashed var(--eq-border)', borderRadius: 8, padding: '14px 16px', color: 'var(--eq-grey)', fontSize: 13, fontStyle: 'italic' }}>No on-site contact recorded.</div>
      )}

      <ActionBar actions={[
        { label: 'Archive', icon: <Archive size={13} />, onClick: archive, busy },
        { label: 'Delete', icon: <Trash2 size={13} />, onClick: deleteSite, danger: true, busy },
      ]} />
    </div>
  );
}

// ── Right-pane: contact detail ─────────────────────────────────────────────

function ContactDetailView({ ct, customer, allCustomers, allSites, onLoadList, onInvalidateCustomer }: {
  ct: ContactItem; customer: CustomerDetail['customer'] | null;
  allCustomers: CustomerListItem[];
  allSites: SiteItem[];
  onLoadList: () => void; onInvalidateCustomer: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [siteLinkOpen, setSiteLinkOpen] = useState(false);
  const [siteLinkBusy, setSiteLinkBusy] = useState<string | null>(null);

  async function archive() {
    if (!confirm(`Archive ${ct.name}?`)) return;
    setBusy(true);
    const r = await crmWrite({ action: 'archive_contact', id: ct.id });
    setBusy(false);
    if (r.ok) { setToast('Archived'); if (customer) { onLoadList(); onInvalidateCustomer(customer.id); } }
    else setToast(`Error: ${r.error ?? 'unknown'}`);
  }

  async function deleteContact() {
    if (!confirm(`Permanently delete ${ct.name}? This cannot be undone.`)) return;
    setBusy(true);
    const r = await crmWrite({ action: 'delete_contact', id: ct.id });
    setBusy(false);
    if (r.ok) { setToast('Deleted'); if (customer) { onLoadList(); onInvalidateCustomer(customer.id); } }
    else setToast(`Error: ${r.error ?? 'unknown'}`);
  }

  async function unlink(customerId: string, customerName: string) {
    if (!confirm(`Remove ${ct.name} from ${customerName}?`)) return;
    setLinkBusy(customerId);
    const r = await crmWrite({ action: 'unlink_contact_customer', id: ct.id, customer_id: customerId });
    setLinkBusy(null);
    if (r.ok) { setToast('Removed'); if (customer) { onLoadList(); onInvalidateCustomer(customer.id); } }
    else setToast(`Error: ${r.error ?? 'unknown'}`);
  }

  async function linkTo(customerId: string) {
    setLinkBusy(customerId);
    const r = await crmWrite({ action: 'link_contact_customer', id: ct.id, customer_id: customerId });
    setLinkBusy(null);
    setLinkOpen(false);
    if (r.ok) { setToast('Linked'); if (customer) { onLoadList(); onInvalidateCustomer(customer.id); } }
    else setToast(`Error: ${r.error ?? 'unknown'}`);
  }

  async function unlinkSite(siteId: string, siteName: string) {
    if (!confirm(`Remove ${ct.name} from ${siteName}?`)) return;
    setSiteLinkBusy(siteId);
    const r = await crmWrite({ action: 'unlink_contact_site', id: ct.id, site_id: siteId });
    setSiteLinkBusy(null);
    if (r.ok) { setToast('Removed from site'); if (customer) { onLoadList(); onInvalidateCustomer(customer.id); } }
    else setToast(`Error: ${r.error ?? 'unknown'}`);
  }

  async function linkToSite(siteId: string) {
    setSiteLinkBusy(siteId);
    const r = await crmWrite({ action: 'link_contact_site', id: ct.id, site_id: siteId });
    setSiteLinkBusy(null);
    setSiteLinkOpen(false);
    if (r.ok) { setToast('Linked to site'); if (customer) { onLoadList(); onInvalidateCustomer(customer.id); } }
    else setToast(`Error: ${r.error ?? 'unknown'}`);
  }

  // All customers this contact is NOT already linked to
  const linkedIds = new Set([customer?.id, ...ct.extra_customers.map((x) => x.id)].filter(Boolean) as string[]);
  const available = allCustomers.filter((c) => !linkedIds.has(c.id));

  // Sites this contact is NOT already linked to
  const linkedSiteIds = new Set(ct.linked_sites.map((s) => s.id));
  const availableSites = allSites.filter((s) => !linkedSiteIds.has(s.id));

  return (
    <div style={{ padding: 24 }}>
      {toast && <div style={toastStyle}><CheckCircle2 size={14} /> {toast}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <span style={{ ...avatar, width: 52, height: 52, borderRadius: '50%', fontSize: 17, background: brandColour(ct.name) }}>{initials(ct.name)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px', color: 'var(--eq-ink)' }}>{ct.name}</h2>
          {ct.role && <div style={{ fontSize: 13, color: 'var(--eq-grey)' }}>{ct.role}</div>}
        </div>
      </div>

      {/* Reach */}
      <div style={{ border: '1px solid var(--eq-border)', borderRadius: 8, background: '#fff', padding: '14px 16px', marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--eq-grey)', margin: '0 0 10px' }}>Reach</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ct.phone && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--eq-ink)' }}><Phone size={14} style={{ color: 'var(--eq-deep)' }} /> {ct.phone}</span>
              <a href={`tel:${ct.phone}`} style={reachBtn}><Phone size={13} /> Call</a>
            </div>
          )}
          {ct.email && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--eq-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0, marginRight: 8 }}><Mail size={14} style={{ color: 'var(--eq-deep)', flexShrink: 0 }} /> {ct.email}</span>
              <a href={`mailto:${ct.email}`} style={reachBtn}><Mail size={13} /> Email</a>
            </div>
          )}
          {!ct.phone && !ct.email && <p style={{ fontSize: 13, color: 'var(--eq-grey)', margin: 0, fontStyle: 'italic' }}>No contact details on record.</p>}
        </div>
      </div>

      {/* Customer associations */}
      <div style={{ border: '1px solid var(--eq-border)', borderRadius: 8, background: '#fff', padding: '14px 16px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--eq-grey)', margin: 0 }}>Linked to</p>
          <button onClick={() => setLinkOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--eq-deep)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <Link2 size={12} /> Add link
          </button>
        </div>

        {/* Primary customer */}
        {customer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: ct.extra_customers.length > 0 ? '1px solid var(--eq-border)' : 'none' }}>
            <AvatarSquare name={customer.name} size={24} />
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: 'var(--eq-ink)' }}>{customer.name}</span>
            <span style={{ fontSize: 11, color: 'var(--eq-grey)', background: 'var(--eq-gray-100)', borderRadius: 4, padding: '2px 6px' }}>primary</span>
          </div>
        )}

        {/* Extra linked customers */}
        {ct.extra_customers.map((xc) => (
          <div key={xc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--eq-border)' }}>
            <AvatarSquare name={xc.name} size={24} />
            <span style={{ flex: 1, fontSize: 13.5, color: 'var(--eq-ink)' }}>{xc.name}</span>
            <button
              onClick={() => void unlink(xc.id, xc.name)}
              disabled={linkBusy === xc.id}
              style={{ fontSize: 11.5, color: 'var(--eq-grey)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
              title="Remove link"
            >
              <X size={13} />
            </button>
          </div>
        ))}

        {/* Link-to picker */}
        {linkOpen && (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--eq-border)', paddingTop: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--eq-grey)', margin: '0 0 6px' }}>Link to another customer:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
              {available.length === 0 && <p style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--eq-grey)', margin: 0 }}>Already linked to all customers.</p>}
              {available.map((c) => (
                <button
                  key={c.id}
                  onClick={() => void linkTo(c.id)}
                  disabled={linkBusy === c.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', border: '1px solid var(--eq-border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13, textAlign: 'left', opacity: linkBusy === c.id ? 0.5 : 1 }}
                >
                  <AvatarSquare name={c.name} size={20} />
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Site associations */}
      {(ct.linked_sites.length > 0 || allSites.length > 0) && (
        <div style={{ border: '1px solid var(--eq-border)', borderRadius: 8, background: '#fff', padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: ct.linked_sites.length > 0 ? 10 : 0 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--eq-grey)', margin: 0 }}>Sites</p>
            {availableSites.length > 0 && (
              <button onClick={() => setSiteLinkOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--eq-deep)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <Link2 size={12} /> Add site
              </button>
            )}
          </div>

          {ct.linked_sites.map((sl, i) => (
            <div key={sl.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: i > 0 ? '1px solid var(--eq-border)' : 'none' }}>
              <MapPin size={14} style={{ color: 'var(--eq-deep)', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13.5, color: 'var(--eq-ink)' }}>{sl.name}</span>
              <button
                onClick={() => void unlinkSite(sl.id, sl.name)}
                disabled={siteLinkBusy === sl.id}
                style={{ fontSize: 11.5, color: 'var(--eq-grey)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                title="Remove from site"
              >
                <X size={13} />
              </button>
            </div>
          ))}

          {ct.linked_sites.length === 0 && !siteLinkOpen && (
            <p style={{ fontSize: 12.5, color: 'var(--eq-grey)', margin: 0, fontStyle: 'italic' }}>Not linked to any sites yet.</p>
          )}

          {siteLinkOpen && (
            <div style={{ marginTop: ct.linked_sites.length > 0 ? 10 : 0, borderTop: ct.linked_sites.length > 0 ? '1px solid var(--eq-border)' : 'none', paddingTop: ct.linked_sites.length > 0 ? 10 : 0 }}>
              <p style={{ fontSize: 12, color: 'var(--eq-grey)', margin: '0 0 6px' }}>Link to a site:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                {availableSites.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => void linkToSite(s.id)}
                    disabled={siteLinkBusy === s.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', border: '1px solid var(--eq-border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13, textAlign: 'left', opacity: siteLinkBusy === s.id ? 0.5 : 1 }}
                  >
                    <MapPin size={13} style={{ color: 'var(--eq-deep)', flexShrink: 0 }} />
                    {s.name}
                    {s.suburb && <span style={{ fontSize: 11.5, color: 'var(--eq-grey)', marginLeft: 'auto' }}>{s.suburb}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <ActionBar actions={[
        { label: 'Archive', icon: <Archive size={13} />, onClick: archive, busy },
        { label: 'Delete', icon: <Trash2 size={13} />, onClick: deleteContact, danger: true, busy },
      ]} />
    </div>
  );
}

// ── Unassigned detail ──────────────────────────────────────────────────────

function UnassignedDetail({ data }: { data: { sites: SiteItem[]; contacts: ContactItem[] } }) {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <span style={{ ...avatar, width: 54, height: 54, borderRadius: 10, background: 'transparent', border: '1px dashed var(--eq-gray-300)', color: 'var(--eq-grey)' }}><AlertTriangle size={22} /></span>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--eq-ink)' }}>Unassigned</h2>
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '10px 14px', background: 'var(--eq-warning-bg)', border: '1px solid color-mix(in srgb, var(--eq-warning-text) 30%, transparent)', borderRadius: 6, fontSize: 13, color: 'var(--eq-ink)', marginBottom: 16 }}>
        <AlertTriangle size={16} style={{ color: 'var(--eq-warning-text)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
        <span>{data.sites.length} site{data.sites.length === 1 ? '' : 's'} and {data.contacts.length} contact{data.contacts.length === 1 ? '' : 's'} have no customer yet.</span>
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

// ── Shared right-pane sub-components ──────────────────────────────────────

function SiteAccordion({ s, defaultOpen }: { s: SiteItem; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: '1px solid var(--eq-border)', borderRadius: 6, marginBottom: 8, background: '#fff', overflow: 'hidden' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ ...avatar, width: 32, height: 32, borderRadius: 6, background: 'var(--eq-gray-100)', color: 'var(--eq-ink)' }}><MapPin size={14} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5, color: 'var(--eq-ink)' }}>{s.name}</span>
          <span style={{ fontSize: 12, color: 'var(--eq-grey)' }}>{[s.suburb, s.state].filter(Boolean).join(', ') || '—'}</span>
        </span>
        {s.kind && <span style={kindPill}>{s.kind}</span>}
        <ChevronDown size={16} style={{ color: 'var(--eq-grey)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }} />
      </button>
      {open && (
        <div style={{ padding: '10px 12px 12px 52px', background: 'var(--eq-gray-50)', borderTop: '1px solid var(--eq-border)' }}>
          {s.contact ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--eq-grey)' }}>ON-SITE</span>
              <span style={{ ...avatar, width: 30, height: 30, borderRadius: '50%', background: brandColour(s.contact.name) }}>{initials(s.contact.name)}</span>
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
      <span style={{ ...avatar, width: 34, height: 34, borderRadius: '50%', background: brandColour(c.name) }}>{initials(c.name)}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5, color: 'var(--eq-ink)' }}>{c.name}</span>
        <span style={{ fontSize: 12, color: 'var(--eq-grey)' }}>
          {c.role ?? c.email ?? '—'}
          {c.extra_customers.length > 0 && <span style={{ marginLeft: 6, fontStyle: 'italic' }}>+{c.extra_customers.length} more</span>}
        </span>
      </span>
      {c.phone && <a href={`tel:${c.phone}`} style={reachBtn}><Phone size={13} /> Call</a>}
      {c.email && <a href={`mailto:${c.email}`} style={reachBtn}><Mail size={13} /> Email</a>}
    </div>
  );
}

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

function EmptyNote({ icon, text, helper, cta }: { icon: React.ReactNode; text: string; helper?: string; cta?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--eq-grey)' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 10, background: 'var(--eq-gray-100)', color: 'var(--eq-gray-400)', marginBottom: 10 }}>{icon}</div>
      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--eq-ink)', margin: '0 0 4px' }}>{text}</p>
      {helper && <p style={{ fontSize: 12.5, margin: '0 auto 10px', maxWidth: 280 }}>{helper}</p>}
      {cta && <Button variant="ghost" size="sm" icon={<Plus size={14} />}>{cta}</Button>}
    </div>
  );
}

// ── Add customer modal ─────────────────────────────────────────────────────

function AddCustomerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr('Company name is required.'); return; }
    setBusy(true);
    const r = await crmWrite({ action: 'add_customer', id: '_', company_name: name.trim(), customer_group: group || null, state: state || null });
    setBusy(false);
    if (r.ok) onCreated();
    else setErr(r.error ?? 'Something went wrong.');
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={(e) => void submit(e)} style={{ background: '#fff', borderRadius: 10, padding: 28, width: 400, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Add customer</h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--eq-grey)' }}><X size={18} /></button>
        </div>
        {err && <p style={{ fontSize: 13, color: 'var(--eq-danger-text, #dc2626)', marginBottom: 12 }}>{err}</p>}
        <label style={labelStyle}>Company name *</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Equinix Australia Pty Ltd" />
        <label style={labelStyle}>Group / division</label>
        <input value={group} onChange={(e) => setGroup(e.target.value)} style={inputStyle} placeholder="Data Centres" />
        <label style={labelStyle}>State</label>
        <input value={state} onChange={(e) => setState(e.target.value)} style={inputStyle} placeholder="NSW" />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={busy}>
            {busy ? <><Spinner size="sm" variant="ring" inverted label="" /> Adding…</> : 'Add customer'}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Avatar helpers ─────────────────────────────────────────────────────────

function AvatarSquare({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: size, height: size, borderRadius: 6, background: brandColour(name), color: '#fff', fontSize: size > 24 ? 13 : 11, fontWeight: 700 }}>
      {initials(name)}
    </span>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const eyebrow: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--eq-deep)', margin: '0 0 4px' };
const avatar: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 38, height: 38, borderRadius: 8, background: 'var(--eq-deep)', color: '#fff', fontSize: 13, fontWeight: 700 };
const countPills: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end', fontSize: 11, fontWeight: 700, color: 'var(--eq-grey)' };
const okPill: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--eq-success-text)', background: 'var(--eq-success-bg)', borderRadius: 9999, padding: '2px 9px' };
const groupPill: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--eq-clay)', border: '1px solid var(--eq-clay)', background: 'var(--eq-clay-bg)', borderRadius: 9999, padding: '2px 9px', textTransform: 'uppercase' };
const kindPill: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: 'var(--eq-grey)', background: 'var(--eq-gray-100)', borderRadius: 4, padding: '2px 7px', textTransform: 'uppercase' };
const metaLink: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--eq-deep)', textDecoration: 'none' };
const reachBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '5px 10px', border: '1px solid var(--eq-border)', borderRadius: 6, color: 'var(--eq-ink)', textDecoration: 'none', background: '#fff' };
const reachBtnSm: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, border: '1px solid var(--eq-border)', borderRadius: 6, color: 'var(--eq-ink)', textDecoration: 'none', background: '#fff' };
const toastStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '6px 12px', background: 'var(--eq-success-bg)', color: 'var(--eq-success-text)', borderRadius: 6, marginBottom: 14 };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--eq-ink)', marginBottom: 4, marginTop: 12 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--eq-border)', borderRadius: 6, fontSize: 13.5, boxSizing: 'border-box' };
