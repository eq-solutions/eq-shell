// Customers — the CRM hub. Two panes: a hierarchical Records tree (left) and a
// detail panel (right). The tree shows Customer → Sites branch → Contacts branch,
// all expand/collapse inline. Clicking any node (Customer, Site, or Contact)
// loads the appropriate detail view on the right.
//
// Left pane level-filter tabs: All | Customers | Sites | Contacts
// Search filters by customer name/group; auto-expands matched customers.
//
// TODO: cross-entity search by site/contact name (filter within sites/contacts
// list by typed string) — deferred follow-up enhancement.
//
// Data: /.netlify/functions/crm-customers (list / detail / unassigned).
// On-demand detail (sites + contacts) fetched per customer on first expand —
// cached in expandedData map, never re-fetched.

import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react';
import {
  Building2, MapPin, User, Phone, Mail, ChevronDown, ChevronRight,
  AlertTriangle, Search, Pencil, Download, Plus, X,
} from 'lucide-react';
import { Button } from '@eq-solutions/ui';
import { HubLayout } from '../components/HubLayout';
import { Gate } from '../permissions/Gate';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { EqError } from '../components/EqError';
import '../styles/records-tree.css';

const SIDEBAR_RECORDS = defaultSidebarRecords();
const UNASSIGNED = '__unassigned__';

// Deterministic squared-avatar colour from a name — brand-blue family only.
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
}

interface CustomerDetail {
  customer: {
    id: string; name: string; group: string | null; state: string | null;
    active: boolean; phone: string | null; email: string | null;
  };
  sites: SiteItem[];
  contacts: ContactItem[];
}

// Selection can be a customer, a site, or a contact — each needs context.
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

  // Tree expand state: set of customer IDs with expanded root node
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());
  // Branch expand state: 'sites:ID' | 'contacts:ID' keys
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());
  // Unassigned root expanded
  const [unassignedOpen, setUnassignedOpen] = useState(false);
  const [unassignedBranchSites, setUnassignedBranchSites] = useState(true);
  const [unassignedBranchContacts, setUnassignedBranchContacts] = useState(true);

  // Per-customer detail cache — fetched on first expand.
  const [expandedData, setExpandedData] = useState<Map<string, CustomerDetail>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  // Unassigned data
  const [unassignedData, setUnassignedData] = useState<{ sites: SiteItem[]; contacts: ContactItem[] } | null>(null);
  const [unassignedLoading, setUnassignedLoading] = useState(false);

  // Selection
  const [selection, setSelection] = useState<Selection | null>(null);

  // UI state
  const [filter, setFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mobile sheet
  const [sheetOpen, setSheetOpen] = useState(false);

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

  // ── Expand a customer node (lazy-fetch detail) ──────────────────────────

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

  const toggleCustomer = useCallback((id: string) => {
    setExpandedCustomers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else {
        next.add(id);
        void expandCustomer(id);
        // Auto-expand both branches when opening a customer
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

  // ── Unassigned expand ───────────────────────────────────────────────────

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

  // ── Selection helpers ───────────────────────────────────────────────────

  const select = useCallback((s: Selection) => {
    setSelection(s);
    setSheetOpen(true);
    // Selecting a customer with no expanded state → expand + fetch
    if (s.kind === 'customer') {
      if (!expandedCustomers.has(s.customerId)) {
        toggleCustomer(s.customerId);
      }
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

  // ── Filtering + search ──────────────────────────────────────────────────

  const q = filter.trim().toLowerCase();
  const filteredCustomers = q
    ? customers.filter((c) => c.name.toLowerCase().includes(q) || (c.group ?? '').toLowerCase().includes(q))
    : customers;

  // When search active, auto-expand matched customers (after their data loads)
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
  // Only re-run when the search string changes — not on every render.
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
    if (selection.kind === 'customer') {
      return { kind: 'customer', customerDetail: cd, site: null, contact: null, unassigned: null };
    }
    if (selection.kind === 'site') {
      const site = cd?.sites.find((s) => s.id === selection.siteId) ?? null;
      return { kind: 'site', customerDetail: cd, site, contact: null, unassigned: null };
    }
    if (selection.kind === 'contact') {
      const contact = cd?.contacts.find((c) => c.id === selection.contactId) ?? null;
      return { kind: 'contact', customerDetail: cd, site: null, contact, unassigned: null };
    }
    return { kind: 'none', customerDetail: null, site: null, contact: null, unassigned: null };
  }

  const detailResolved = resolveDetailData();
  const detailLoading = selection && selection.kind !== 'unassigned'
    && !expandedData.has((selection as { customerId: string }).customerId)
    && loadingIds.has((selection as { customerId: string }).customerId);

  // ── Keyboard navigation ─────────────────────────────────────────────────
  // Collect all visible node refs in order for arrow-key traversal.
  const nodeRefs = useRef<HTMLButtonElement[]>([]);
  const registerNode = useCallback((el: HTMLButtonElement | null) => {
    if (el && !nodeRefs.current.includes(el)) nodeRefs.current.push(el);
  }, []);

  function handleTreeKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const focused = document.activeElement as HTMLButtonElement | null;
    const nodes = nodeRefs.current.filter((n) => n.offsetParent !== null); // visible only
    const idx = focused ? nodes.indexOf(focused) : -1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nodes[idx + 1]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nodes[Math.max(0, idx - 1)]?.focus();
    } else if (e.key === 'Enter' && focused) {
      e.preventDefault();
      focused.click();
    }
    // ArrowRight/Left — delegated to individual nodes via onClick on chevron buttons
  }

  const countLabel = q
    ? `${filteredCustomers.length} match${filteredCustomers.length === 1 ? '' : 'es'}`
    : `${customers.length} customer${customers.length === 1 ? '' : 's'}`;

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
            <Button variant="primary" size="sm" icon={<Plus size={15} />}>Add customer</Button>
          </div>
        </div>
      </div>

      {error && <EqError title="Something went wrong" message={error} onRetry={() => void loadList()} />}

      <div className="crm-pane">
        {/* ── Left: tree pane ── */}
        <div className="crm-pane__list">
          {/* Search box */}
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

          {/* Level filter tabs */}
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

          {/* Tree / list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <p style={{ color: 'var(--eq-grey)', fontSize: 13, padding: 16 }}>Loading…</p>
            ) : (
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
                  // Trigger fetch if not yet loaded
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
                      {loadingIds.has(c.id) && (
                        <p style={{ fontSize: 12, color: 'var(--eq-grey)', padding: '6px 16px' }}>Loading…</p>
                      )}
                      {cd?.sites.map((s) => (
                        <SiteLeafNode
                          key={s.id}
                          s={s}
                          customerId={c.id}
                          isSelected={isSelected}
                          onSelect={select}
                          registerNode={registerNode}
                          indent={false}
                        />
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
                      {loadingIds.has(c.id) && (
                        <p style={{ fontSize: 12, color: 'var(--eq-grey)', padding: '6px 16px' }}>Loading…</p>
                      )}
                      {cd?.contacts.map((ct) => (
                        <ContactLeafNode
                          key={ct.id}
                          ct={ct}
                          customerId={c.id}
                          isSelected={isSelected}
                          onSelect={select}
                          registerNode={registerNode}
                          indent={false}
                        />
                      ))}
                    </li>
                  );
                })}

                {/* Unassigned bucket — always last, only when data exists */}
                {levelFilter === 'all' && (orphan.sites > 0 || orphan.contacts > 0) && (
                  <li className="crm-tree__unassigned" role="treeitem" aria-expanded={unassignedOpen}>
                    <button
                      ref={registerNode}
                      className={`crm-tree__unassigned-row${isSelected({ kind: 'unassigned' }) ? ' is-active' : ''}`}
                      onClick={() => {
                        void toggleUnassigned();
                        select({ kind: 'unassigned' });
                      }}
                      aria-expanded={unassignedOpen}
                    >
                      <ChevronRight
                        size={14}
                        className={`crm-tree__chevron${unassignedOpen ? ' is-open' : ''}`}
                        aria-hidden="true"
                      />
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
                        {unassignedLoading && (
                          <p style={{ fontSize: 12, color: 'var(--eq-grey)', padding: '8px 16px' }}>Loading…</p>
                        )}
                        {unassignedData && (
                          <>
                            {/* Sites branch */}
                            <button
                              className={`crm-tree__branch${unassignedBranchSites ? ' is-open' : ''}`}
                              onClick={() => setUnassignedBranchSites((o) => !o)}
                              aria-expanded={unassignedBranchSites}
                            >
                              <ChevronRight size={12} aria-hidden="true" />
                              <MapPin size={12} aria-hidden="true" />
                              Sites
                              <span className={`crm-tree__branch-count${unassignedData.sites.length > 0 ? ' has-items' : ''}`}>
                                {unassignedData.sites.length}
                              </span>
                            </button>
                            {unassignedBranchSites && unassignedData.sites.map((s) => (
                              <SiteLeafNode
                                key={s.id}
                                s={s}
                                customerId={UNASSIGNED}
                                isSelected={isSelected}
                                onSelect={select}
                                registerNode={registerNode}
                                indent
                              />
                            ))}
                            {/* Contacts branch */}
                            <button
                              className={`crm-tree__branch${unassignedBranchContacts ? ' is-open' : ''}`}
                              onClick={() => setUnassignedBranchContacts((o) => !o)}
                              aria-expanded={unassignedBranchContacts}
                            >
                              <ChevronRight size={12} aria-hidden="true" />
                              <User size={12} aria-hidden="true" />
                              Contacts
                              <span className={`crm-tree__branch-count${unassignedData.contacts.length > 0 ? ' has-items' : ''}`}>
                                {unassignedData.contacts.length}
                              </span>
                            </button>
                            {unassignedBranchContacts && unassignedData.contacts.map((ct) => (
                              <ContactLeafNode
                                key={ct.id}
                                ct={ct}
                                customerId={UNASSIGNED}
                                isSelected={isSelected}
                                onSelect={select}
                                registerNode={registerNode}
                                indent
                              />
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>

        {/* ── Right: detail pane (desktop) ── */}
        <div
          className="crm-pane__detail-col"
          style={{ overflowY: 'auto', background: 'var(--eq-content-bg, #f6f3ee)' }}
        >
          <DetailPane
            resolved={detailResolved}
            detailLoading={!!detailLoading}
            onLoadList={loadList}
          />
        </div>
      </div>

      {/* ── Mobile slide-up sheet ── */}
      <div
        className={`crm-detail-sheet${sheetOpen ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Record detail"
      >
        <div className="crm-detail-sheet__handle">
          <button
            onClick={() => setSheetOpen(false)}
            style={{ position: 'absolute', right: 12, top: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--eq-grey)', display: 'flex', alignItems: 'center', gap: 4 }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <DetailPane
          resolved={detailResolved}
          detailLoading={!!detailLoading}
          onLoadList={loadList}
        />
      </div>
    </div>
  );
}

// ── Customer tree node ─────────────────────────────────────────────────────

interface CustomerTreeNodeProps {
  c: CustomerListItem;
  expanded: boolean;
  expandedBranches: Set<string>;
  detail: CustomerDetail | null;
  loading: boolean;
  isSelected: (s: Selection) => boolean;
  onToggle: () => void;
  onToggleBranch: (key: string) => void;
  onSelect: (s: Selection) => void;
  registerNode: (el: HTMLButtonElement | null) => void;
}

function CustomerTreeNode({
  c, expanded, expandedBranches, detail, loading,
  isSelected, onToggle, onToggleBranch, onSelect, registerNode,
}: CustomerTreeNodeProps) {
  const sitesOpen = expandedBranches.has(`sites:${c.id}`);
  const contactsOpen = expandedBranches.has(`contacts:${c.id}`);

  return (
    <li className="crm-tree__customer" role="treeitem" aria-expanded={expanded}>
      {/* Customer root row */}
      <button
        ref={registerNode}
        className={`crm-tree__customer-row${isSelected({ kind: 'customer', customerId: c.id }) ? ' is-active' : ''}`}
        onClick={() => {
          onToggle();
          onSelect({ kind: 'customer', customerId: c.id });
        }}
        aria-expanded={expanded}
        aria-label={`${c.name}, ${c.site_count} sites, ${c.contact_count} contacts`}
      >
        <ChevronRight
          size={14}
          className={`crm-tree__chevron${expanded ? ' is-open' : ''}`}
          aria-hidden="true"
        />
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

      {/* Expanded body */}
      {expanded && (
        <div className="crm-tree__customer-body">
          {loading && (
            <p style={{ fontSize: 12, color: 'var(--eq-grey)', padding: '8px 16px 8px 32px' }}>Loading…</p>
          )}

          {detail && (
            <>
              {/* Sites branch */}
              <button
                ref={registerNode}
                className={`crm-tree__branch${sitesOpen ? ' is-open' : ''}`}
                onClick={() => onToggleBranch(`sites:${c.id}`)}
                aria-expanded={sitesOpen}
                aria-label={`Sites (${detail.sites.length})`}
              >
                <ChevronRight size={12} aria-hidden="true" />
                <MapPin size={12} aria-hidden="true" />
                Sites
                <span className={`crm-tree__branch-count${detail.sites.length > 0 ? ' has-items' : ''}`}>
                  {detail.sites.length}
                </span>
              </button>
              {sitesOpen && detail.sites.map((s) => (
                <SiteLeafNode
                  key={s.id}
                  s={s}
                  customerId={c.id}
                  isSelected={isSelected}
                  onSelect={onSelect}
                  registerNode={registerNode}
                  indent
                />
              ))}

              {/* Contacts branch */}
              <button
                ref={registerNode}
                className={`crm-tree__branch${contactsOpen ? ' is-open' : ''}`}
                onClick={() => onToggleBranch(`contacts:${c.id}`)}
                aria-expanded={contactsOpen}
                aria-label={`Contacts (${detail.contacts.length})`}
              >
                <ChevronRight size={12} aria-hidden="true" />
                <User size={12} aria-hidden="true" />
                Contacts
                <span className={`crm-tree__branch-count${detail.contacts.length > 0 ? ' has-items' : ''}`}>
                  {detail.contacts.length}
                </span>
              </button>
              {contactsOpen && detail.contacts.map((ct) => (
                <ContactLeafNode
                  key={ct.id}
                  ct={ct}
                  customerId={c.id}
                  isSelected={isSelected}
                  onSelect={onSelect}
                  registerNode={registerNode}
                  indent
                />
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
  s: SiteItem;
  customerId: string;
  isSelected: (s: Selection) => boolean;
  onSelect: (s: Selection) => void;
  registerNode: (el: HTMLButtonElement | null) => void;
  indent: boolean;
}

function SiteLeafNode({ s, customerId, isSelected, onSelect, registerNode, indent }: SiteLeafNodeProps) {
  const sel: Selection = { kind: 'site', customerId, siteId: s.id };
  return (
    <button
      ref={registerNode}
      role="treeitem"
      className={`crm-tree__site-row${isSelected(sel) ? ' is-active' : ''}`}
      style={indent ? undefined : { paddingLeft: 12 }}
      onClick={() => onSelect(sel)}
      aria-label={`Site: ${s.name}`}
    >
      <MapPin size={13} style={{ color: 'var(--eq-grey)', flexShrink: 0 }} aria-hidden="true" />
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 13, color: 'var(--eq-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
        {(s.suburb ?? s.state) && (
          <span style={{ fontSize: 11, color: 'var(--eq-grey)' }}>{[s.suburb, s.state].filter(Boolean).join(', ')}</span>
        )}
      </span>
      {s.kind && <span style={kindPill}>{s.kind}</span>}
      {s.contact && (
        <span className="crm-tree__onsite-chip" title={s.contact.name}>
          <User size={10} aria-hidden="true" /> {s.contact.name}
        </span>
      )}
    </button>
  );
}

// ── Contact leaf node ──────────────────────────────────────────────────────

interface ContactLeafNodeProps {
  ct: ContactItem;
  customerId: string;
  isSelected: (s: Selection) => boolean;
  onSelect: (s: Selection) => void;
  registerNode: (el: HTMLButtonElement | null) => void;
  indent: boolean;
}

function ContactLeafNode({ ct, customerId, isSelected, onSelect, registerNode, indent }: ContactLeafNodeProps) {
  const sel: Selection = { kind: 'contact', customerId, contactId: ct.id };
  return (
    <button
      ref={registerNode}
      role="treeitem"
      className={`crm-tree__contact-row${isSelected(sel) ? ' is-active' : ''}`}
      style={indent ? undefined : { paddingLeft: 12 }}
      onClick={() => onSelect(sel)}
      aria-label={`Contact: ${ct.name}`}
    >
      <span style={{ ...avatar, width: 28, height: 28, borderRadius: '50%', fontSize: 11, background: brandColour(ct.name), flexShrink: 0 }}>{initials(ct.name)}</span>
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 13, color: 'var(--eq-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ct.name}</span>
        <span style={{ fontSize: 11, color: 'var(--eq-grey)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ct.role ?? ct.email ?? '—'}</span>
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

function DetailPane({ resolved, detailLoading }: { resolved: ResolvedDetail; detailLoading: boolean; onLoadList: () => void }) {
  if (detailLoading) {
    return <p style={{ color: 'var(--eq-grey)', fontSize: 13, padding: 24 }}>Loading…</p>;
  }
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
      : <p style={{ color: 'var(--eq-grey)', fontSize: 13, padding: 24 }}>Loading…</p>;
  }
  if (resolved.kind === 'customer' && resolved.customerDetail) {
    return <CustomerDetailView d={resolved.customerDetail} />;
  }
  if (resolved.kind === 'customer' && !resolved.customerDetail) {
    // Fetching in progress
    return <p style={{ color: 'var(--eq-grey)', fontSize: 13, padding: 24 }}>Loading…</p>;
  }
  if (resolved.kind === 'site' && resolved.site) {
    return <SiteDetailView s={resolved.site} customer={resolved.customerDetail?.customer ?? null} />;
  }
  if (resolved.kind === 'contact' && resolved.contact) {
    return <ContactDetailView ct={resolved.contact} customer={resolved.customerDetail?.customer ?? null} />;
  }
  // Fallback while data arrives
  return <p style={{ color: 'var(--eq-grey)', fontSize: 13, padding: 24 }}>Loading…</p>;
}

// ── Right-pane: customer detail ────────────────────────────────────────────

function CustomerDetailView({ d }: { d: CustomerDetail }) {
  const { customer, sites, contacts } = d;
  return (
    <div style={{ padding: 24 }}>
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
    </div>
  );
}

// ── Right-pane: site detail ────────────────────────────────────────────────

function SiteDetailView({ s, customer }: { s: SiteItem; customer: CustomerDetail['customer'] | null }) {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <span style={{ ...avatar, width: 48, height: 48, borderRadius: 10, background: 'var(--eq-ice)', color: 'var(--eq-deep)' }}>
          <MapPin size={20} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--eq-ink)' }}>{s.name}</h2>
            {s.kind && <span style={kindPill}>{s.kind}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {[s.suburb, s.state].filter(Boolean).length > 0 && (
              <span style={{ fontSize: 13, color: 'var(--eq-grey)' }}>{[s.suburb, s.state].filter(Boolean).join(', ')}</span>
            )}
            {customer && (
              <span style={{ fontSize: 13, color: 'var(--eq-grey)' }}>· {customer.name}</span>
            )}
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
        <div style={{ border: '1px dashed var(--eq-border)', borderRadius: 8, padding: '14px 16px', color: 'var(--eq-grey)', fontSize: 13, fontStyle: 'italic' }}>
          No on-site contact recorded.
        </div>
      )}
    </div>
  );
}

// ── Right-pane: contact detail ─────────────────────────────────────────────

function ContactDetailView({ ct, customer }: { ct: ContactItem; customer: CustomerDetail['customer'] | null }) {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <span style={{ ...avatar, width: 52, height: 52, borderRadius: '50%', fontSize: 17, background: brandColour(ct.name) }}>{initials(ct.name)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px', color: 'var(--eq-ink)' }}>{ct.name}</h2>
          {ct.role && <div style={{ fontSize: 13, color: 'var(--eq-grey)' }}>{ct.role}</div>}
          {customer && <div style={{ fontSize: 12.5, color: 'var(--eq-grey)' }}>{customer.name}</div>}
        </div>
      </div>

      <div style={{ border: '1px solid var(--eq-border)', borderRadius: 8, background: '#fff', padding: '14px 16px' }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--eq-grey)', margin: '0 0 10px' }}>Reach</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ct.phone && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--eq-ink)' }}>
                <Phone size={14} style={{ color: 'var(--eq-deep)' }} /> {ct.phone}
              </span>
              <a href={`tel:${ct.phone}`} style={reachBtn}><Phone size={13} /> Call</a>
            </div>
          )}
          {ct.email && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--eq-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0, marginRight: 8 }}>
                <Mail size={14} style={{ color: 'var(--eq-deep)', flexShrink: 0 }} /> {ct.email}
              </span>
              <a href={`mailto:${ct.email}`} style={reachBtn}><Mail size={13} /> Email</a>
            </div>
          )}
          {!ct.phone && !ct.email && (
            <p style={{ fontSize: 13, color: 'var(--eq-grey)', margin: 0, fontStyle: 'italic' }}>No contact details on record.</p>
          )}
        </div>
      </div>
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
        <span>{data.sites.length} site{data.sites.length === 1 ? '' : 's'} and {data.contacts.length} contact{data.contacts.length === 1 ? '' : 's'} have no customer yet. Assign each to a customer to fold it into the hierarchy.</span>
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
        <span style={{ fontSize: 12, color: 'var(--eq-grey)' }}>{c.role ?? c.email ?? '—'}</span>
      </span>
      {c.phone && <a href={`tel:${c.phone}`} style={reachBtn}><Phone size={13} /> Call</a>}
      {c.email && <a href={`mailto:${c.email}`} style={reachBtn}><Mail size={13} /> Email</a>}
    </div>
  );
}

function Section({ icon, title, count, defaultOpen, children }: {
  icon: React.ReactNode; title: string; count: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
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

// ── Avatar helpers ─────────────────────────────────────────────────────────

function AvatarSquare({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      width: size, height: size, borderRadius: 6,
      background: brandColour(name), color: '#fff',
      fontSize: size > 24 ? 13 : 11, fontWeight: 700,
    }}>
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
