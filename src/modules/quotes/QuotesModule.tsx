import React, { useState, useEffect, useCallback, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Quote {
  quote_id: string;
  quote_number: string;
  status: string;
  project_name: string | null;
  estimator_name: string | null;
  estimator_initials: string | null;
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
  margin_pct: number | null;
  sent_at: string | null;
  expires_at: string | null;
  workbench_job_no: string | null;
  po_number: string | null;
  created_at: string;
  customer_name: string | null;
  site_name: string | null;
  site_code: string | null;
  line_item_count: number;
}

interface LineItem {
  line_number: number;
  description: string;
  quantity_thousandths: number;
  unit: string | null;
  unit_rate_cents: number;
  line_total_cents: number;
  category: string | null;
}

interface QuoteNote {
  note_id: string;
  note_type: string;
  body: string;
  initials: string | null;
  created_at: string;
}

interface QuoteDetail {
  quote_id: string;
  quote_number: string;
  status: string;
  project_name: string | null;
  estimator_name: string | null;
  estimator_initials: string | null;
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
  margin_pct: number | null;
  sent_at: string | null;
  expires_at: string | null;
  workbench_job_no: string | null;
  po_number: string | null;
  coupa_entity: string | null;
  scope_of_works: string | null;
  attn_name: string | null;
  attn_first_name: string | null;
  attn_phone: string | null;
  address: string | null;
  payment_terms: string | null;
  validity_days: number | null;
  client_accepted_at: string | null;
  client_accepted_by: string | null;
  client_declined_at: string | null;
  loss_reason: string | null;
  created_at: string;
  customer_name: string | null;
  site_name: string | null;
  site_code: string | null;
  line_items: LineItem[];
  notes: QuoteNote[];
}

interface ClientGroup {
  group_id: string;
  group_name: string;
  group_slug: string;
  customer_id: string;
  customer_name: string;
  site_codes: string[];
}

interface CoupaRow {
  po_number: string;
  site_code: string;
  coupa_entity: string;
}

interface ImportResult {
  row: CoupaRow;
  matched: boolean;
  quote_number: string | null;
  message: string;
}

interface QuotesModuleProps {
  supabase: SupabaseClient | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  "verbal-win": "Verbal Win",
  "won-awaiting-job-no": "Won — Awaiting Job No.",
  "won-job-created": "Won — Job Created",
  "po-matched": "PO Matched",
  active: "Active",
  complete: "Complete",
  "ready-to-invoice": "Ready to Invoice",
  lost: "Lost",
  cancelled: "Cancelled",
  expired: "Expired",
  superseded: "Superseded",
};

const ACTIVE_JOB_STATUSES = new Set([
  "verbal-win", "won-awaiting-job-no", "won-job-created", "po-matched", "active",
]);

const STATUS_FILTERS = [
  { key: "active-jobs", label: "Active Jobs" },
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "verbal-win", label: "Verbal Win" },
  { key: "won-awaiting-job-no", label: "Won — No Job No." },
  { key: "won-job-created", label: "Won — Job Created" },
  { key: "po-matched", label: "PO Matched" },
  { key: "active", label: "Active" },
  { key: "complete", label: "Complete" },
  { key: "lost", label: "Lost" },
];

const NEXT_STATUSES: Record<string, string[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["verbal-win", "lost", "cancelled"],
  "verbal-win": ["won-awaiting-job-no", "lost"],
  "won-awaiting-job-no": ["won-job-created", "lost"],
  "won-job-created": ["po-matched", "active"],
  "po-matched": ["active"],
  active: ["complete"],
  complete: ["ready-to-invoice"],
  "ready-to-invoice": [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aud(cents: number): string {
  return (cents / 100).toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function qty(thousandths: number): string {
  return (thousandths / 1000).toLocaleString("en-AU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function statusClass(status: string): string {
  if (["active", "po-matched", "won-job-created"].includes(status))
    return "eq-quotes__badge eq-quotes__badge--green";
  if (["verbal-win", "won-awaiting-job-no"].includes(status))
    return "eq-quotes__badge eq-quotes__badge--amber";
  if (["submitted"].includes(status))
    return "eq-quotes__badge eq-quotes__badge--blue";
  if (["complete", "ready-to-invoice"].includes(status))
    return "eq-quotes__badge eq-quotes__badge--teal";
  if (["lost", "expired"].includes(status))
    return "eq-quotes__badge eq-quotes__badge--red";
  return "eq-quotes__badge eq-quotes__badge--gray";
}

function parseCSV(text: string): CoupaRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const first = lines[0].toLowerCase();
  const hasHeader =
    first.includes("po") || first.includes("site") || first.includes("number");
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines
    .map((line) => {
      const cols = line.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
      return { po_number: cols[0] ?? "", site_code: cols[1] ?? "", coupa_entity: cols[2] ?? "" };
    })
    .filter((r) => r.po_number && r.site_code);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuotesModule({ supabase }: QuotesModuleProps): React.JSX.Element {
  type ModuleView = "pipeline" | "accordion" | "import";

  // ── Main navigation ──────────────────────────────────────────────────────
  const [view, setView] = useState<ModuleView>("pipeline");
  const [detailId, setDetailId] = useState<string | null>(null);

  // ── Pipeline state ────────────────────────────────────────────────────────
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [statusFilter, setStatusFilter] = useState("active-jobs");
  const [search, setSearch] = useState("");
  const [pipelineLoading, setPipelineLoading] = useState(true);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Detail state ──────────────────────────────────────────────────────────
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Status update
  const [advanceStatus, setAdvanceStatus] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [initials, setInitials] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusMutErr, setStatusMutErr] = useState<string | null>(null);

  // Workbench job number inline edit
  const [jobNoInput, setJobNoInput] = useState("");
  const [savingJobNo, setSavingJobNo] = useState(false);
  const [jobNoErr, setJobNoErr] = useState<string | null>(null);

  // Note
  const [noteBody, setNoteBody] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [noteMutErr, setNoteMutErr] = useState<string | null>(null);

  // ── Accordion state ───────────────────────────────────────────────────────
  const [clientGroups, setClientGroups] = useState<ClientGroup[]>([]);
  const [accordionQuotes, setAccordionQuotes] = useState<Quote[]>([]);
  const [accordionLoading, setAccordionLoading] = useState(false);
  const [accordionError, setAccordionError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["equinix"]));

  // ── Import state ──────────────────────────────────────────────────────────
  const [csvText, setCsvText] = useState("");
  const [parsedRows, setParsedRows] = useState<CoupaRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [importing, setImporting] = useState(false);
  const [importInitials, setImportInitials] = useState("");

  // ── Data loaders ──────────────────────────────────────────────────────────

  const loadQuotes = useCallback(
    async (status: string, q: string) => {
      if (!supabase) {
        setPipelineLoading(false);
        setPipelineError("No Supabase connection.");
        return;
      }
      setPipelineLoading(true);
      setPipelineError(null);
      const { data, error } = await supabase.rpc("eq_list_quotes", {
        p_status: status === "all" || status === "active-jobs" ? null : status,
        p_search: q.trim() || null,
      });
      setPipelineLoading(false);
      if (error) setPipelineError(error.message);
      else setQuotes((data as Quote[]) ?? []);
    },
    [supabase],
  );

  useEffect(() => {
    void loadQuotes(statusFilter, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const openDetail = useCallback(
    async (quoteId: string) => {
      if (!supabase) return;
      setDetailId(quoteId);
      setDetail(null);
      setDetailLoading(true);
      setDetailError(null);
      setAdvanceStatus("");
      setStatusNote("");
      setNoteBody("");
      setStatusMutErr(null);
      setNoteMutErr(null);
      setJobNoInput("");
      setJobNoErr(null);
      const { data, error } = await supabase.rpc("eq_get_quote_detail", {
        p_quote_id: quoteId,
      });
      setDetailLoading(false);
      if (error) {
        setDetailError(error.message);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = ((data as any[])[0] as QuoteDetail) ?? null;
      setDetail(row);
      if (row) {
        const nexts = NEXT_STATUSES[row.status] ?? [];
        if (nexts.length > 0) setAdvanceStatus(nexts[0]);
        setJobNoInput(row.workbench_job_no ?? "");
      }
    },
    [supabase],
  );

  const loadAccordion = useCallback(async () => {
    if (!supabase) return;
    setAccordionLoading(true);
    setAccordionError(null);
    const [g, q] = await Promise.all([
      supabase.rpc("eq_list_client_groups"),
      supabase.rpc("eq_list_quotes", { p_status: null, p_search: null }),
    ]);
    setAccordionLoading(false);
    if (g.error) { setAccordionError(g.error.message); return; }
    if (q.error) { setAccordionError(q.error.message); return; }
    setClientGroups((g.data as ClientGroup[]) ?? []);
    setAccordionQuotes((q.data as Quote[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    if (view === "accordion") void loadAccordion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ── Pipeline actions ──────────────────────────────────────────────────────

  const handleSearch = (q: string) => {
    setSearch(q);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => void loadQuotes(statusFilter, q), 300);
  };

  // ── Detail actions ────────────────────────────────────────────────────────

  const handleStatusUpdate = async () => {
    if (!supabase || !detail || !advanceStatus) return;
    setUpdatingStatus(true);
    setStatusMutErr(null);
    const { error } = await supabase.rpc("eq_update_quote_status", {
      p_quote_id: detail.quote_id,
      p_new_status: advanceStatus,
      p_note: statusNote.trim() || null,
      p_initials: initials.trim() || null,
    });
    setUpdatingStatus(false);
    if (error) { setStatusMutErr(error.message); return; }
    setStatusNote("");
    await openDetail(detail.quote_id);
    void loadQuotes(statusFilter, search);
  };

  const handleAddNote = async () => {
    if (!supabase || !detail || !noteBody.trim()) return;
    setAddingNote(true);
    setNoteMutErr(null);
    const { error } = await supabase.rpc("eq_add_quote_note", {
      p_quote_id: detail.quote_id,
      p_body: noteBody.trim(),
      p_note_type: "manual",
      p_initials: initials.trim() || null,
    });
    setAddingNote(false);
    if (error) { setNoteMutErr(error.message); return; }
    setNoteBody("");
    await openDetail(detail.quote_id);
  };

  const handleSaveJobNo = async () => {
    if (!supabase || !detail || !jobNoInput.trim()) return;
    setSavingJobNo(true);
    setJobNoErr(null);
    const { error } = await supabase.rpc("eq_set_workbench_job_no", {
      p_quote_id: detail.quote_id,
      p_workbench_job_no: jobNoInput.trim(),
      p_initials: initials.trim() || null,
    });
    setSavingJobNo(false);
    if (error) { setJobNoErr(error.message); return; }
    await openDetail(detail.quote_id);
    void loadQuotes(statusFilter, search);
  };

  // ── Import actions ────────────────────────────────────────────────────────

  const handleCsvChange = (text: string) => {
    setCsvText(text);
    setParseError(null);
    setImportResults([]);
    try {
      setParsedRows(parseCSV(text));
    } catch {
      setParseError("Could not parse CSV.");
      setParsedRows([]);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleCsvChange((ev.target?.result as string) ?? "");
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleImport = async () => {
    if (!supabase || parsedRows.length === 0) return;
    setImporting(true);
    setImportResults([]);
    const results: ImportResult[] = [];
    for (const row of parsedRows) {
      const { data, error } = await supabase.rpc("eq_match_coupa_po", {
        p_po_number: row.po_number,
        p_site_code: row.site_code.toUpperCase(),
        p_coupa_entity: row.coupa_entity || null,
        p_initials: importInitials.trim() || null,
      });
      if (error) {
        results.push({ row, matched: false, quote_number: null, message: error.message });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = ((data as any[])[0]) as { matched: boolean; quote_number: string; message: string } | undefined;
        results.push({
          row,
          matched: res?.matched ?? false,
          quote_number: res?.quote_number ?? null,
          message: res?.message ?? "No response",
        });
      }
    }
    setImporting(false);
    setImportResults(results);
    void loadQuotes(statusFilter, search);
  };

  // ── Accordion helpers ─────────────────────────────────────────────────────

  const toggleGroup = (slug: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  // Build: group_id → { group_name, group_slug, members: ClientGroup[] }
  const groupMap = clientGroups.reduce<Record<string, { name: string; slug: string; members: ClientGroup[] }>>(
    (acc, g) => {
      if (!acc[g.group_id]) acc[g.group_id] = { name: g.group_name, slug: g.group_slug, members: [] };
      acc[g.group_id].members.push(g);
      return acc;
    },
    {},
  );

  // Build: customer_name → Quote[]
  const quotesByCustomer = accordionQuotes.reduce<Record<string, Quote[]>>((acc, q) => {
    const k = q.customer_name ?? "Unknown";
    (acc[k] ??= []).push(q);
    return acc;
  }, {});

  // ── Computed totals ───────────────────────────────────────────────────────

  const displayedQuotes = statusFilter === "active-jobs"
    ? quotes.filter((q) => ACTIVE_JOB_STATUSES.has(q.status))
    : quotes;
  const visibleTotal = displayedQuotes.reduce((s, q) => s + q.total_cents, 0);
  const wonTotal = displayedQuotes
    .filter((q) => ACTIVE_JOB_STATUSES.has(q.status))
    .reduce((s, q) => s + q.total_cents, 0);

  // ── Render detail view ────────────────────────────────────────────────────

  if (detailId !== null) {
    const nexts = detail ? (NEXT_STATUSES[detail.status] ?? []) : [];
    return (
      <div className="eq-quotes">
        <div className="eq-quotes__detail-header">
          <button
            type="button"
            className="eq-quotes__back"
            onClick={() => { setDetailId(null); setDetail(null); }}
          >
            ← EQ Ops
          </button>
          {detail && (
            <div className="eq-quotes__detail-title-row">
              <h2 className="eq-quotes__detail-num">{detail.quote_number}</h2>
              <span className={statusClass(detail.status)}>
                {STATUS_LABELS[detail.status] ?? detail.status}
              </span>
            </div>
          )}
        </div>

        {detailLoading && <div className="eq-quotes__loading">Loading…</div>}
        {detailError && <div className="eq-quotes__error-banner">{detailError}</div>}

        {detail && (
          <div className="eq-quotes__detail-body">
            {/* Info grid */}
            <div className="eq-quotes__detail-card">
              <div className="eq-quotes__info-grid">
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">Customer</span>
                  <span className="eq-quotes__info-val">{detail.customer_name ?? "—"}</span>
                </div>
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">Site</span>
                  <span className="eq-quotes__info-val">
                    {detail.site_name ?? "—"}
                    {detail.site_code && (
                      <span className="eq-quotes__site-code">{detail.site_code}</span>
                    )}
                  </span>
                </div>
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">Project</span>
                  <span className="eq-quotes__info-val">{detail.project_name ?? "—"}</span>
                </div>
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">Estimator</span>
                  <span className="eq-quotes__info-val">
                    {detail.estimator_name ?? "—"}
                    {detail.estimator_initials && (
                      <span className="eq-quotes__initials-badge">{detail.estimator_initials}</span>
                    )}
                  </span>
                </div>
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">Sent</span>
                  <span className="eq-quotes__info-val">{fmtDate(detail.sent_at)}</span>
                </div>
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">Expires</span>
                  <span className="eq-quotes__info-val">{fmtDate(detail.expires_at)}</span>
                </div>
                <div className="eq-quotes__info-item eq-quotes__info-item--full">
                  <span className="eq-quotes__info-label">Workbench Job No.</span>
                  <div className="eq-quotes__job-no-row">
                    <input
                      className="eq-quotes__input eq-quotes__input--job-no"
                      value={jobNoInput}
                      onChange={(e) => setJobNoInput(e.target.value)}
                      placeholder="e.g. 12345"
                      onKeyDown={(e) => { if (e.key === "Enter") void handleSaveJobNo(); }}
                    />
                    <button
                      type="button"
                      className="eq-quotes__btn eq-quotes__btn--primary"
                      disabled={savingJobNo || jobNoInput.trim() === (detail.workbench_job_no ?? "")}
                      onClick={() => void handleSaveJobNo()}
                    >
                      {savingJobNo ? "Saving…" : "Save"}
                    </button>
                  </div>
                  {jobNoErr && <div className="eq-quotes__inline-err">{jobNoErr}</div>}
                </div>
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">PO Number</span>
                  <span className="eq-quotes__info-val">
                    {detail.po_number || <span className="eq-quotes__muted">—</span>}
                  </span>
                </div>
                {detail.coupa_entity && (
                  <div className="eq-quotes__info-item">
                    <span className="eq-quotes__info-label">Coupa Entity</span>
                    <span className="eq-quotes__info-val">{detail.coupa_entity}</span>
                  </div>
                )}
                {detail.payment_terms && (
                  <div className="eq-quotes__info-item">
                    <span className="eq-quotes__info-label">Payment Terms</span>
                    <span className="eq-quotes__info-val">{detail.payment_terms}</span>
                  </div>
                )}
              </div>

              {detail.scope_of_works && (
                <div className="eq-quotes__scope">
                  <span className="eq-quotes__info-label">Scope of Works</span>
                  <p className="eq-quotes__scope-text">{detail.scope_of_works}</p>
                </div>
              )}

              {/* Financial summary */}
              <div className="eq-quotes__financials">
                <div className="eq-quotes__financial-row">
                  <span>Subtotal</span>
                  <span>{aud(detail.subtotal_cents)}</span>
                </div>
                <div className="eq-quotes__financial-row">
                  <span>GST (10%)</span>
                  <span>{aud(detail.gst_cents)}</span>
                </div>
                <div className="eq-quotes__financial-row eq-quotes__financial-row--total">
                  <span>Total</span>
                  <span>{aud(detail.total_cents)}</span>
                </div>
                {detail.margin_pct !== null && (
                  <div className="eq-quotes__financial-row eq-quotes__financial-row--margin">
                    <span>Margin</span>
                    <span>{Number(detail.margin_pct).toFixed(1)}%</span>
                  </div>
                )}
              </div>
            </div>

            {/* Line items */}
            {detail.line_items.length > 0 && (
              <div className="eq-quotes__detail-card">
                <h3 className="eq-quotes__section-title">Line Items</h3>
                <div className="eq-quotes__table-wrap">
                  <table className="eq-quotes__table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Description</th>
                        <th>Category</th>
                        <th className="eq-quotes__th--right">Qty</th>
                        <th>Unit</th>
                        <th className="eq-quotes__th--right">Rate</th>
                        <th className="eq-quotes__th--right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.line_items.map((li) => (
                        <tr key={li.line_number}>
                          <td className="eq-quotes__td--mono">{li.line_number}</td>
                          <td>{li.description}</td>
                          <td>
                            {li.category ? (
                              <span className="eq-quotes__cat-badge">{li.category}</span>
                            ) : (
                              <span className="eq-quotes__muted">—</span>
                            )}
                          </td>
                          <td className="eq-quotes__td--right">{qty(li.quantity_thousandths)}</td>
                          <td>{li.unit ?? <span className="eq-quotes__muted">—</span>}</td>
                          <td className="eq-quotes__td--right">{aud(li.unit_rate_cents)}</td>
                          <td className="eq-quotes__td--right eq-quotes__td--bold">{aud(li.line_total_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Status advance */}
            {nexts.length > 0 && (
              <div className="eq-quotes__detail-card">
                <h3 className="eq-quotes__section-title">Advance Status</h3>
                <div className="eq-quotes__initials-row">
                  <label className="eq-quotes__label">
                    Your initials
                    <input
                      className="eq-quotes__input eq-quotes__input--sm"
                      value={initials}
                      onChange={(e) => setInitials(e.target.value.toUpperCase())}
                      placeholder="RM"
                      maxLength={4}
                    />
                  </label>
                </div>
                <div className="eq-quotes__advance-row">
                  <select
                    className="eq-quotes__select"
                    value={advanceStatus}
                    onChange={(e) => setAdvanceStatus(e.target.value)}
                  >
                    {nexts.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s] ?? s}
                      </option>
                    ))}
                  </select>
                  <input
                    className="eq-quotes__input eq-quotes__input--note"
                    placeholder="Optional note…"
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                  />
                  <button
                    type="button"
                    className="eq-quotes__btn eq-quotes__btn--primary"
                    disabled={updatingStatus || !advanceStatus}
                    onClick={() => void handleStatusUpdate()}
                  >
                    {updatingStatus ? "Saving…" : "Update"}
                  </button>
                </div>
                {statusMutErr && (
                  <div className="eq-quotes__inline-err">{statusMutErr}</div>
                )}
              </div>
            )}

            {/* Notes */}
            <div className="eq-quotes__detail-card">
              <h3 className="eq-quotes__section-title">Notes</h3>
              <div className="eq-quotes__note-add">
                <textarea
                  className="eq-quotes__textarea"
                  placeholder="Add a note…"
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  rows={3}
                />
                <div className="eq-quotes__note-actions">
                  <button
                    type="button"
                    className="eq-quotes__btn eq-quotes__btn--primary"
                    disabled={addingNote || !noteBody.trim()}
                    onClick={() => void handleAddNote()}
                  >
                    {addingNote ? "Saving…" : "Add Note"}
                  </button>
                </div>
                {noteMutErr && <div className="eq-quotes__inline-err">{noteMutErr}</div>}
              </div>
              {detail.notes.length === 0 ? (
                <div className="eq-quotes__empty-notes">No notes yet.</div>
              ) : (
                <div className="eq-quotes__notes-list">
                  {detail.notes.map((n) => (
                    <div key={n.note_id} className="eq-quotes__note">
                      <div className="eq-quotes__note-meta">
                        {n.initials && (
                          <span className="eq-quotes__initials-badge">{n.initials}</span>
                        )}
                        <span className="eq-quotes__note-type">{n.note_type}</span>
                        <span className="eq-quotes__note-date">{fmtDate(n.created_at)}</span>
                      </div>
                      <p className="eq-quotes__note-body">{n.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Render main views ─────────────────────────────────────────────────────

  return (
    <div className="eq-quotes">
      {/* Module header */}
      <div className="eq-quotes__module-header">
        <h2 className="eq-quotes__title">EQ Ops</h2>
        <div className="eq-quotes__header-right">
          <a
            href="https://quotes.eq.solutions/quotes/new"
            target="_blank"
            rel="noopener noreferrer"
            className="eq-quotes__btn eq-quotes__btn--outline eq-quotes__btn--new-quote"
          >
            New Quote ↗
          </a>
          <div className="eq-quotes__view-tabs">
            {(["pipeline", "accordion", "import"] as ModuleView[]).map((v) => (
              <button
                key={v}
                type="button"
                className={`eq-quotes__view-tab${view === v ? " eq-quotes__view-tab--active" : ""}`}
                onClick={() => setView(v)}
              >
                {v === "pipeline" ? "Jobs" : v === "accordion" ? "By Client" : "Import Coupa"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Pipeline view */}
      {view === "pipeline" && (
        <div className="eq-quotes__pipeline">
          {/* Status filter tabs */}
          <div className="eq-quotes__status-filters">
            {STATUS_FILTERS.map((f) => {
              const count = f.key === "active-jobs"
                ? quotes.filter((q) => ACTIVE_JOB_STATUSES.has(q.status)).length
                : f.key === "all" ? quotes.length
                : quotes.filter((q) => q.status === f.key).length;
              return (
                <button
                  key={f.key}
                  type="button"
                  className={`eq-quotes__status-tab${statusFilter === f.key ? " eq-quotes__status-tab--active" : ""}`}
                  onClick={() => setStatusFilter(f.key)}
                >
                  {f.label}
                  {statusFilter === f.key && (
                    <span className="eq-quotes__status-tab-count">{pipelineLoading ? "…" : count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search + totals */}
          <div className="eq-quotes__pipeline-controls">
            <input
              className="eq-quotes__search"
              type="search"
              placeholder="Search by quote #, project, or customer…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
            {!pipelineLoading && quotes.length > 0 && (
              <div className="eq-quotes__totals">
                <span className="eq-quotes__total-item">
                  <span className="eq-quotes__total-label">Showing</span>
                  <span className="eq-quotes__total-val">{aud(visibleTotal)}</span>
                </span>
                {wonTotal > 0 && wonTotal !== visibleTotal && (
                  <span className="eq-quotes__total-item">
                    <span className="eq-quotes__total-label">Won</span>
                    <span className="eq-quotes__total-val eq-quotes__total-val--green">{aud(wonTotal)}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Table */}
          {pipelineLoading ? (
            <div className="eq-quotes__loading">Loading…</div>
          ) : pipelineError ? (
            <div className="eq-quotes__error-banner">{pipelineError}</div>
          ) : displayedQuotes.length === 0 ? (
            <div className="eq-quotes__empty">
              {search ? `No quotes match "${search}".` : "No quotes in this filter."}
            </div>
          ) : (
            <div className="eq-quotes__table-wrap">
              <table className="eq-quotes__table eq-quotes__table--pipeline">
                <thead>
                  <tr>
                    <th>Quote #</th>
                    <th>Customer / Site</th>
                    <th>Project</th>
                    <th>Est.</th>
                    <th className="eq-quotes__th--right">Total</th>
                    <th>Status</th>
                    <th>Job No.</th>
                    <th>Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedQuotes.map((q) => (
                    <tr
                      key={q.quote_id}
                      className="eq-quotes__row eq-quotes__row--clickable"
                      onClick={() => void openDetail(q.quote_id)}
                    >
                      <td className="eq-quotes__td--mono eq-quotes__td--bold">{q.quote_number}</td>
                      <td>
                        <div className="eq-quotes__customer-cell">
                          <span>{q.customer_name ?? "—"}</span>
                          {q.site_code && (
                            <span className="eq-quotes__site-code">{q.site_code}</span>
                          )}
                        </div>
                      </td>
                      <td>{q.project_name ?? <span className="eq-quotes__muted">—</span>}</td>
                      <td>
                        {q.estimator_initials ? (
                          <span className="eq-quotes__initials-badge">{q.estimator_initials}</span>
                        ) : (
                          <span className="eq-quotes__muted">—</span>
                        )}
                      </td>
                      <td className="eq-quotes__td--right eq-quotes__td--bold">{aud(q.total_cents)}</td>
                      <td>
                        <span className={statusClass(q.status)}>
                          {STATUS_LABELS[q.status] ?? q.status}
                        </span>
                      </td>
                      <td>
                        {q.workbench_job_no ? (
                          <span className="eq-quotes__td--mono">{q.workbench_job_no}</span>
                        ) : ACTIVE_JOB_STATUSES.has(q.status) ? (
                          <span className="eq-quotes__badge eq-quotes__badge--amber eq-quotes__badge--xs">Needs no.</span>
                        ) : (
                          <span className="eq-quotes__muted">—</span>
                        )}
                      </td>
                      <td>{fmtDate(q.sent_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Accordion / By Client view */}
      {view === "accordion" && (
        <div className="eq-quotes__accordion">
          {accordionLoading && <div className="eq-quotes__loading">Loading…</div>}
          {accordionError && <div className="eq-quotes__error-banner">{accordionError}</div>}
          {!accordionLoading && !accordionError && (
            <>
              {/* Named client groups */}
              {Object.entries(groupMap).map(([groupId, group]) => {
                const memberNames = new Set(group.members.map((m) => m.customer_name));
                const groupQuotes = accordionQuotes.filter((q) =>
                  q.customer_name && memberNames.has(q.customer_name),
                );
                const groupTotal = groupQuotes.reduce((s, q) => s + q.total_cents, 0);
                const isOpen = expandedGroups.has(group.slug);
                return (
                  <div key={groupId} className="eq-quotes__group">
                    <button
                      type="button"
                      className="eq-quotes__group-header"
                      onClick={() => toggleGroup(group.slug)}
                    >
                      <span className="eq-quotes__group-chevron">{isOpen ? "▾" : "▸"}</span>
                      <span className="eq-quotes__group-name">{group.name}</span>
                      <span className="eq-quotes__group-meta">
                        {groupQuotes.length} quotes · {aud(groupTotal)}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="eq-quotes__group-body">
                        {group.members.map((member) => {
                          const memberQuotes = groupQuotes.filter(
                            (q) => q.customer_name === member.customer_name,
                          );
                          const memberTotal = memberQuotes.reduce((s, q) => s + q.total_cents, 0);
                          return (
                            <div key={member.customer_id} className="eq-quotes__member">
                              <div className="eq-quotes__member-header">
                                <span className="eq-quotes__member-name">{member.customer_name}</span>
                                <span className="eq-quotes__member-meta">
                                  {member.site_codes.join(", ")} · {aud(memberTotal)}
                                </span>
                              </div>
                              {memberQuotes.length === 0 ? (
                                <div className="eq-quotes__member-empty">No quotes.</div>
                              ) : (
                                <div className="eq-quotes__table-wrap">
                                  <table className="eq-quotes__table eq-quotes__table--mini">
                                    <thead>
                                      <tr>
                                        <th>Quote #</th>
                                        <th>Project</th>
                                        <th className="eq-quotes__th--right">Total</th>
                                        <th>Status</th>
                                        <th>PO</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {memberQuotes.map((q) => (
                                        <tr
                                          key={q.quote_id}
                                          className="eq-quotes__row eq-quotes__row--clickable"
                                          onClick={() => void openDetail(q.quote_id)}
                                        >
                                          <td className="eq-quotes__td--mono">{q.quote_number}</td>
                                          <td>{q.project_name ?? <span className="eq-quotes__muted">—</span>}</td>
                                          <td className="eq-quotes__td--right">{aud(q.total_cents)}</td>
                                          <td>
                                            <span className={statusClass(q.status)}>
                                              {STATUS_LABELS[q.status] ?? q.status}
                                            </span>
                                          </td>
                                          <td>
                                            {q.po_number ?? <span className="eq-quotes__muted">—</span>}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Ungrouped customers */}
              {(() => {
                const groupedNames = new Set(
                  clientGroups.map((g) => g.customer_name),
                );
                const ungrouped = Object.entries(quotesByCustomer).filter(
                  ([name]) => !groupedNames.has(name),
                );
                if (ungrouped.length === 0) return null;
                return (
                  <div className="eq-quotes__group">
                    <button
                      type="button"
                      className="eq-quotes__group-header"
                      onClick={() => toggleGroup("_other")}
                    >
                      <span className="eq-quotes__group-chevron">
                        {expandedGroups.has("_other") ? "▾" : "▸"}
                      </span>
                      <span className="eq-quotes__group-name">Other</span>
                      <span className="eq-quotes__group-meta">
                        {ungrouped.reduce((s, [, qs]) => s + qs.length, 0)} quotes
                      </span>
                    </button>
                    {expandedGroups.has("_other") && (
                      <div className="eq-quotes__group-body">
                        {ungrouped.map(([name, qs]) => (
                          <div key={name} className="eq-quotes__member">
                            <div className="eq-quotes__member-header">
                              <span className="eq-quotes__member-name">{name}</span>
                            </div>
                            <div className="eq-quotes__table-wrap">
                              <table className="eq-quotes__table eq-quotes__table--mini">
                                <thead>
                                  <tr>
                                    <th>Quote #</th>
                                    <th>Project</th>
                                    <th className="eq-quotes__th--right">Total</th>
                                    <th>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {qs.map((q) => (
                                    <tr
                                      key={q.quote_id}
                                      className="eq-quotes__row eq-quotes__row--clickable"
                                      onClick={() => void openDetail(q.quote_id)}
                                    >
                                      <td className="eq-quotes__td--mono">{q.quote_number}</td>
                                      <td>{q.project_name ?? <span className="eq-quotes__muted">—</span>}</td>
                                      <td className="eq-quotes__td--right">{aud(q.total_cents)}</td>
                                      <td>
                                        <span className={statusClass(q.status)}>
                                          {STATUS_LABELS[q.status] ?? q.status}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {clientGroups.length === 0 && accordionQuotes.length === 0 && (
                <div className="eq-quotes__empty">No client groups or quotes found.</div>
              )}
            </>
          )}
        </div>
      )}

      {/* Import Coupa PO view */}
      {view === "import" && (
        <div className="eq-quotes__import">
          <div className="eq-quotes__import-intro">
            <p>
              Paste a Coupa PO export CSV or type rows manually. Expected columns:{" "}
              <code>PO Number, Site Code, [Coupa Entity]</code>. Each row is matched
              to the most recent open quote for that site code.
            </p>
          </div>

          <div className="eq-quotes__import-input-area">
            <div className="eq-quotes__import-controls">
              <label className="eq-quotes__label">
                Your initials
                <input
                  className="eq-quotes__input eq-quotes__input--sm"
                  value={importInitials}
                  onChange={(e) => setImportInitials(e.target.value.toUpperCase())}
                  placeholder="RM"
                  maxLength={4}
                />
              </label>
              <label className="eq-quotes__file-btn">
                Upload CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileUpload}
                  className="eq-quotes__file-input"
                />
              </label>
            </div>
            <textarea
              className="eq-quotes__textarea eq-quotes__textarea--csv"
              placeholder={`PO-2024-001, SY2, Equinix Australia\nPO-2024-002, SY6`}
              value={csvText}
              onChange={(e) => handleCsvChange(e.target.value)}
              rows={8}
              spellCheck={false}
            />
            {parseError && <div className="eq-quotes__inline-err">{parseError}</div>}
          </div>

          {parsedRows.length > 0 && (
            <div className="eq-quotes__import-preview">
              <div className="eq-quotes__import-preview-header">
                <span>{parsedRows.length} row{parsedRows.length !== 1 ? "s" : ""} parsed</span>
                <button
                  type="button"
                  className="eq-quotes__btn eq-quotes__btn--primary"
                  disabled={importing}
                  onClick={() => void handleImport()}
                >
                  {importing ? "Importing…" : "Import All"}
                </button>
              </div>
              <div className="eq-quotes__table-wrap">
                <table className="eq-quotes__table">
                  <thead>
                    <tr>
                      <th>PO Number</th>
                      <th>Site Code</th>
                      <th>Coupa Entity</th>
                      {importResults.length > 0 && <th>Result</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, i) => {
                      const result = importResults[i];
                      return (
                        <tr key={i} className="eq-quotes__row">
                          <td className="eq-quotes__td--mono">{row.po_number}</td>
                          <td>
                            <span className="eq-quotes__site-code">{row.site_code}</span>
                          </td>
                          <td>{row.coupa_entity || <span className="eq-quotes__muted">—</span>}</td>
                          {importResults.length > 0 && (
                            <td>
                              {result ? (
                                <span
                                  className={
                                    result.matched
                                      ? "eq-quotes__import-ok"
                                      : "eq-quotes__import-miss"
                                  }
                                >
                                  {result.matched
                                    ? `✓ ${result.quote_number ?? ""}`
                                    : `✗ ${result.message}`}
                                </span>
                              ) : (
                                <span className="eq-quotes__muted">…</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
