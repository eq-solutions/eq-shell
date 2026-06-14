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
  const [addForm, setAddForm] = useState({ first_name: "", last_name: "", email: "", mobile_phone: "", position: "" });
  const [addSaving, setAddSaving] = useState(false);

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

  const saveContact = useCallback(async () => {
    if (!supabase || !selected) return;
    setAddSaving(true);
    const extId = `EQ-${crypto.randomUUID()}`;
    const { error } = await supabase.rpc("eq_upsert_contact", {
      p_external_id:  extId,
      p_customer_id:  selected.customer_id,
      p_first_name:   addForm.first_name || null,
      p_last_name:    addForm.last_name  || null,
      p_email:        addForm.email      || null,
      p_mobile_phone: addForm.mobile_phone || null,
      p_position:     addForm.position   || null,
    });
    setAddSaving(false);
    if (!error) {
      setShowAddContact(false);
      setAddForm({ first_name: "", last_name: "", email: "", mobile_phone: "", position: "" });
      // Reload contacts for this customer
      const { data } = await supabase.rpc("eq_list_contacts_for_customer", { p_customer_id: selected.customer_id });
      if (data) {
        setContacts(((data as Record<string, unknown>[]).map((r) => ({
          contact_id:               String(r.contact_id),
          first_name:               r.first_name ? String(r.first_name) : null,
          last_name:                r.last_name ? String(r.last_name) : null,
          email:                    r.email ? String(r.email) : null,
          work_phone:               r.work_phone ? String(r.work_phone) : null,
          mobile_phone:             r.mobile_phone ? String(r.mobile_phone) : null,
          contact_position:         r.contact_position ? String(r.contact_position) : null,
          is_default_quote_contact: Boolean(r.is_default_quote_contact),
        }))));
      }
    }
  }, [supabase, selected, addForm]);

  const loadDetail = useCallback(async (c: CustomerRow) => {
    if (!supabase) return;
    setSelected(c);
    setContacts([]);
    setCustQuotes([]);
    setShowAddContact(false);
    setAddForm({ first_name: "", last_name: "", email: "", mobile_phone: "", position: "" });
    setDetailLoading(true);
    const [ctRes, qRes] = await Promise.all([
      supabase.rpc("eq_list_contacts_for_customer", { p_customer_id: c.customer_id }),
      supabase.rpc("eq_list_quotes_for_customer",   { p_customer_id: c.customer_id }),
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

  if (loading) return <div className="eq-quotes__empty">Loading clients…</div>;
  if (error)   return <div className="eq-quotes__empty" style={{ color: "var(--eq-err,#c0392b)" }}>Error: {error}</div>;

  return (
    <div className="eq-quotes__customers" style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start" }}>
      {/* ── List pane ── */}
      <div style={{ flex: "0 0 420px", minWidth: 0 }}>
        <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
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

        <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 280px)" }}>
          {filtered.map((c) => (
            <div
              key={c.customer_id}
              className={`eq-quotes__customer-row${selected?.customer_id === c.customer_id ? " eq-quotes__customer-row--active" : ""}`}
              onClick={() => void loadDetail(c)}
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
          {filtered.length === 0 && (
            <p className="eq-quotes__muted" style={{ padding: "1rem 0" }}>No clients match.</p>
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
            <div style={{ marginBottom: "1rem" }}>
              <div className="eq-quotes__section-title" style={{ marginBottom: "0.25rem" }}>{selected.company_name}</div>
              <div style={{ fontSize: "0.85rem", color: "var(--eq-muted,#6b7280)" }}>
                {[selected.suburb, selected.state].filter(Boolean).join(", ")}
                {selected.primary_phone && <span style={{ marginLeft: "0.75rem" }}>{selected.primary_phone}</span>}
                {selected.email && <span style={{ marginLeft: "0.75rem" }}>{selected.email}</span>}
              </div>
            </div>

            {detailLoading && <p className="eq-quotes__muted">Loading…</p>}

            {!detailLoading && (
              <>
                {/* Contacts */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <span className="eq-quotes__section-title">Contacts ({contacts.length})</span>
                  <button
                    className="eq-quotes__btn eq-quotes__btn--sm"
                    onClick={() => setShowAddContact((v) => !v)}
                    style={{ fontSize: "0.78rem", padding: "3px 10px" }}
                  >
                    {showAddContact ? "Cancel" : "+ Add"}
                  </button>
                </div>

                {showAddContact && (
                  <div style={{ background: "var(--eq-ice,#EAF5FB)", border: "1px solid var(--eq-border,#e5e7eb)", borderRadius: "6px", padding: "0.75rem", marginBottom: "1rem" }}>
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
                        {addSaving ? "Saving…" : "Save contact"}
                      </button>
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Quotes */}
                <div className="eq-quotes__section-title" style={{ marginBottom: "0.5rem" }}>
                  Recent quotes ({custQuotes.length})
                </div>
                {custQuotes.length === 0 && (
                  <p className="eq-quotes__muted">No quotes yet.</p>
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
