import React, { useState, useEffect, useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

interface CustomerRow {
  customer_id: string;
  company_name: string | null;
  email: string | null;
  primary_phone: string | null;
  suburb: string | null;
  state: string | null;
  active: boolean;
  quote_count: number;
  total_cents: number;
  last_quote_at: string | null;
}

interface ContactRow {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  work_phone: string | null;
  mobile_phone: string | null;
  contact_position: string | null;
  is_default_quote_contact: boolean;
}

interface SiteRow {
  site_id:             string;
  name:                string;
  code:                string | null;
  customer_id:         string | null;
  suburb:              string | null;
  state:               string | null;
  site_contact_name:   string | null;
  site_contact_phone:  string | null;
  site_contact_email:  string | null;
}

interface ContactForSiteRow {
  contact_id:       string;
  first_name:       string | null;
  last_name:        string | null;
  email:            string | null;
  work_phone:       string | null;
  mobile_phone:     string | null;
  contact_position: string | null;
  role:             string | null;
}

interface CustomerQuote {
  quote_id: string;
  quote_number: string;
  status: string;
  project_name: string | null;
  total_cents: number;
  estimator_initials: string | null;
  sent_at: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  "draft":               "Draft",
  "submitted":           "Sent",
  "client-reviewing":    "Reviewing",
  "on-hold":             "On Hold",
  "verbal-win":          "Verbal Win",
  "won-awaiting-job-no": "Won",
  "won-job-created":     "Won",
  "po-matched":          "PO Matched",
  "active":              "Active",
  "complete":            "Complete",
  "ready-to-invoice":    "To Invoice",
  "lost":                "Lost",
  "cancelled":           "Cancelled",
  "expired":             "Expired",
  "superseded":          "Superseded",
};

function mapSiteRows(rows: Record<string, unknown>[]): SiteRow[] {
  return rows.map((r) => ({
    site_id:            String(r.site_id),
    name:               String(r.name ?? ""),
    code:               r.code              ? String(r.code)              : null,
    customer_id:        r.customer_id       ? String(r.customer_id)       : null,
    suburb:             r.suburb            ? String(r.suburb)            : null,
    state:              r.state             ? String(r.state)             : null,
    site_contact_name:  r.site_contact_name  ? String(r.site_contact_name)  : null,
    site_contact_phone: r.site_contact_phone ? String(r.site_contact_phone) : null,
    site_contact_email: r.site_contact_email ? String(r.site_contact_email) : null,
  }));
}

async function crmWrite(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/.netlify/functions/crm-write", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

function fmtMoney(cents: number): string {
  if (cents === 0) return "—";
  return "$" + (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

interface Props {
  supabase: SupabaseClient | null;
  onOpenQuote?: (quoteId: string) => void;
}

export function QuotesCustomers({ supabase, onOpenQuote }: Props): React.JSX.Element {
  const [customers, setCustomers]   = useState<CustomerRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const [selected, setSelected]     = useState<CustomerRow | null>(null);
  const [contacts, setContacts]     = useState<ContactRow[]>([]);
  const [custQuotes, setCustQuotes] = useState<CustomerQuote[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactRow | null>(null);
  const [addForm, setAddForm] = useState({ first_name: "", last_name: "", email: "", mobile_phone: "", position: "" });
  const [addSaving, setAddSaving] = useState(false);
  const [showCustForm, setShowCustForm] = useState(false);
  const [custFormMode, setCustFormMode] = useState<"create" | "edit">("create");
  const [custForm, setCustForm] = useState({ company_name: "", email: "", primary_phone: "", suburb: "", state: "" });
  const [custSaving, setCustSaving] = useState(false);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteContacts, setSiteContacts] = useState<Record<string, ContactForSiteRow[]>>({});
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);
  const [showAssignSite, setShowAssignSite] = useState(false);
  const [allSites, setAllSites] = useState<SiteRow[]>([]);
  const [assignSearch, setAssignSearch] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);
  const [showLinkContact, setShowLinkContact] = useState<Record<string, boolean>>({});
  const [custActionErr, setCustActionErr] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [confirmDeleteContactId, setConfirmDeleteContactId] = useState<string | null>(null);
  const [confirmDeleteCustomer, setConfirmDeleteCustomer] = useState(false);
  const [confirmMergeTarget, setConfirmMergeTarget] = useState<CustomerRow | null>(null);
  const [editingSite, setEditingSite]   = useState<SiteRow | null>(null);
  const [siteForm, setSiteForm] = useState({ name: "", code: "", suburb: "", state: "", site_contact_name: "", site_contact_phone: "", site_contact_email: "" });
  const [siteSaving, setSiteSaving]     = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("eq_list_customers_with_stats");
    setLoading(false);
    if (err) { setError(err.message); return; }
    setCustomers(((data ?? []) as Record<string, unknown>[]).map((r) => ({
      customer_id:  String(r.customer_id),
      company_name: r.company_name ? String(r.company_name) : null,
      email:        r.email ? String(r.email) : null,
      primary_phone: r.primary_phone ? String(r.primary_phone) : null,
      suburb:       r.suburb ? String(r.suburb) : null,
      state:        r.state ? String(r.state) : null,
      active:       Boolean(r.active ?? true),
      quote_count:  Number(r.quote_count ?? 0),
      total_cents:  Number(r.total_cents ?? 0),
      last_quote_at: r.last_quote_at ? String(r.last_quote_at) : null,
    })));
  }, [supabase]);

  const reloadContacts = useCallback(async (customerId: string) => {
    if (!supabase) return;
    const { data } = await supabase.rpc("eq_list_contacts_for_customer", { p_customer_id: customerId });
    if (data) {
      setContacts((data as Record<string, unknown>[]).map((r) => ({
        contact_id:               String(r.contact_id),
        first_name:               r.first_name ? String(r.first_name) : null,
        last_name:                r.last_name ? String(r.last_name) : null,
        email:                    r.email ? String(r.email) : null,
        work_phone:               r.work_phone ? String(r.work_phone) : null,
        mobile_phone:             r.mobile_phone ? String(r.mobile_phone) : null,
        contact_position:         r.contact_position ? String(r.contact_position) : null,
        is_default_quote_contact: Boolean(r.is_default_quote_contact),
      })));
    }
  }, [supabase]);

  const saveContact = useCallback(async () => {
    if (!supabase || !selected) return;
    setAddSaving(true);
    let rpcErr: { message: string } | null = null;
    if (editingContact) {
      const { error: e } = await supabase.rpc("eq_update_contact", {
        p_contact_id:   editingContact.contact_id,
        p_first_name:   addForm.first_name || null,
        p_last_name:    addForm.last_name  || null,
        p_email:        addForm.email      || null,
        p_mobile_phone: addForm.mobile_phone || null,
        p_position:     addForm.position   || null,
      });
      rpcErr = e;
    } else {
      const extId = `EQ-${crypto.randomUUID()}`;
      const { error: e } = await supabase.rpc("eq_upsert_contact", {
        p_external_id:  extId,
        p_customer_id:  selected.customer_id,
        p_first_name:   addForm.first_name || null,
        p_last_name:    addForm.last_name  || null,
        p_email:        addForm.email      || null,
        p_mobile_phone: addForm.mobile_phone || null,
        p_position:     addForm.position   || null,
      });
      rpcErr = e;
    }
    setAddSaving(false);
    if (rpcErr) { setCustActionErr(rpcErr.message); return; }
    setShowAddContact(false);
    setEditingContact(null);
    setAddForm({ first_name: "", last_name: "", email: "", mobile_phone: "", position: "" });
    await reloadContacts(selected.customer_id);
  }, [supabase, selected, addForm, editingContact, reloadContacts]);

  const archiveContact = useCallback(async (ct: ContactRow) => {
    if (!supabase || !selected) return;
    const { error: e } = await supabase.rpc("eq_archive_contact", { p_contact_id: ct.contact_id });
    if (e) { setCustActionErr(e.message); return; }
    await reloadContacts(selected.customer_id);
  }, [supabase, selected, reloadContacts]);

  const deleteContact = useCallback(async (ct: ContactRow) => {
    if (!supabase || !selected) return;
    if (confirmDeleteContactId !== ct.contact_id) {
      setConfirmDeleteContactId(ct.contact_id);
      return;
    }
    setConfirmDeleteContactId(null);
    const { error: e } = await supabase.rpc("eq_delete_contact", { p_contact_id: ct.contact_id });
    if (e) { setCustActionErr(e.message); return; }
    await reloadContacts(selected.customer_id);
  }, [supabase, selected, reloadContacts, confirmDeleteContactId]);

  const setPrimaryContact = useCallback(async (ct: ContactRow) => {
    if (!supabase || !selected) return;
    const { error: e } = await supabase.rpc("eq_set_default_contact", { p_contact_id: ct.contact_id });
    if (e) { setCustActionErr(e.message); return; }
    await reloadContacts(selected.customer_id);
  }, [supabase, selected, reloadContacts]);

  const deleteCustomer = useCallback(async () => {
    if (!supabase || !selected) return;
    setCustActionErr(null);
    if (!confirmDeleteCustomer) {
      setConfirmDeleteCustomer(true);
      return;
    }
    setConfirmDeleteCustomer(false);
    const { error: e } = await supabase.rpc("eq_delete_customer", { p_customer_id: selected.customer_id });
    if (e) {
      // FK RESTRICT (23503) on quotes/contacts — guide to Archive/Merge instead of a raw error.
      setCustActionErr((e as { code?: string }).code === "23503"
        ? "This client still has quotes or contacts, so it can't be deleted. Archive it instead, or merge it into another client."
        : e.message);
      return;
    }
    setSelected(null);
    await load();
  }, [supabase, selected, load, confirmDeleteCustomer]);

  const reloadSites = useCallback(async (customerId: string) => {
    if (!supabase) return;
    const { data } = await supabase.rpc("eq_list_sites", { p_customer_id: customerId });
    if (data) setSites(mapSiteRows(data as Record<string, unknown>[]));
  }, [supabase]);

  const loadSiteContacts = useCallback(async (siteId: string) => {
    if (!supabase) return;
    const { data } = await supabase.rpc("eq_list_contacts_for_site", { p_site_id: siteId });
    if (data) {
      setSiteContacts((prev) => ({
        ...prev,
        [siteId]: (data as Record<string, unknown>[]).map((r) => ({
          contact_id:       String(r.contact_id),
          first_name:       r.first_name ? String(r.first_name) : null,
          last_name:        r.last_name ? String(r.last_name) : null,
          email:            r.email ? String(r.email) : null,
          work_phone:       r.work_phone ? String(r.work_phone) : null,
          mobile_phone:     r.mobile_phone ? String(r.mobile_phone) : null,
          contact_position: r.contact_position ? String(r.contact_position) : null,
          role:             r.role ? String(r.role) : null,
        })),
      }));
    }
  }, [supabase]);

  const toggleSiteExpand = useCallback(async (siteId: string) => {
    if (expandedSiteId === siteId) {
      setExpandedSiteId(null);
      setShowLinkContact({});
    } else {
      setExpandedSiteId(siteId);
      setShowLinkContact({});
      await loadSiteContacts(siteId);
    }
  }, [expandedSiteId, loadSiteContacts]);

  const loadAllSites = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.rpc("eq_list_sites");
    if (data) {
      setAllSites((data as Record<string, unknown>[]).map((r) => ({
        site_id:     String(r.site_id),
        name:        String(r.name ?? ""),
        code:        r.code ? String(r.code) : null,
        customer_id: r.customer_id ? String(r.customer_id) : null,
      })));
    }
  }, [supabase]);

  const handleAssignSite = useCallback(async (siteId: string) => {
    if (!supabase || !selected || assignSaving) return;
    setAssignSaving(true);
    const { error: e } = await supabase.rpc("eq_assign_site_to_customer", {
      p_site_id:     siteId,
      p_customer_id: selected.customer_id,
    });
    setAssignSaving(false);
    if (e) { setCustActionErr(e.message); return; }
    setShowAssignSite(false);
    setAssignSearch("");
    await reloadSites(selected.customer_id);
  }, [supabase, selected, assignSaving, reloadSites]);

  const handleLinkContact = useCallback(async (siteId: string, contactId: string) => {
    if (!supabase) return;
    const { error: e } = await supabase.rpc("eq_link_contact_to_site", {
      p_contact_id: contactId,
      p_site_id:    siteId,
    });
    if (e) { setCustActionErr(e.message); return; }
    setShowLinkContact((prev) => ({ ...prev, [siteId]: false }));
    await loadSiteContacts(siteId);
  }, [supabase, loadSiteContacts]);

  const handleUnlinkContact = useCallback(async (siteId: string, contactId: string) => {
    if (!supabase) return;
    const { error: e } = await supabase.rpc("eq_unlink_contact_from_site", {
      p_contact_id: contactId,
      p_site_id:    siteId,
    });
    if (e) { setCustActionErr(e.message); return; }
    await loadSiteContacts(siteId);
  }, [supabase, loadSiteContacts]);

  const saveCustomer = useCallback(async () => {
    if (!supabase) return;
    if (!custForm.company_name.trim()) return;
    setCustSaving(true);
    let rpcErr: { message: string } | null = null;
    if (custFormMode === "edit" && selected) {
      const { error: e } = await supabase.rpc("eq_update_customer", {
        p_customer_id:   selected.customer_id,
        p_company_name:  custForm.company_name.trim(),
        p_email:         custForm.email.trim()         || null,
        p_primary_phone: custForm.primary_phone.trim() || null,
        p_suburb:        custForm.suburb.trim()        || null,
        p_state:         custForm.state.trim()         || null,
      });
      rpcErr = e;
    } else {
      const extId = `EQ-${crypto.randomUUID()}`;
      const { error: e } = await supabase.rpc("eq_upsert_customer", {
        p_external_id:   extId,
        p_company_name:  custForm.company_name.trim(),
        p_email:         custForm.email.trim()         || null,
        p_primary_phone: custForm.primary_phone.trim() || null,
        p_suburb:        custForm.suburb.trim()        || null,
        p_state:         custForm.state.trim()         || null,
      });
      rpcErr = e;
    }
    setCustSaving(false);
    if (rpcErr) { setCustActionErr(rpcErr.message); return; }
    setShowCustForm(false);
    setCustForm({ company_name: "", email: "", primary_phone: "", suburb: "", state: "" });
    await load();
  }, [supabase, custForm, custFormMode, selected, load]);

  const loadDetail = useCallback(async (c: CustomerRow) => {
    if (!supabase) return;
    setSelected(c);
    setContacts([]);
    setCustQuotes([]);
    setSites([]);
    setSiteContacts({});
    setExpandedSiteId(null);
    setShowLinkContact({});
    setShowAssignSite(false);
    setAssignSearch("");
    setShowAddContact(false);
    setEditingContact(null);
    setAddForm({ first_name: "", last_name: "", email: "", mobile_phone: "", position: "" });
    setShowMerge(false);
    setMergeSearch("");
    setCustActionErr(null);
    setDetailLoading(true);
    const [ctRes, qRes, sitesRes] = await Promise.all([
      supabase.rpc("eq_list_contacts_for_customer", { p_customer_id: c.customer_id }),
      supabase.rpc("eq_list_quotes_for_customer",   { p_customer_id: c.customer_id }),
      supabase.rpc("eq_list_sites",                 { p_customer_id: c.customer_id }),
    ]);
    setDetailLoading(false);
    if (ctRes.data) {
      setContacts(((ctRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
        contact_id:               String(r.contact_id),
        first_name:               r.first_name ? String(r.first_name) : null,
        last_name:                r.last_name ? String(r.last_name) : null,
        email:                    r.email ? String(r.email) : null,
        work_phone:               r.work_phone ? String(r.work_phone) : null,
        mobile_phone:             r.mobile_phone ? String(r.mobile_phone) : null,
        contact_position:         r.contact_position ? String(r.contact_position) : null,
        is_default_quote_contact: Boolean(r.is_default_quote_contact),
      })));
    }
    if (sitesRes.data) setSites(mapSiteRows((sitesRes.data ?? []) as Record<string, unknown>[]));
    if (qRes.data) {
      setCustQuotes(((qRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
        quote_id:          String(r.quote_id),
        quote_number:      String(r.quote_number ?? ""),
        status:            String(r.status ?? ""),
        project_name:      r.project_name ? String(r.project_name) : null,
        total_cents:       Number(r.total_cents ?? 0),
        estimator_initials: r.estimator_initials ? String(r.estimator_initials) : null,
        sent_at:           r.sent_at ? String(r.sent_at) : null,
        created_at:        String(r.created_at),
      })));
    }
  }, [supabase]);

  const mergeInto = useCallback(async (dupe: CustomerRow) => {
    if (!supabase || !selected || mergeBusy) return;
    if (confirmMergeTarget?.customer_id !== dupe.customer_id) {
      setConfirmMergeTarget(dupe);
      return;
    }
    setConfirmMergeTarget(null);
    setMergeBusy(true);
    setCustActionErr(null);
    const { error: e } = await supabase.rpc("eq_merge_customers", {
      p_keep_customer_id: selected.customer_id,
      p_dupe_customer_id: dupe.customer_id,
    });
    setMergeBusy(false);
    if (e) { setCustActionErr(e.message); return; }
    setShowMerge(false);
    setMergeSearch("");
    await load();
    await loadDetail(selected);
  }, [supabase, selected, mergeBusy, load, loadDetail, confirmMergeTarget]);

  const saveSite = useCallback(async () => {
    if (!editingSite) return;
    if (!siteForm.name.trim()) { setCustActionErr("Site name is required"); return; }
    setSiteSaving(true);
    setCustActionErr(null);
    const res = await crmWrite({ action: "update_site", id: editingSite.site_id, ...siteForm });
    setSiteSaving(false);
    if (!res.ok) { setCustActionErr(res.error ?? "Save failed"); return; }
    setEditingSite(null);
    setSiteForm({ name: "", code: "", suburb: "", state: "", site_contact_name: "", site_contact_phone: "", site_contact_email: "" });
    if (selected) await reloadSites(selected.customer_id);
  }, [editingSite, siteForm, selected, reloadSites]);

  useEffect(() => { void load(); }, [load]);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter((c) =>
      (c.company_name ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (c.suburb ?? "").toLowerCase().includes(q)
    );
  }, [customers, search]);

  if (loading) return (
    <div style={{ padding: '1rem 0' }}>
      <div style={{ height: 20, background: 'var(--eq-border,#e5e7eb)', borderRadius: 4, marginBottom: 10, width: '70%' }} />
      <div style={{ height: 20, background: 'var(--eq-border,#e5e7eb)', borderRadius: 4, marginBottom: 10, width: '55%' }} />
      <div style={{ height: 20, background: 'var(--eq-border,#e5e7eb)', borderRadius: 4, width: '65%' }} />
    </div>
  );
  if (error) return (
    <div>
      <p style={{ color: 'var(--eq-err,#c0392b)', marginBottom: 10, fontSize: 14 }}>
        Couldn’t load clients — check your connection and try again.
      </p>
      <button
        type="button"
        className="eq-quotes__btn eq-quotes__btn--sm"
        onClick={() => void load()}
      >
        Retry
      </button>
    </div>
  );

  return (
    <div className="eq-quotes__customers" style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* ── List pane ── */}
      <div style={{ flex: "0 0 420px", minWidth: "min(100%, 420px)", width: "min(100%, 420px)" }}>
        <div style={{ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button
            className="eq-quotes__btn eq-quotes__btn--primary"
            style={{ whiteSpace: "nowrap", fontSize: "0.82rem", padding: "4px 12px" }}
            onClick={() => {
              setCustFormMode("create");
              setCustForm({ company_name: "", email: "", primary_phone: "", suburb: "", state: "" });
              setShowCustForm(true);
            }}
          >
            New client
          </button>
        </div>

        {showCustForm && (
          <div style={{ background: "var(--eq-ice,#EAF5FB)", border: "1px solid var(--eq-border,#e5e7eb)", borderRadius: "6px", padding: "0.75rem", marginBottom: "0.75rem" }}>
            <div style={{ fontWeight: 600, fontSize: "0.82rem", marginBottom: "0.5rem", color: "var(--eq-ink,#1A1A2E)" }}>
              {custFormMode === "edit" ? "Edit client" : "New client"}
            </div>
            <input
              className="eq-quotes__input"
              placeholder="Company name *"
              value={custForm.company_name}
              style={{ width: "100%", marginBottom: "0.4rem" }}
              onChange={(e) => setCustForm((f) => ({ ...f, company_name: e.target.value }))}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", marginBottom: "0.4rem" }}>
              <input className="eq-quotes__input" placeholder="Email" value={custForm.email}
                onChange={(e) => setCustForm((f) => ({ ...f, email: e.target.value }))} />
              <input className="eq-quotes__input" placeholder="Phone" value={custForm.primary_phone}
                onChange={(e) => setCustForm((f) => ({ ...f, primary_phone: e.target.value }))} />
              <input className="eq-quotes__input" placeholder="Suburb" value={custForm.suburb}
                onChange={(e) => setCustForm((f) => ({ ...f, suburb: e.target.value }))} />
              <input className="eq-quotes__input" placeholder="State (e.g. NSW)" value={custForm.state}
                onChange={(e) => setCustForm((f) => ({ ...f, state: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                className="eq-quotes__btn eq-quotes__btn--primary"
                disabled={custSaving || !custForm.company_name.trim()}
                onClick={() => { void saveCustomer(); }}
                style={{ fontSize: "0.82rem" }}
              >
                {custSaving ? "Saving…" : custFormMode === "edit" ? "Update" : "Create"}
              </button>
              <button
                className="eq-quotes__btn eq-quotes__btn--sm"
                onClick={() => setShowCustForm(false)}
                style={{ fontSize: "0.82rem" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            className="eq-quotes__input"
            style={{ flex: 1 }}
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="eq-quotes__muted" style={{ whiteSpace: "nowrap", fontSize: "0.8rem" }}>
            {filtered.length} of {customers.length}
          </span>
        </div>

        <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 320px)" }}>
          {filtered.map((c) => (
            <div
              key={c.customer_id}
              role="button"
              tabIndex={0}
              className={`eq-quotes__customer-row${selected?.customer_id === c.customer_id ? " eq-quotes__customer-row--active" : ""}`}
              onClick={() => void loadDetail(c)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void loadDetail(c); } }}
              style={{
                padding: "0.6rem 0.75rem",
                borderBottom: "1px solid var(--eq-border,#e5e7eb)",
                cursor: "pointer",
                background: selected?.customer_id === c.customer_id ? "var(--eq-ice,#EAF5FB)" : undefined,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{c.company_name ?? "(unnamed)"}</div>
              <div style={{ fontSize: "0.78rem", color: "var(--eq-muted,#6b7280)", marginTop: "2px" }}>
                {[c.suburb, c.state].filter(Boolean).join(", ")}
                {c.quote_count > 0 && (
                  <span style={{ marginLeft: "0.75rem" }}>
                    {c.quote_count} {c.quote_count === 1 ? "quote" : "quotes"} · {fmtMoney(c.total_cents)}
                  </span>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && customers.length > 0 && (
            <div style={{ padding: "0.75rem 0" }}>
              <p className="eq-quotes__muted" style={{ marginBottom: 8 }}>No clients match.</p>
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--sm"
                style={{ fontSize: "0.82rem" }}
                onClick={() => setSearch("")}
              >
                Clear search
              </button>
            </div>
          )}
          {customers.length === 0 && (
            <p className="eq-quotes__muted" style={{ padding: "1rem 0" }}>
              No clients yet — add your first client above.
            </p>
          )}
        </div>
      </div>

      {/* ── Detail pane ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selected && (
          <div className="eq-quotes__empty" style={{ paddingTop: "3rem" }}>Select a client to view details.</div>
        )}
        {selected && (
          <div className="eq-quotes__detail-card">
            <div style={{ marginBottom: "1rem", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div className="eq-quotes__section-title" style={{ marginBottom: "0.25rem" }}>{selected.company_name}</div>
                <div style={{ fontSize: "0.85rem", color: "var(--eq-muted,#6b7280)" }}>
                  {[selected.suburb, selected.state].filter(Boolean).join(", ")}
                  {selected.primary_phone && <span style={{ marginLeft: "0.75rem" }}>{selected.primary_phone}</span>}
                  {selected.email && <span style={{ marginLeft: "0.75rem" }}>{selected.email}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                <button
                  className="eq-quotes__btn eq-quotes__btn--sm"
                  style={{ fontSize: "0.78rem", padding: "3px 10px" }}
                  onClick={() => {
                    setCustFormMode("edit");
                    setCustForm({
                      company_name:  selected.company_name  ?? "",
                      email:         selected.email         ?? "",
                      primary_phone: selected.primary_phone ?? "",
                      suburb:        selected.suburb        ?? "",
                      state:         selected.state         ?? "",
                    });
                    setShowCustForm(true);
                  }}
                >
                  Edit
                </button>
                <button
                  className="eq-quotes__btn eq-quotes__btn--sm"
                  style={{ fontSize: "0.78rem", padding: "3px 10px" }}
                  onClick={() => { setCustActionErr(null); setMergeSearch(""); setShowMerge((v) => !v); }}
                >
                  {showMerge ? "Cancel merge" : "Merge…"}
                </button>
                {selected.active && (
                  <button
                    className="eq-quotes__btn eq-quotes__btn--sm"
                    style={{ fontSize: "0.78rem", padding: "3px 10px", color: "var(--eq-muted,#6b7280)" }}
                    onClick={async () => {
                      if (!supabase) return;
                      await supabase.rpc("eq_archive_customer", { p_customer_id: selected.customer_id });
                      setSelected(null);
                      await load();
                    }}
                  >
                    Archive
                  </button>
                )}
                {confirmDeleteCustomer ? (
                  <>
                    <span style={{ fontSize: "0.78rem", color: "var(--eq-err,#c0392b)" }}>Delete this client?</span>
                    <button
                      type="button"
                      className="eq-quotes__btn eq-quotes__btn--sm"
                      style={{ fontSize: "0.78rem", padding: "3px 10px", color: "var(--eq-err,#c0392b)" }}
                      onClick={() => { void deleteCustomer(); }}
                    >
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      className="eq-quotes__btn eq-quotes__btn--sm"
                      style={{ fontSize: "0.78rem", padding: "3px 10px" }}
                      onClick={() => setConfirmDeleteCustomer(false)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="eq-quotes__btn eq-quotes__btn--sm"
                    style={{ fontSize: "0.78rem", padding: "3px 10px", color: "var(--eq-err,#c0392b)" }}
                    onClick={() => { void deleteCustomer(); }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            {custActionErr && (
              <div style={{ background: "var(--eq-err-bg,#fdf1f1)", border: "1px solid var(--eq-err,#c0392b)33", borderRadius: "6px", padding: "0.5rem 0.75rem", marginBottom: "0.75rem", fontSize: "0.82rem", color: "var(--eq-err,#c0392b)" }}>
                {custActionErr}
              </div>
            )}

            {showMerge && (
              <div style={{ background: "var(--eq-ice,#EAF5FB)", border: "1px solid var(--eq-border,#e5e7eb)", borderRadius: "6px", padding: "0.75rem", marginBottom: "1rem" }}>
                <div style={{ fontWeight: 600, fontSize: "0.82rem", marginBottom: "0.4rem" }}>
                  Merge a duplicate into <span style={{ color: "var(--eq-deep,#2986B4)" }}>{selected.company_name}</span>
                </div>
                <input
                  className="eq-quotes__input"
                  placeholder="Search the duplicate client…"
                  value={mergeSearch}
                  autoFocus
                  style={{ width: "100%", marginBottom: "0.5rem" }}
                  onChange={(e) => setMergeSearch(e.target.value)}
                />
                <div style={{ maxHeight: "220px", overflowY: "auto" }}>
                  {customers
                    .filter((c) => c.customer_id !== selected.customer_id && c.active)
                    .filter((c) => {
                      if (!mergeSearch.trim()) return true;
                      const q = mergeSearch.toLowerCase();
                      return (c.company_name ?? "").toLowerCase().includes(q);
                    })
                    .slice(0, 50)
                    .map((c) => (
                      <div
                        key={c.customer_id}
                        style={{ padding: "0.45rem 0.5rem", borderBottom: "1px solid var(--eq-border,#e5e7eb)", display: "flex", flexDirection: "column", gap: "0.3rem" }}
                      >
                        <div
                          style={{ cursor: mergeBusy ? "default" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                          role="button"
                          tabIndex={0}
                          onClick={() => { void mergeInto(c); }}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void mergeInto(c); } }}
                        >
                          <span style={{ fontWeight: 500, fontSize: "0.88rem" }}>{c.company_name ?? "(unnamed)"}</span>
                          <span style={{ fontSize: "0.76rem", color: "var(--eq-muted,#6b7280)" }}>
                            {c.quote_count > 0 ? `${c.quote_count} quote${c.quote_count !== 1 ? "s" : ""}` : "no quotes"}
                          </span>
                        </div>
                        {confirmMergeTarget?.customer_id === c.customer_id && (
                          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", paddingTop: "0.2rem" }}>
                            <span style={{ fontSize: "0.78rem", color: "var(--eq-err,#c0392b)" }}>Move all quotes, sites and contacts?</span>
                            <button
                              type="button"
                              className="eq-quotes__btn eq-quotes__btn--sm"
                              style={{ fontSize: "0.72rem", padding: "2px 8px", color: "var(--eq-err,#c0392b)" }}
                              onClick={() => { void mergeInto(c); }}
                            >Confirm merge</button>
                            <button
                              type="button"
                              className="eq-quotes__btn eq-quotes__btn--sm"
                              style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                              onClick={() => setConfirmMergeTarget(null)}
                            >Cancel</button>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
                {mergeBusy && <p className="eq-quotes__muted" style={{ marginTop: "0.4rem" }}>Merging…</p>}
              </div>
            )}

            {detailLoading && <p className="eq-quotes__muted">Loading…</p>}

            {!detailLoading && (
              <>
                {/* Contacts */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <span className="eq-quotes__section-title">Contacts ({contacts.length})</span>
                  <button
                    className="eq-quotes__btn eq-quotes__btn--sm"
                    onClick={() => {
                      setEditingContact(null);
                      setAddForm({ first_name: "", last_name: "", email: "", mobile_phone: "", position: "" });
                      setShowAddContact((v) => !v);
                    }}
                    style={{ fontSize: "0.78rem", padding: "3px 10px" }}
                  >
                    {showAddContact && !editingContact ? "Cancel" : showAddContact ? "New" : "+ Add"}
                  </button>
                </div>

                {showAddContact && (
                  <div style={{ background: "var(--eq-ice,#EAF5FB)", border: "1px solid var(--eq-border,#e5e7eb)", borderRadius: "6px", padding: "0.75rem", marginBottom: "1rem" }}>
                    {editingContact && (
                      <p style={{ fontSize: "0.78rem", color: "var(--eq-muted,#6b7280)", marginBottom: "0.5rem" }}>
                        Editing {[editingContact.first_name, editingContact.last_name].filter(Boolean).join(" ") || "contact"}
                      </p>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      {(["first_name","last_name"] as const).map((k) => (
                        <input
                          key={k}
                          className="eq-quotes__input"
                          placeholder={k === "first_name" ? "First name" : "Last name"}
                          value={addForm[k]}
                          onChange={(e) => setAddForm((f) => ({ ...f, [k]: e.target.value }))}
                        />
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <input
                        className="eq-quotes__input"
                        placeholder="Email"
                        type="email"
                        value={addForm.email}
                        onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                      />
                      <input
                        className="eq-quotes__input"
                        placeholder="Mobile"
                        value={addForm.mobile_phone}
                        onChange={(e) => setAddForm((f) => ({ ...f, mobile_phone: e.target.value }))}
                      />
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <input
                        className="eq-quotes__input"
                        placeholder="Role / position"
                        value={addForm.position}
                        style={{ flex: 1 }}
                        onChange={(e) => setAddForm((f) => ({ ...f, position: e.target.value }))}
                      />
                      <button
                        className="eq-quotes__btn eq-quotes__btn--primary"
                        disabled={addSaving}
                        onClick={() => { void saveContact(); }}
                        style={{ whiteSpace: "nowrap", fontSize: "0.82rem" }}
                      >
                        {addSaving ? "Saving…" : editingContact ? "Update" : "Save contact"}
                      </button>
                      {editingContact && (
                        <button
                          className="eq-quotes__btn eq-quotes__btn--sm"
                          onClick={() => {
                            setEditingContact(null);
                            setAddForm({ first_name: "", last_name: "", email: "", mobile_phone: "", position: "" });
                            setShowAddContact(false);
                          }}
                          style={{ fontSize: "0.82rem" }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {contacts.length === 0 && !showAddContact && (
                  <p className="eq-quotes__muted" style={{ marginBottom: "1rem" }}>No contacts on file.</p>
                )}
                {contacts.length > 0 && (
                  <table className="eq-quotes__reports-table" style={{ marginBottom: "1.25rem" }}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((ct) => (
                        <tr key={ct.contact_id}>
                          <td>
                            {[ct.first_name, ct.last_name].filter(Boolean).join(" ") || "—"}
                            {ct.is_default_quote_contact && (
                              <span style={{ marginLeft: "0.4rem", fontSize: "0.7rem", background: "var(--eq-sky,#3DA8D8)", color: "#fff", borderRadius: "3px", padding: "1px 5px" }}>
                                quote
                              </span>
                            )}
                          </td>
                          <td>{ct.contact_position ?? "—"}</td>
                          <td>{ct.email ?? "—"}</td>
                          <td>{ct.mobile_phone ?? ct.work_phone ?? "—"}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {!ct.is_default_quote_contact && (
                              <button
                                className="eq-quotes__btn eq-quotes__btn--sm"
                                style={{ fontSize: "0.72rem", padding: "2px 7px", marginRight: "4px" }}
                                title="Make this the default quote contact"
                                onClick={() => { void setPrimaryContact(ct); }}
                              >Set primary</button>
                            )}
                            <button
                              className="eq-quotes__btn eq-quotes__btn--sm"
                              style={{ fontSize: "0.72rem", padding: "2px 7px", marginRight: "4px" }}
                              onClick={() => {
                                setEditingContact(ct);
                                setAddForm({
                                  first_name:   ct.first_name   ?? "",
                                  last_name:    ct.last_name    ?? "",
                                  email:        ct.email        ?? "",
                                  mobile_phone: ct.mobile_phone ?? "",
                                  position:     ct.contact_position ?? "",
                                });
                                setShowAddContact(true);
                              }}
                            >Edit</button>
                            <button
                              className="eq-quotes__btn eq-quotes__btn--sm"
                              style={{ fontSize: "0.72rem", padding: "2px 7px", marginRight: "4px", color: "var(--eq-muted,#6b7280)" }}
                              onClick={() => { void archiveContact(ct); }}
                            >Archive</button>
                            <button
                              className="eq-quotes__btn eq-quotes__btn--sm"
                              style={{ fontSize: "0.72rem", padding: "2px 7px", color: "var(--eq-err,#c0392b)" }}
                              onClick={() => { void deleteContact(ct); }}
                            >Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Sites */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem", marginTop: "1.5rem" }}>
                  <span className="eq-quotes__section-title">Sites ({sites.length})</span>
                  <button
                    className="eq-quotes__btn eq-quotes__btn--sm"
                    style={{ fontSize: "0.78rem", padding: "3px 10px" }}
                    onClick={async () => {
                      if (!showAssignSite) { await loadAllSites(); }
                      setShowAssignSite((v) => !v);
                      setAssignSearch("");
                    }}
                  >
                    {showAssignSite ? "Cancel" : "Assign existing"}
                  </button>
                </div>

                {showAssignSite && (
                  <div style={{ background: "var(--eq-ice,#EAF5FB)", border: "1px solid var(--eq-border,#e5e7eb)", borderRadius: "6px", padding: "0.75rem", marginBottom: "1rem" }}>
                    <input
                      className="eq-quotes__input"
                      placeholder="Search sites…"
                      value={assignSearch}
                      style={{ width: "100%", marginBottom: "0.5rem" }}
                      autoFocus
                      onChange={(e) => setAssignSearch(e.target.value)}
                    />
                    <div style={{ maxHeight: "220px", overflowY: "auto" }}>
                      {allSites
                        .filter((s) => {
                          if (s.customer_id === selected.customer_id) return false;
                          if (!assignSearch.trim()) return true;
                          const q = assignSearch.toLowerCase();
                          return s.name.toLowerCase().includes(q) || (s.code ?? "").toLowerCase().includes(q);
                        })
                        .map((s) => (
                          <div
                            key={s.site_id}
                            style={{ padding: "0.45rem 0.5rem", borderBottom: "1px solid var(--eq-border,#e5e7eb)", cursor: assignSaving ? "default" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                            onClick={() => { void handleAssignSite(s.site_id); }}
                          >
                            <span style={{ fontWeight: 500, fontSize: "0.88rem" }}>{s.name}</span>
                            <span style={{ fontSize: "0.78rem", color: "var(--eq-muted,#6b7280)" }}>
                              {s.code ?? ""}
                              {s.customer_id && s.customer_id !== selected.customer_id && (
                                <span style={{ marginLeft: "0.4rem", color: "var(--eq-err,#c0392b)", fontSize: "0.72rem" }}>reassign</span>
                              )}
                            </span>
                          </div>
                        ))}
                      {allSites.filter((s) => s.customer_id !== selected.customer_id).length === 0 && (
                        <p className="eq-quotes__muted" style={{ padding: "0.5rem 0" }}>No other sites found.</p>
                      )}
                    </div>
                    {assignSaving && <p className="eq-quotes__muted" style={{ marginTop: "0.4rem" }}>Assigning…</p>}
                  </div>
                )}

                {editingSite && (
                  <div style={{ background: "var(--eq-ice,#EAF5FB)", border: "1px solid var(--eq-border,#e5e7eb)", borderRadius: "6px", padding: "0.75rem", marginBottom: "1rem" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.82rem", marginBottom: "0.5rem", color: "var(--eq-ink,#1A1A2E)" }}>
                      Edit site — {editingSite.name}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", marginBottom: "0.4rem" }}>
                      <input className="eq-quotes__input" placeholder="Site name *" value={siteForm.name}
                        onChange={(e) => setSiteForm((f) => ({ ...f, name: e.target.value }))} />
                      <input className="eq-quotes__input" placeholder="Code" value={siteForm.code}
                        onChange={(e) => setSiteForm((f) => ({ ...f, code: e.target.value }))} />
                      <input className="eq-quotes__input" placeholder="Suburb" value={siteForm.suburb}
                        onChange={(e) => setSiteForm((f) => ({ ...f, suburb: e.target.value }))} />
                      <input className="eq-quotes__input" placeholder="State (e.g. NSW)" value={siteForm.state}
                        onChange={(e) => setSiteForm((f) => ({ ...f, state: e.target.value }))} />
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--eq-muted,#6b7280)", marginBottom: "0.35rem", fontWeight: 600 }}>Site contact</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem", marginBottom: "0.5rem" }}>
                      <input className="eq-quotes__input" placeholder="Name" value={siteForm.site_contact_name}
                        onChange={(e) => setSiteForm((f) => ({ ...f, site_contact_name: e.target.value }))} />
                      <input className="eq-quotes__input" placeholder="Phone" value={siteForm.site_contact_phone}
                        onChange={(e) => setSiteForm((f) => ({ ...f, site_contact_phone: e.target.value }))} />
                      <input className="eq-quotes__input" placeholder="Email" type="email" value={siteForm.site_contact_email}
                        onChange={(e) => setSiteForm((f) => ({ ...f, site_contact_email: e.target.value }))} />
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button className="eq-quotes__btn eq-quotes__btn--primary" disabled={siteSaving}
                        onClick={() => { void saveSite(); }} style={{ fontSize: "0.82rem" }}>
                        {siteSaving ? "Saving…" : "Update site"}
                      </button>
                      <button className="eq-quotes__btn eq-quotes__btn--sm"
                        onClick={() => { setEditingSite(null); setCustActionErr(null); }} style={{ fontSize: "0.82rem" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {sites.length === 0 && !showAssignSite && (
                  <p className="eq-quotes__muted" style={{ marginBottom: "1rem" }}>No sites linked. Use "Assign existing" to link a site.</p>
                )}

                {sites.length > 0 && (
                  <table className="eq-quotes__reports-table" style={{ marginBottom: "1.25rem" }}>
                    <thead>
                      <tr>
                        <th>Site</th>
                        <th>Code</th>
                        <th>Contacts</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sites.map((s) => (
                        <React.Fragment key={s.site_id}>
                          <tr
                            style={{ cursor: "pointer" }}
                            tabIndex={0}
                            onClick={() => { void toggleSiteExpand(s.site_id); }}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void toggleSiteExpand(s.site_id); } }}
                          >
                            <td style={{ fontWeight: 500 }}>
                              {s.name}
                              {(s.suburb || s.state) && (
                                <span style={{ fontWeight: 400, color: "var(--eq-muted,#6b7280)", fontSize: "0.8em", marginLeft: "0.4rem" }}>
                                  {[s.suburb, s.state].filter(Boolean).join(", ")}
                                </span>
                              )}
                            </td>
                            <td style={{ fontFamily: "monospace", fontSize: "0.85em" }}>{s.code ?? "—"}</td>
                            <td>
                              <span style={{ color: "var(--eq-sky,#3DA8D8)", fontSize: "0.82rem" }}>
                                <span aria-hidden="true">{expandedSiteId === s.site_id ? "▲" : "▼"}</span>{" "}
                                {(siteContacts[s.site_id] ?? []).length > 0
                                  ? `${(siteContacts[s.site_id] ?? []).length} contact${(siteContacts[s.site_id] ?? []).length !== 1 ? "s" : ""}`
                                  : "view contacts"}
                              </span>
                            </td>
                            <td>
                              <button
                                className="eq-quotes__btn eq-quotes__btn--sm"
                                style={{ fontSize: "0.72rem", padding: "2px 7px" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingSite(s);
                                  setSiteForm({
                                    name:               s.name               ?? "",
                                    code:               s.code               ?? "",
                                    suburb:             s.suburb             ?? "",
                                    state:              s.state              ?? "",
                                    site_contact_name:  s.site_contact_name  ?? "",
                                    site_contact_phone: s.site_contact_phone ?? "",
                                    site_contact_email: s.site_contact_email ?? "",
                                  });
                                  setCustActionErr(null);
                                }}
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                          {expandedSiteId === s.site_id && (
                            <tr>
                              <td colSpan={4} style={{ background: "var(--eq-ice,#EAF5FB)", padding: "0.6rem 0.75rem" }}>
                                {(siteContacts[s.site_id] ?? []).length === 0 && (
                                  <p className="eq-quotes__muted" style={{ marginBottom: "0.4rem" }}>No contacts linked to this site yet.</p>
                                )}
                                {(siteContacts[s.site_id] ?? []).map((ct) => (
                                  <div key={ct.contact_id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem", fontSize: "0.85rem" }}>
                                    <span style={{ fontWeight: 500 }}>
                                      {[ct.first_name, ct.last_name].filter(Boolean).join(" ") || "—"}
                                    </span>
                                    {ct.role && (
                                      <span className="eq-quotes__muted">· {ct.role}</span>
                                    )}
                                    {ct.contact_position && !ct.role && (
                                      <span className="eq-quotes__muted">· {ct.contact_position}</span>
                                    )}
                                    {ct.mobile_phone && (
                                      <span className="eq-quotes__muted">{ct.mobile_phone}</span>
                                    )}
                                    <button
                                      className="eq-quotes__btn eq-quotes__btn--sm"
                                      style={{ fontSize: "0.7rem", padding: "1px 6px", marginLeft: "auto", color: "var(--eq-muted,#6b7280)" }}
                                      onClick={() => { void handleUnlinkContact(s.site_id, ct.contact_id); }}
                                    >
                                      Unlink
                                    </button>
                                  </div>
                                ))}
                                <div style={{ marginTop: "0.5rem" }}>
                                  {showLinkContact[s.site_id] ? (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                                      {contacts
                                        .filter((ct) => !(siteContacts[s.site_id] ?? []).some((sc) => sc.contact_id === ct.contact_id))
                                        .map((ct) => (
                                          <div
                                            key={ct.contact_id}
                                            style={{ cursor: "pointer", fontSize: "0.85rem", padding: "0.25rem 0.4rem", borderRadius: "4px", border: "1px solid var(--eq-border,#e5e7eb)", background: "#fff" }}
                                            onClick={() => { void handleLinkContact(s.site_id, ct.contact_id); }}
                                          >
                                            {[ct.first_name, ct.last_name].filter(Boolean).join(" ") || "(unnamed)"}
                                            {ct.contact_position && <span className="eq-quotes__muted"> · {ct.contact_position}</span>}
                                          </div>
                                        ))}
                                      {contacts.filter((ct) => !(siteContacts[s.site_id] ?? []).some((sc) => sc.contact_id === ct.contact_id)).length === 0 && (
                                        <p className="eq-quotes__muted" style={{ fontSize: "0.8rem" }}>All customer contacts already linked.</p>
                                      )}
                                      <button
                                        className="eq-quotes__btn eq-quotes__btn--sm"
                                        style={{ fontSize: "0.75rem", padding: "2px 8px", alignSelf: "flex-start" }}
                                        onClick={() => setShowLinkContact((prev) => ({ ...prev, [s.site_id]: false }))}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      className="eq-quotes__btn eq-quotes__btn--sm"
                                      style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                                      onClick={() => setShowLinkContact((prev) => ({ ...prev, [s.site_id]: true }))}
                                    >
                                      + Link contact
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Quotes */}
                <div className="eq-quotes__section-title" style={{ marginBottom: "0.5rem" }}>
                  Recent quotes ({custQuotes.length})
                </div>
                {custQuotes.length === 0 && (
                  <p className="eq-quotes__muted">No quotes for this client yet.</p>
                )}
                {custQuotes.length > 0 && (
                  <table className="eq-quotes__reports-table">
                    <thead>
                      <tr>
                        <th>Quote No.</th>
                        <th>Status</th>
                        <th>Project</th>
                        <th style={{ textAlign: "right" }}>Value</th>
                        <th>Est.</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {custQuotes.map((q) => (
                        <tr
                          key={q.quote_id}
                          style={{ cursor: onOpenQuote ? "pointer" : undefined }}
                          onClick={() => onOpenQuote?.(q.quote_id)}
                        >
                          <td style={{ fontFamily: "monospace", fontSize: "0.85em" }}>{q.quote_number}</td>
                          <td>{STATUS_LABELS[q.status] ?? q.status}</td>
                          <td>{q.project_name ?? "—"}</td>
                          <td style={{ textAlign: "right" }}>{fmtMoney(q.total_cents)}</td>
                          <td>{q.estimator_initials ? (
                            <span className="eq-quotes__initials-badge">{q.estimator_initials}</span>
                          ) : "—"}</td>
                          <td>{new Date(q.created_at).toLocaleDateString("en-AU")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
