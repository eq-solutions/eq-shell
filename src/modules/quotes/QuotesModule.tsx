import React, { useState, useEffect, useCallback, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateQuoteDoc, generateJobExcel } from "./quoteDocGenerator";
import { computeSellRate, computeMarkupPct } from "./quoteMath";
import { QuotesSetup } from "./QuotesSetup";
import { QuotesReports } from "./QuotesReports";
import { QuotesCustomers } from "./QuotesCustomers";
import { captureRpcError } from "./quoteTelemetry";
import { Table, type TableColumn } from "@eq-solutions/ui";

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
  cost_rate_cents: number;
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

interface QuoteAuditEntry {
  audit_id: string;
  action: string;
  changes: Record<string, unknown> | null;
  actor_initials: string | null;
  created_at: string;
}

interface TrashedQuote {
  quote_id: string;
  quote_number: string;
  status: string;
  project_name: string | null;
  estimator_initials: string | null;
  total_cents: number;
  deleted_at: string;
  customer_name: string | null;
}

interface QuoteDetail {
  quote_id: string;
  customer_id: string;
  site_id: string | null;
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
  clarifications: string | null;
  quote_notes: string | null;
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

interface Customer {
  customer_id: string;
  company_name: string;
  external_id: string | null;
}

interface RatePreset {
  preset_id: string;
  category: string | null;
  description: string;
  unit: string | null;
  unit_rate_cents: number;
  qty_thousandths: number;
  sort_order: number;
}

interface Site {
  site_id: string;
  name: string;
  code: string | null;
  customer_id: string | null;
}

interface CreateLineItem {
  description: string;
  qty: string;
  unit: string;
  cost: string;    // buy rate ($/unit)
  markup: string;  // markup % — drives rate auto-calc
  rate: string;    // sell rate ($/unit), auto-computed when cost/markup set
  category: string;
}

interface QuoteTemplate {
  template_id: string;
  template_type: string;
  name: string;
  body: string;
  sort_order: number;
}

interface PricingProduct {
  product_id: string;
  name: string;
  brand: string;
  phase: string;
  plug_type: string;
}

interface CalcLine {
  section: string;
  description: string;
  unit: string;
  qty_thousandths: number;
  unit_rate_cents: number;
  line_total_cents: number;
}

interface CalcResult {
  ok: boolean;
  product_name: string;
  pairs: number;
  discount_factor: number;
  total_cents: number;
  lines: CalcLine[];
}

interface RemovalResult {
  ok: boolean;
  pairs: number;
  total_cents: number;
  line: CalcLine;
}

interface QuotesModuleProps {
  supabase: SupabaseClient | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CAT_ORDER = ["labour", "material", "subcontractor", "one_off", ""] as const;
const CAT_LABELS: Record<string, string> = {
  labour: "Labour",
  material: "Materials",
  subcontractor: "Subcontractors",
  one_off: "One-off",
  "": "Other",
};

// The four fixed line-item sections (matches the Flask quote layout). The quote
// form renders one group per section — the section IS the category, so there is
// no per-row category dropdown. Stored keys stay singular
// (labour/material/subcontractor) to match existing data; one_off is the new one.
const QUOTE_SECTIONS: { value: string; label: string }[] = [
  { value: "labour", label: "Labour" },
  { value: "material", label: "Materials" },
  { value: "subcontractor", label: "Subcontractors" },
  { value: "one_off", label: "One-off" },
];
const SECTION_VALUES = new Set(QUOTE_SECTIONS.map((s) => s.value));

const AUDIT_ACTION_LABELS: Record<string, string> = {
  header: "edited details",
  pricing: "changed pricing",
  duplicate: "duplicated",
};
function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
function fmtAuditCents(n: number): string {
  return "$" + (n / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function summariseAudit(a: QuoteAuditEntry): string {
  const c = a.changes;
  if (!c) return auditActionLabel(a.action);
  if (a.action === "duplicate") {
    const src = c["source_quote_number"];
    return `Copied from ${typeof src === "string" ? src : "another quote"}`;
  }
  if (a.action === "pricing") {
    const t = c["total_cents"] as { old?: number; new?: number } | undefined;
    if (t && typeof t.new === "number") {
      return `Total ${fmtAuditCents(Number(t.old ?? 0))} → ${fmtAuditCents(t.new)}`;
    }
    return "Line items changed";
  }
  return "Changed " + Object.keys(c).map((f) => f.replace(/_/g, " ")).join(", ");
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  "client-reviewing": "Client Reviewing",
  "verbal-win": "Verbal Win",
  "won-awaiting-job-no": "Won — Awaiting Job No.",
  "won-job-created": "Won — Job Created",
  "po-matched": "PO Matched",
  active: "Active",
  complete: "Complete",
  "ready-to-invoice": "Ready to Invoice",
  "on-hold": "On Hold",
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
  { key: "client-reviewing", label: "Client Reviewing" },
  { key: "on-hold", label: "On Hold" },
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
  submitted: ["client-reviewing", "verbal-win", "on-hold", "lost", "cancelled"],
  "client-reviewing": ["verbal-win", "on-hold", "lost", "cancelled"],
  "verbal-win": ["won-awaiting-job-no", "lost"],
  "won-awaiting-job-no": ["won-job-created", "lost"],
  "won-job-created": ["po-matched", "active"],
  "po-matched": ["active"],
  active: ["complete"],
  complete: ["ready-to-invoice"],
  "ready-to-invoice": [],
  "on-hold": ["submitted", "verbal-win", "lost", "cancelled"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcLineTotal(li: CreateLineItem): number {
  const q = parseFloat(li.qty) || 0;
  const r = parseFloat(li.rate) || 0;
  return Math.round(q * r * 100);
}

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

function csvEscape(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function downloadCsv(rows: (string | number | null)[][], filename: string): void {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  if (["submitted", "client-reviewing"].includes(status))
    return "eq-quotes__badge eq-quotes__badge--blue";
  if (status === "on-hold")
    return "eq-quotes__badge eq-quotes__badge--amber";
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
  type ModuleView = "pipeline" | "accordion" | "import" | "create" | "edit" | "setup" | "trash" | "reports" | "customers";

  // ── Main navigation ──────────────────────────────────────────────────────
  const [view, setView] = useState<ModuleView>("pipeline");
  const [detailId, setDetailId] = useState<string | null>(null);

  // ── Pipeline state ────────────────────────────────────────────────────────
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [statusFilter, setStatusFilter] = useState("active-jobs");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [estFilter, setEstFilter] = useState("");
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

  // PO number inline edit
  const [poInput, setPoInput] = useState("");
  const [savingPo, setSavingPo] = useState(false);
  const [poErr, setPoErr] = useState<string | null>(null);

  // Note
  const [noteBody, setNoteBody] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [noteMutErr, setNoteMutErr] = useState<string | null>(null);

  // Email PDF
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailToName, setEmailToName] = useState("");
  const [emailingPdf, setEmailingPdf] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Share link
  const [sharingLink, setSharingLink] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  // ── Accordion state ───────────────────────────────────────────────────────
  const [clientGroups, setClientGroups] = useState<ClientGroup[]>([]);
  const [accordionQuotes, setAccordionQuotes] = useState<Quote[]>([]);
  const [accordionLoading, setAccordionLoading] = useState(false);
  const [accordionError, setAccordionError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["equinix"]));

  // ── Customers + sites + presets + create form state ─────────────────────
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [presets, setPresets] = useState<RatePreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [createCustomerId, setCreateCustomerId] = useState("");
  const [createSiteId, setCreateSiteId] = useState("");
  const [createProjectName, setCreateProjectName] = useState("");
  const [createEstimatorName, setCreateEstimatorName] = useState("");
  const [createEstimatorInitials, setCreateEstimatorInitials] = useState("");
  const [createScope, setCreateScope] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [createAttnName, setCreateAttnName] = useState("");
  const [createAttnFirstName, setCreateAttnFirstName] = useState("");
  const [createAttnPhone, setCreateAttnPhone] = useState("");
  const [createAddress, setCreateAddress] = useState("");
  const [createPaymentTerms, setCreatePaymentTerms] = useState("");
  const [createValidityDays, setCreateValidityDays] = useState("30");
  const [createQuoteNumber, setCreateQuoteNumber] = useState("");
  const [createClarifications, setCreateClarifications] = useState("");
  const [createLineItems, setCreateLineItems] = useState<CreateLineItem[]>([
    { description: "", qty: "1", unit: "", cost: "", markup: "", rate: "", category: "labour" },
  ]);
  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);

  // ── Outlet calculator state ───────────────────────────────────────────────

  const [calcOpen, setCalcOpen] = useState(false);
  const [calcMode, setCalcMode] = useState<"install" | "removal">("install");
  const [calcProducts, setCalcProducts] = useState<PricingProduct[]>([]);
  const [calcProductId, setCalcProductId] = useState("");
  const [calcPairs, setCalcPairs] = useState("1");
  const [calcResult, setCalcResult] = useState<CalcResult | RemovalResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [audit, setAudit] = useState<QuoteAuditEntry[]>([]);
  const [trashed, setTrashed] = useState<TrashedQuote[]>([]);
  const [trashedLoading, setTrashedLoading] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

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

  // Data-fetch effect: loaders setState only after an await, so the synchronous
  // cascading-render case react-hooks/set-state-in-effect targets doesn't apply.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void loadQuotes(statusFilter, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const openDetail = useCallback(
    async (quoteId: string) => {
      if (!supabase) return;
      setDetailId(quoteId);
      setDetail(null);
      setAudit([]);
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
        setPoInput(row.po_number ?? "");
      }
      // Change history (best-effort; never blocks the detail view).
      const { data: auditData } = await supabase.rpc("eq_list_quote_audit", { p_quote_id: quoteId });
      setAudit((auditData as QuoteAuditEntry[]) ?? []);
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

  const loadTrashed = useCallback(async () => {
    if (!supabase) return;
    setTrashedLoading(true);
    const { data, error } = await supabase.rpc("eq_list_trashed_quotes");
    setTrashedLoading(false);
    if (!error) setTrashed((data as TrashedQuote[]) ?? []);
  }, [supabase]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (view === "accordion") void loadAccordion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (view === "trash") void loadTrashed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const loadCustomers = useCallback(async () => {
    if (!supabase) return;
    setCustomersLoading(true);
    const { data, error } = await supabase.rpc("eq_list_customers");
    setCustomersLoading(false);
    if (!error) setCustomers((data as Customer[]) ?? []);
  }, [supabase]);

  const loadSites = useCallback(async (customerId: string) => {
    if (!supabase || !customerId) { setSites([]); return; }
    setSitesLoading(true);
    const { data, error } = await supabase.rpc("eq_list_sites", { p_customer_id: customerId });
    setSitesLoading(false);
    if (!error) setSites((data as Site[]) ?? []);
  }, [supabase]);

  const loadPresets = useCallback(async () => {
    if (!supabase) return;
    setPresetsLoading(true);
    const { data, error } = await supabase.rpc("eq_list_rate_presets");
    setPresetsLoading(false);
    if (!error) setPresets((data as RatePreset[]) ?? []);
  }, [supabase]);

  const loadTemplates = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("eq_list_quote_templates");
    if (!error) setTemplates((data as QuoteTemplate[]) ?? []);
  }, [supabase]);

  const loadCalcProducts = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("eq_list_pricing_products");
    if (!error && data) {
      const prods = data as PricingProduct[];
      setCalcProducts(prods);
      if (prods.length > 0 && !calcProductId) setCalcProductId(prods[0].product_id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const runCalc = async () => {
    if (!supabase) return;
    const pairs = Math.max(1, parseInt(calcPairs, 10) || 1);
    setCalcLoading(true);
    setCalcError(null);
    setCalcResult(null);
    if (calcMode === "install") {
      if (!calcProductId) { setCalcError("Select a product first."); setCalcLoading(false); return; }
      const { data, error } = await supabase.rpc("eq_price_outlet_install", {
        p_product_id: calcProductId,
        p_pairs: pairs,
      });
      setCalcLoading(false);
      if (error) { setCalcError(error.message); return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCalcResult(data as any);
    } else {
      const { data, error } = await supabase.rpc("eq_price_outlet_removal", { p_pairs: pairs });
      setCalcLoading(false);
      if (error) { setCalcError(error.message); return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCalcResult(data as any);
    }
  };

  const addCalcLinesToQuote = () => {
    if (!calcResult) return;
    const lines: CalcLine[] = "lines" in calcResult
      ? calcResult.lines
      : [calcResult.line];
    const newItems: CreateLineItem[] = lines.map((l) => ({
      description: l.description,
      qty: (l.qty_thousandths / 1000).toString(),
      unit: l.unit,
      cost: "",
      markup: "",
      rate: (l.unit_rate_cents / 100).toFixed(2),
      category: l.section === "labour" ? "labour" : "material",
    }));
    setCreateLineItems((prev) => {
      const existing = prev.filter((li) => li.description.trim());
      return [...existing, ...newItems];
    });
    setCalcResult(null);
    setCalcOpen(false);
  };

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (view === "create" || view === "edit") {
      void loadCustomers();
      void loadPresets();
      void loadTemplates();
      void loadCalcProducts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Create form helpers ───────────────────────────────────────────────────

  const resetCreateForm = () => {
    setCreateCustomerId("");
    setCreateSiteId("");
    setSites([]);
    setCreateProjectName("");
    setCreateEstimatorName("");
    setCreateEstimatorInitials("");
    setCreateScope("");
    setCreateNotes("");
    setCreateAttnName("");
    setCreateAttnFirstName("");
    setCreateAttnPhone("");
    setCreateAddress("");
    setCreatePaymentTerms("");
    setCreateValidityDays("30");
    setCreateQuoteNumber("");
    setCreateClarifications("");
    setCreateLineItems([{ description: "", qty: "1", unit: "", cost: "", markup: "", rate: "", category: "labour" }]);
    setCreateError(null);
    setEditingQuoteId(null);
  };

  const openEditForm = useCallback((d: QuoteDetail) => {
    setEditingQuoteId(d.quote_id);
    setDetailId(null);
    setCreateCustomerId(d.customer_id);
    setCreateSiteId(d.site_id ?? "");
    setCreateProjectName(d.project_name ?? "");
    setCreateEstimatorName(d.estimator_name ?? "");
    setCreateEstimatorInitials(d.estimator_initials ?? "");
    setCreateScope(d.scope_of_works ?? "");
    setCreateNotes(d.quote_notes ?? "");
    setCreateAttnName(d.attn_name ?? "");
    setCreateAttnFirstName(d.attn_first_name ?? "");
    setCreateAttnPhone(d.attn_phone ?? "");
    setCreateAddress(d.address ?? "");
    setCreatePaymentTerms(d.payment_terms ?? "");
    setCreateValidityDays(String(d.validity_days ?? 30));
    setCreateQuoteNumber(d.quote_number);
    setCreateClarifications(d.clarifications ?? "");
    setCreateLineItems(
      d.line_items.length > 0
        ? d.line_items.map((li) => {
            const costDollars = li.cost_rate_cents > 0 ? (li.cost_rate_cents / 100).toFixed(2) : "";
            const rateDollars = (li.unit_rate_cents / 100).toFixed(2);
            const markup =
              li.cost_rate_cents > 0 && li.unit_rate_cents > 0
                ? computeMarkupPct(li.cost_rate_cents, li.unit_rate_cents).toFixed(1)
                : "";
            return {
              description: li.description,
              qty: (li.quantity_thousandths / 1000).toString(),
              unit: li.unit ?? "",
              cost: costDollars,
              markup,
              rate: rateDollars,
              category: li.category ?? "",
            };
          })
        : [{ description: "", qty: "1", unit: "", cost: "", markup: "", rate: "", category: "" }],
    );
    setCreateError(null);
    void loadSites(d.customer_id);
    setView("edit");
  }, [loadSites]);

  const updateLineItem = (i: number, field: keyof CreateLineItem, value: string) => {
    setCreateLineItems((prev) => {
      const next = [...prev];
      const updated = { ...next[i], [field]: value };
      if (field === "cost" || field === "markup") {
        const c = parseFloat(field === "cost" ? value : updated.cost);
        const m = parseFloat(field === "markup" ? value : updated.markup);
        const rate = computeSellRate(c, m);
        if (!isNaN(rate)) updated.rate = rate.toFixed(2);
      }
      next[i] = updated;
      return next;
    });
  };

  const addLineItem = (category = "labour") => {
    setCreateLineItems((prev) => [...prev, { description: "", qty: "1", unit: "", cost: "", markup: "", rate: "", category }]);
  };

  const applyPreset = (preset: RatePreset) => {
    const item: CreateLineItem = {
      description: preset.description,
      qty: (preset.qty_thousandths / 1000).toString(),
      unit: preset.unit ?? "",
      cost: "",
      markup: "",
      rate: (preset.unit_rate_cents / 100).toString(),
      category: preset.category ?? "",
    };
    setCreateLineItems((prev) => {
      if (prev.length === 1 && !prev[0].description.trim() && !prev[0].rate.trim()) {
        return [item];
      }
      return [...prev, item];
    });
  };

  const removeLineItem = (i: number) => {
    setCreateLineItems((prev) => prev.filter((_, j) => j !== i));
  };

  const handleCreateQuote = async () => {
    if (!supabase || !createCustomerId) return;
    const validLines = createLineItems.filter((li) => li.description.trim());
    if (validLines.length === 0) {
      setCreateError("Add at least one line item with a description.");
      return;
    }
    setCreating(true);
    setCreateError(null);

    const { data, error } = await supabase.rpc("eq_create_quote", {
      p_customer_id: createCustomerId,
      p_site_id: createSiteId || null,
      p_project_name: createProjectName.trim() || null,
      p_estimator_name: createEstimatorName.trim() || null,
      p_estimator_initials: createEstimatorInitials.trim() || null,
      p_scope_of_works: createScope.trim() || null,
      p_notes: createNotes.trim() || null,
      p_validity_days: parseInt(createValidityDays, 10) || 30,
      p_attn_name: createAttnName.trim() || null,
      p_attn_first_name: createAttnFirstName.trim() || null,
      p_attn_phone: createAttnPhone.trim() || null,
      p_address: createAddress.trim() || null,
      p_payment_terms: createPaymentTerms.trim() || null,
      p_clarifications: createClarifications.trim() || null,
    });

    if (error) { captureRpcError("eq_create_quote", error, { customer_id: createCustomerId }); setCreateError(error.message); setCreating(false); return; }
    const row = (data as Array<{ quote_id: string; quote_number: string }>)[0];
    if (!row) { setCreateError("No quote returned."); setCreating(false); return; }

    // Set line items via the same rollup path as edit, so subtotal/gst/total/margin
    // are computed once, server-side, on create too (no $0/null-margin-until-edit gap).
    const lineItemsJson = validLines.map((li, idx) => ({
      line_number: idx + 1,
      description: li.description.trim(),
      qty_thousandths: Math.round(Math.max(0, parseFloat(li.qty) || 1) * 1000),
      unit_rate_cents: Math.round(Math.max(0, parseFloat(li.rate) || 0) * 100),
      cost_rate_cents: Math.round(Math.max(0, parseFloat(li.cost) || 0) * 100),
      unit: li.unit.trim() || null,
      category: li.category.trim() || null,
    }));

    const { error: itemsErr } = await supabase.rpc("eq_replace_line_items", {
      p_quote_id: row.quote_id,
      p_line_items: lineItemsJson,
    });
    if (itemsErr) { captureRpcError("eq_replace_line_items", itemsErr, { quote_id: row.quote_id, op: "create" }); setCreateError(itemsErr.message); setCreating(false); return; }

    // Audit: record creation on the quote timeline (best-effort, non-blocking).
    await supabase.rpc("eq_add_quote_note", {
      p_quote_id: row.quote_id,
      p_body: "Quote created",
      p_note_type: "system",
      p_initials: createEstimatorInitials.trim() || null,
    });

    setCreating(false);
    resetCreateForm();
    void loadQuotes(statusFilter, search);
    void openDetail(row.quote_id);
  };

  const handleEditQuote = async () => {
    if (!supabase || !editingQuoteId || !createCustomerId) return;
    const validLines = createLineItems.filter((li) => li.description.trim());
    if (validLines.length === 0) {
      setCreateError("Add at least one line item with a description.");
      return;
    }
    setCreating(true);
    setCreateError(null);

    const { error: headerErr } = await supabase.rpc("eq_update_quote", {
      p_quote_id: editingQuoteId,
      p_customer_id: createCustomerId,
      p_site_id: createSiteId || null,
      p_project_name: createProjectName.trim() || null,
      p_estimator_name: createEstimatorName.trim() || null,
      p_estimator_initials: createEstimatorInitials.trim() || null,
      p_scope_of_works: createScope.trim() || null,
      p_notes: createNotes.trim() || null,
      p_validity_days: parseInt(createValidityDays, 10) || 30,
      p_attn_name: createAttnName.trim() || null,
      p_attn_first_name: createAttnFirstName.trim() || null,
      p_attn_phone: createAttnPhone.trim() || null,
      p_address: createAddress.trim() || null,
      p_payment_terms: createPaymentTerms.trim() || null,
      p_clarifications: createClarifications.trim() || null,
      p_quote_number: createQuoteNumber.trim() || null,
    });

    if (headerErr) { captureRpcError("eq_update_quote", headerErr, { quote_id: editingQuoteId }); setCreateError(headerErr.message); setCreating(false); return; }

    const lineItemsJson = validLines.map((li, idx) => ({
      line_number: idx + 1,
      description: li.description.trim(),
      qty_thousandths: Math.round(Math.max(0, parseFloat(li.qty) || 1) * 1000),
      unit_rate_cents: Math.round(Math.max(0, parseFloat(li.rate) || 0) * 100),
      cost_rate_cents: Math.round(Math.max(0, parseFloat(li.cost) || 0) * 100),
      unit: li.unit.trim() || null,
      category: li.category.trim() || null,
    }));

    const { error: itemsErr } = await supabase.rpc("eq_replace_line_items", {
      p_quote_id: editingQuoteId,
      p_line_items: lineItemsJson,
    });

    if (itemsErr) { captureRpcError("eq_replace_line_items", itemsErr, { quote_id: editingQuoteId, op: "edit" }); setCreateError(itemsErr.message); setCreating(false); return; }

    const savedQuoteId = editingQuoteId;
    setCreating(false);
    resetCreateForm();
    setView("pipeline");
    void loadQuotes(statusFilter, search);
    void openDetail(savedQuoteId);
  };

  const handleDuplicate = async (quoteId: string) => {
    if (!supabase) return;
    setDuplicating(true);
    const { data, error } = await supabase.rpc("eq_duplicate_quote", { p_source_quote_id: quoteId });
    setDuplicating(false);
    if (error) {
      captureRpcError("eq_duplicate_quote", error, { quote_id: quoteId });
      setDetailError(error.message);
      return;
    }
    const row = (data as Array<{ quote_id: string; quote_number: string }>)[0];
    if (!row) { setDetailError("Duplicate failed: no quote returned."); return; }
    void loadQuotes(statusFilter, search);
    void openDetail(row.quote_id);
  };

  const handleTrash = async (quoteId: string) => {
    if (!supabase) return;
    setTrashing(true);
    const { error } = await supabase.rpc("eq_trash_quote", { p_quote_id: quoteId });
    setTrashing(false);
    if (error) { captureRpcError("eq_trash_quote", error, { quote_id: quoteId }); setDetailError(error.message); return; }
    setDetailId(null);
    setDetail(null);
    void loadQuotes(statusFilter, search);
  };

  const handleRestore = async (quoteId: string) => {
    if (!supabase) return;
    const { error } = await supabase.rpc("eq_restore_quote", { p_quote_id: quoteId });
    if (error) { captureRpcError("eq_restore_quote", error, { quote_id: quoteId }); return; }
    void loadTrashed();
    void loadQuotes(statusFilter, search);
  };

  const handleBulkStatus = async () => {
    if (!supabase || !bulkStatus || selectedIds.size === 0) return;
    setBulkBusy(true);
    const { error } = await supabase.rpc("eq_bulk_update_quote_status", {
      p_quote_ids: Array.from(selectedIds),
      p_new_status: bulkStatus,
      p_initials: initials.trim() || null,
    });
    setBulkBusy(false);
    if (error) { captureRpcError("eq_bulk_update_quote_status", error, { count: selectedIds.size }); setPipelineError(error.message); return; }
    setSelectedIds(new Set());
    setBulkStatus("");
    void loadQuotes(statusFilter, search);
  };

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
    if (error) { captureRpcError("eq_update_quote_status", error, { quote_id: detail.quote_id, new_status: advanceStatus }); setStatusMutErr(error.message); return; }
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
    if (error) { captureRpcError("eq_add_quote_note", error, { quote_id: detail.quote_id }); setNoteMutErr(error.message); return; }
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
    if (error) { captureRpcError("eq_set_workbench_job_no", error, { quote_id: detail.quote_id }); setJobNoErr(error.message); return; }
    await openDetail(detail.quote_id);
    void loadQuotes(statusFilter, search);
  };

  const handleSavePoNumber = async () => {
    if (!supabase || !detail || !poInput.trim()) return;
    setSavingPo(true);
    setPoErr(null);
    const { error } = await supabase.rpc("eq_set_po_number", {
      p_quote_id: detail.quote_id,
      p_po_number: poInput.trim(),
      p_initials: initials.trim() || null,
    });
    setSavingPo(false);
    if (error) { captureRpcError("eq_set_po_number", error, { quote_id: detail.quote_id }); setPoErr(error.message); return; }
    await openDetail(detail.quote_id);
  };

  const handleGenerateDoc = async () => {
    if (!supabase || !detail) return;
    await generateQuoteDoc(detail);
    // Audit: record the document generation on the quote timeline.
    await supabase.rpc("eq_add_quote_note", {
      p_quote_id: detail.quote_id,
      p_body: "Quote document generated",
      p_note_type: "system",
      p_initials: initials.trim() || null,
    });
    await openDetail(detail.quote_id);
  };

  const handleEmailPdf = async () => {
    if (!supabase || !detail || !emailTo.trim()) return;
    setEmailingPdf(true);
    setEmailMsg(null);
    try {
      const res = await fetch("/.netlify/functions/quote-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_id: detail.quote_id, to_email: emailTo.trim(), to_name: emailToName.trim() || undefined }),
        credentials: "include",
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        setEmailMsg({ ok: true, text: `Sent to ${emailTo.trim()}.` });
        setEmailTo("");
        setEmailToName("");
        setShowEmailForm(false);
        await openDetail(detail.quote_id);
      } else {
        setEmailMsg({ ok: false, text: json.error === "email_not_configured" ? "Email not configured on this deployment." : `Send failed: ${json.error ?? "unknown error"}` });
      }
    } catch {
      setEmailMsg({ ok: false, text: "Network error." });
    }
    setEmailingPdf(false);
  };

  const handleShareLink = async () => {
    if (!supabase || !detail || sharingLink) return;
    setSharingLink(true);
    setShareMsg(null);
    const { data, error } = await supabase.rpc("eq_create_share_link", { p_quote_id: detail.quote_id });
    if (error || !data) {
      setSharingLink(false);
      setShareMsg("Could not create share link.");
      return;
    }
    const token = (data as { token: string }).token;
    const tenantSlug = window.location.pathname.split("/").filter(Boolean)[0] ?? "sks";
    const url = `${window.location.origin}/portal/quote/${tenantSlug}/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareMsg("Link copied to clipboard.");
    } catch {
      setShareMsg(`Link: ${url}`);
    }
    setSharingLink(false);
    setTimeout(() => setShareMsg(null), 5000);
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

  let displayedQuotes = statusFilter === "active-jobs"
    ? quotes.filter((q) => ACTIVE_JOB_STATUSES.has(q.status))
    : quotes;
  if (dateFrom) displayedQuotes = displayedQuotes.filter((q) => q.created_at >= dateFrom);
  if (dateTo)   displayedQuotes = displayedQuotes.filter((q) => q.created_at.slice(0, 10) <= dateTo);
  if (estFilter) displayedQuotes = displayedQuotes.filter((q) => q.estimator_initials === estFilter);
  const estimatorOptions = Array.from(
    new Set(quotes.map((q) => q.estimator_initials).filter((i): i is string => i !== null && i !== ""))
  ).sort();
  const visibleTotal = displayedQuotes.reduce((s, q) => s + q.total_cents, 0);
  const wonTotal = displayedQuotes
    .filter((q) => ACTIVE_JOB_STATUSES.has(q.status))
    .reduce((s, q) => s + q.total_cents, 0);

  // Canonical eq-ui table: sortable columns + per-column text/select filters.
  const pipelineColumns: TableColumn<Quote>[] = [
    {
      key: "quote_number", header: "Quote #",
      sortAccessor: (q) => q.quote_number,
      className: "eq-quotes__td--mono eq-quotes__td--bold",
    },
    {
      key: "customer_name", header: "Customer / Site", filterable: "text",
      sortAccessor: (q) => q.customer_name ?? "",
      render: (q) => (
        <div className="eq-quotes__customer-cell">
          <span>{q.customer_name ?? "—"}</span>
          {q.site_code && <span className="eq-quotes__site-code">{q.site_code}</span>}
        </div>
      ),
    },
    {
      key: "project_name", header: "Project", filterable: "text",
      sortAccessor: (q) => q.project_name ?? "",
      render: (q) => q.project_name ?? <span className="eq-quotes__muted">—</span>,
    },
    {
      key: "estimator_initials", header: "Est.",
      sortAccessor: (q) => q.estimator_initials ?? "",
      render: (q) => q.estimator_initials
        ? <span className="eq-quotes__initials-badge">{q.estimator_initials}</span>
        : <span className="eq-quotes__muted">—</span>,
    },
    {
      key: "total_cents", header: "Total", align: "right",
      sortAccessor: (q) => q.total_cents,
      render: (q) => <span className="eq-quotes__td--bold">{aud(q.total_cents)}</span>,
    },
    {
      key: "status", header: "Status", filterable: "select",
      filterOptions: STATUS_FILTERS
        .filter((f) => f.key !== "active-jobs" && f.key !== "all")
        .map((f) => ({ value: f.key, label: f.label })),
      sortAccessor: (q) => STATUS_LABELS[q.status] ?? q.status,
      render: (q) => <span className={statusClass(q.status)}>{STATUS_LABELS[q.status] ?? q.status}</span>,
    },
    {
      key: "workbench_job_no", header: "Job No.",
      sortAccessor: (q) => q.workbench_job_no ?? "",
      render: (q) => q.workbench_job_no
        ? <span className="eq-quotes__td--mono">{q.workbench_job_no}</span>
        : ACTIVE_JOB_STATUSES.has(q.status)
          ? <span className="eq-quotes__badge eq-quotes__badge--amber eq-quotes__badge--xs">Needs no.</span>
          : <span className="eq-quotes__muted">—</span>,
    },
    {
      key: "sent_at", header: "Sent",
      sortAccessor: (q) => q.sent_at ?? "",
      render: (q) => fmtDate(q.sent_at),
    },
  ];

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
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                style={{ marginLeft: "auto" }}
                onClick={() => openEditForm(detail)}
              >
                Edit
              </button>
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                disabled={duplicating}
                onClick={() => void handleDuplicate(detail.quote_id)}
                title="Create a draft copy of this quote"
              >
                {duplicating ? "Duplicating…" : "Duplicate"}
              </button>
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                onClick={() => void handleGenerateDoc()}
              >
                Download Quote
              </button>
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                onClick={() => { setShowEmailForm((v) => !v); setEmailMsg(null); }}
              >
                Email PDF
              </button>
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                disabled={sharingLink}
                onClick={() => void handleShareLink()}
                title="Create a shareable portal link for this quote"
              >
                {sharingLink ? "…" : "Share"}
              </button>
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                onClick={() => void generateJobExcel(detail.quote_id)}
              >
                Create Job
              </button>
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                disabled={trashing}
                onClick={() => void handleTrash(detail.quote_id)}
                title="Move this quote to Trash"
                style={{ color: "var(--eq-err, #c0392b)" }}
              >
                {trashing ? "…" : "Trash"}
              </button>
            </div>
          )}
          {/* Email PDF inline form */}
          {showEmailForm && detail && (
            <div className="eq-quotes__detail-card" style={{ marginTop: 8, padding: "12px 16px" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <label className="eq-quotes__info-label">To name</label>
                  <input className="eq-quotes__input" style={{ width: 160 }} value={emailToName} onChange={(e) => setEmailToName(e.target.value)} placeholder="Contact name" />
                </div>
                <div>
                  <label className="eq-quotes__info-label">Email address</label>
                  <input className="eq-quotes__input" style={{ width: 220 }} type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="client@example.com" />
                </div>
                <button type="button" className="eq-quotes__btn eq-quotes__btn--primary" disabled={emailingPdf || !emailTo.trim()} onClick={() => void handleEmailPdf()}>
                  {emailingPdf ? "Sending…" : "Send"}
                </button>
                <button type="button" className="eq-quotes__btn eq-quotes__btn--outline" onClick={() => { setShowEmailForm(false); setEmailMsg(null); }}>Cancel</button>
              </div>
              {emailMsg && (
                <div style={{ marginTop: 6, fontSize: 12, color: emailMsg.ok ? "var(--eq-sky, #2986B4)" : "var(--eq-err, #c0392b)" }}>{emailMsg.text}</div>
              )}
            </div>
          )}
          {/* Share link feedback */}
          {shareMsg && (
            <div style={{ marginTop: 4, fontSize: 12, color: "var(--eq-sky, #2986B4)" }}>{shareMsg}</div>
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
                {detail.attn_name && (
                  <div className="eq-quotes__info-item">
                    <span className="eq-quotes__info-label">Attention</span>
                    <span className="eq-quotes__info-val">{detail.attn_name}</span>
                  </div>
                )}
                {detail.attn_phone && (
                  <div className="eq-quotes__info-item">
                    <span className="eq-quotes__info-label">Phone</span>
                    <span className="eq-quotes__info-val">{detail.attn_phone}</span>
                  </div>
                )}
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
                <div className="eq-quotes__info-item eq-quotes__info-item--full">
                  <span className="eq-quotes__info-label">PO Number</span>
                  <div className="eq-quotes__job-no-row">
                    <input
                      className="eq-quotes__input eq-quotes__input--job-no"
                      value={poInput}
                      onChange={(e) => setPoInput(e.target.value)}
                      placeholder={detail.po_number || "—"}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleSavePoNumber(); }}
                    />
                    <button
                      type="button"
                      className="eq-quotes__btn eq-quotes__btn--primary"
                      disabled={savingPo || poInput.trim() === (detail.po_number ?? "")}
                      onClick={() => void handleSavePoNumber()}
                    >
                      {savingPo ? "Saving…" : "Save"}
                    </button>
                  </div>
                  {poErr && <div className="eq-quotes__inline-err">{poErr}</div>}
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
                {detail.address && (
                  <div className="eq-quotes__info-item eq-quotes__info-item--full">
                    <span className="eq-quotes__info-label">Address</span>
                    <span className="eq-quotes__info-val">{detail.address}</span>
                  </div>
                )}
                {detail.loss_reason && (
                  <div className="eq-quotes__info-item eq-quotes__info-item--full">
                    <span className="eq-quotes__info-label">Loss Reason</span>
                    <span className="eq-quotes__info-val" style={{ color: "var(--eq-err)" }}>
                      {detail.loss_reason}
                    </span>
                  </div>
                )}
              </div>

              {detail.scope_of_works && (
                <div className="eq-quotes__scope">
                  <span className="eq-quotes__info-label">Scope of Works</span>
                  <p className="eq-quotes__scope-text">{detail.scope_of_works}</p>
                </div>
              )}

              {detail.clarifications && (
                <div className="eq-quotes__scope">
                  <span className="eq-quotes__info-label">Clarifications</span>
                  <p className="eq-quotes__scope-text">{detail.clarifications}</p>
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

            {/* Line items — grouped by category */}
            {detail.line_items.length > 0 && (
              <div className="eq-quotes__detail-card">
                <h3 className="eq-quotes__section-title">Line Items</h3>
                <div className="eq-quotes__table-wrap">
                  <table className="eq-quotes__table">
                    <thead>
                      <tr>
                        <th style={{ width: 32 }}>#</th>
                        <th>Description</th>
                        <th className="eq-quotes__th--right" style={{ width: 60 }}>Qty</th>
                        <th style={{ width: 48 }}>Unit</th>
                        <th className="eq-quotes__th--right" style={{ width: 100 }}>Rate</th>
                        <th className="eq-quotes__th--right" style={{ width: 110 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CAT_ORDER.map((cat) => {
                        const items = detail.line_items.filter(
                          (li) => (li.category ?? "") === cat,
                        );
                        if (items.length === 0) return null;
                        const catTotal = items.reduce((s, li) => s + li.line_total_cents, 0);
                        return (
                          <React.Fragment key={cat || "_other"}>
                            <tr className="eq-quotes__row--group-header">
                              <td colSpan={6} className="eq-quotes__group-label">
                                {CAT_LABELS[cat] ?? cat}
                              </td>
                            </tr>
                            {items.map((li) => (
                              <tr key={li.line_number}>
                                <td className="eq-quotes__td--mono">{li.line_number}</td>
                                <td>{li.description}</td>
                                <td className="eq-quotes__td--right">{qty(li.quantity_thousandths)}</td>
                                <td>{li.unit ?? <span className="eq-quotes__muted">—</span>}</td>
                                <td className="eq-quotes__td--right">{aud(li.unit_rate_cents)}</td>
                                <td className="eq-quotes__td--right eq-quotes__td--bold">{aud(li.line_total_cents)}</td>
                              </tr>
                            ))}
                            <tr className="eq-quotes__row--cat-subtotal">
                              <td colSpan={5} className="eq-quotes__td--right">
                                <span className="eq-quotes__muted" style={{ fontSize: 12 }}>
                                  {CAT_LABELS[cat] ?? cat} subtotal
                                </span>
                              </td>
                              <td className="eq-quotes__td--right eq-quotes__td--bold">{aud(catTotal)}</td>
                            </tr>
                          </React.Fragment>
                        );
                      })}
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
                    placeholder={advanceStatus === "lost" ? "Loss reason…" : "Optional note…"}
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
                    <div
                      key={n.note_id}
                      className={`eq-quotes__note${n.note_type === "status-change" ? " eq-quotes__note--status" : ""}`}
                    >
                      <div className="eq-quotes__note-meta">
                        {n.initials && (
                          <span className="eq-quotes__initials-badge">{n.initials}</span>
                        )}
                        <span className="eq-quotes__note-type">
                          {n.note_type === "status-change" ? "status" : n.note_type}
                        </span>
                        <span className="eq-quotes__note-date">{fmtDate(n.created_at)}</span>
                      </div>
                      <p className="eq-quotes__note-body">{n.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Change history — structured audit (who changed what, when) */}
            {audit.length > 0 && (
              <div className="eq-quotes__detail-card">
                <h3 className="eq-quotes__section-title">Change History</h3>
                <div className="eq-quotes__notes-list">
                  {audit.map((a) => (
                    <div key={a.audit_id} className="eq-quotes__note">
                      <div className="eq-quotes__note-meta">
                        {a.actor_initials && (
                          <span className="eq-quotes__initials-badge">{a.actor_initials}</span>
                        )}
                        <span className="eq-quotes__note-type">{auditActionLabel(a.action)}</span>
                        <span className="eq-quotes__note-date">{fmtDate(a.created_at)}</span>
                      </div>
                      <p className="eq-quotes__note-body">{summariseAudit(a)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Computed create totals ────────────────────────────────────────────────

  const createSubtotal = createLineItems.reduce((s, li) => s + calcLineTotal(li), 0);
  const createGst = Math.round(createSubtotal / 10);
  const createTotal = createSubtotal + createGst;

  // One editable line-item row, rendered inside each section group. Uses the flat
  // index `i` so updateLineItem/removeLineItem keep working unchanged.
  const renderLineRow = (li: CreateLineItem, i: number) => (
    <tr key={i} className="eq-quotes__row">
      <td>
        <input className="eq-quotes__input" style={{ width: "100%", padding: "5px 8px", fontSize: 13 }}
          value={li.description} onChange={(e) => updateLineItem(i, "description", e.target.value)} placeholder="Description…" />
      </td>
      <td>
        <input className="eq-quotes__input" style={{ width: 68, padding: "5px 8px", fontSize: 13, textAlign: "right" }}
          type="number" min="0" step="0.001" value={li.qty} onChange={(e) => updateLineItem(i, "qty", e.target.value)} />
      </td>
      <td>
        <input className="eq-quotes__input" style={{ width: 44, padding: "5px 6px", fontSize: 13 }}
          value={li.unit} onChange={(e) => updateLineItem(i, "unit", e.target.value)} placeholder="ea" />
      </td>
      <td>
        <input className="eq-quotes__input" style={{ width: 76, padding: "5px 8px", fontSize: 13, textAlign: "right" }}
          type="number" min="0" step="0.01" value={li.cost} onChange={(e) => updateLineItem(i, "cost", e.target.value)} placeholder="0.00" />
      </td>
      <td>
        <input className="eq-quotes__input" style={{ width: 60, padding: "5px 8px", fontSize: 13, textAlign: "right" }}
          type="number" min="0" step="0.5" value={li.markup} onChange={(e) => updateLineItem(i, "markup", e.target.value)}
          placeholder="0" title="Markup %. Rate auto-computes from Cost × (1 + Markup/100)" />
      </td>
      <td>
        <input className="eq-quotes__input"
          style={{ width: 84, padding: "5px 8px", fontSize: 13, textAlign: "right", background: li.cost ? "var(--eq-surface-2, var(--eq-surface))" : undefined }}
          type="number" min="0" step="0.01" value={li.rate} onChange={(e) => updateLineItem(i, "rate", e.target.value)}
          placeholder="0.00" title={li.cost ? "Auto-computed from Cost × (1 + Markup%)" : "Enter sell rate"} />
      </td>
      <td className="eq-quotes__td--right eq-quotes__td--bold">
        {calcLineTotal(li) > 0 ? aud(calcLineTotal(li)) : <span className="eq-quotes__muted">—</span>}
      </td>
      <td>
        <button type="button"
          style={{ background: "none", border: "none", color: "var(--eq-muted)", cursor: "pointer", fontSize: 18, padding: "2px 6px", lineHeight: 1 }}
          onClick={() => removeLineItem(i)} title="Remove row" aria-label="Remove line item">×</button>
      </td>
    </tr>
  );

  // ── Render: create view ───────────────────────────────────────────────────

  if (view === "create" || view === "edit") {
    const isEditMode = view === "edit";
    const handleCancelCreateEdit = () => {
      const savedId = editingQuoteId;
      resetCreateForm();
      setView("pipeline");
      if (savedId) void openDetail(savedId);
    };
    return (
      <div className="eq-quotes">
        <div className="eq-quotes__detail-header">
          <button
            type="button"
            className="eq-quotes__back"
            onClick={handleCancelCreateEdit}
          >
            ← EQ Ops
          </button>
          <div className="eq-quotes__detail-title-row">
            <h2 className="eq-quotes__detail-num" style={{ fontFamily: "inherit", fontSize: 20 }}>
              {isEditMode ? "Edit Quote" : "New Quote"}
            </h2>
          </div>
        </div>

        <div className="eq-quotes__detail-body">
          {/* Quote details */}
          <div className="eq-quotes__detail-card">
            <h3 className="eq-quotes__section-title">Quote Details</h3>
            <div className="eq-quotes__info-grid">
              {isEditMode && (
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">Quote Number</span>
                  <input
                    className="eq-quotes__input eq-quotes__td--mono"
                    style={{ maxWidth: 220 }}
                    value={createQuoteNumber}
                    onChange={(e) => setCreateQuoteNumber(e.target.value)}
                    placeholder="EQ-YYMMDD-NNNN"
                  />
                </div>
              )}
              <div className="eq-quotes__info-item eq-quotes__info-item--full">
                <span className="eq-quotes__info-label">
                  Customer <span style={{ color: "var(--eq-err)", fontWeight: 700 }}>*</span>
                </span>
                {customersLoading ? (
                  <span className="eq-quotes__muted" style={{ fontSize: 14 }}>Loading…</span>
                ) : (
                  <select
                    className="eq-quotes__select"
                    style={{ maxWidth: 440 }}
                    value={createCustomerId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setCreateCustomerId(id);
                      setCreateSiteId("");
                      void loadSites(id);
                    }}
                  >
                    <option value="">Select a customer…</option>
                    {customers.map((c) => (
                      <option key={c.customer_id} value={c.customer_id}>
                        {c.company_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="eq-quotes__info-item eq-quotes__info-item--full">
                <span className="eq-quotes__info-label">Site</span>
                {sitesLoading ? (
                  <span className="eq-quotes__muted" style={{ fontSize: 14 }}>Loading…</span>
                ) : (
                  <select
                    className="eq-quotes__select"
                    style={{ maxWidth: 440 }}
                    value={createSiteId}
                    onChange={(e) => setCreateSiteId(e.target.value)}
                    disabled={!createCustomerId}
                  >
                    <option value="">
                      {createCustomerId ? (sites.length === 0 ? "No sites for this customer" : "Select a site (optional)…") : "Select a customer first"}
                    </option>
                    {sites.map((s) => (
                      <option key={s.site_id} value={s.site_id}>
                        {s.name}{s.code ? ` [${s.code}]` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="eq-quotes__info-item eq-quotes__info-item--full">
                <span className="eq-quotes__info-label">Project Name</span>
                <input
                  className="eq-quotes__input"
                  style={{ maxWidth: 440 }}
                  value={createProjectName}
                  onChange={(e) => setCreateProjectName(e.target.value)}
                  placeholder="e.g. Equinix SY2 — UPS Replacement"
                />
              </div>
              <div className="eq-quotes__info-item">
                <span className="eq-quotes__info-label">Estimator Name</span>
                <input
                  className="eq-quotes__input"
                  value={createEstimatorName}
                  onChange={(e) => setCreateEstimatorName(e.target.value)}
                  placeholder="e.g. Royce Milmlow"
                />
              </div>
              <div className="eq-quotes__info-item">
                <span className="eq-quotes__info-label">Initials</span>
                <input
                  className="eq-quotes__input eq-quotes__input--sm"
                  value={createEstimatorInitials}
                  onChange={(e) => setCreateEstimatorInitials(e.target.value.toUpperCase())}
                  placeholder="RM"
                  maxLength={4}
                />
              </div>
              <div className="eq-quotes__info-item eq-quotes__info-item--full">
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span className="eq-quotes__info-label" style={{ marginBottom: 0 }}>Scope of Works</span>
                  {templates.filter((t) => t.template_type === "scope").length > 0 && (
                    <select
                      className="eq-quotes__select"
                      style={{ fontSize: 11, padding: "2px 6px", height: 24 }}
                      value=""
                      onChange={(e) => {
                        const tpl = templates.find((t) => t.template_id === e.target.value);
                        if (tpl) setCreateScope((prev) => prev ? prev + "\n\n" + tpl.body : tpl.body);
                      }}
                    >
                      <option value="">Insert template…</option>
                      {templates.filter((t) => t.template_type === "scope").map((t) => (
                        <option key={t.template_id} value={t.template_id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <textarea
                  className="eq-quotes__textarea"
                  style={{ maxWidth: 560, minHeight: 72 }}
                  value={createScope}
                  onChange={(e) => setCreateScope(e.target.value)}
                  placeholder="Describe the scope of works…"
                  rows={3}
                />
              </div>
              <div className="eq-quotes__info-item eq-quotes__info-item--full">
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span className="eq-quotes__info-label" style={{ marginBottom: 0 }}>Clarifications</span>
                  {templates.filter((t) => t.template_type === "clarification").length > 0 && (
                    <select
                      className="eq-quotes__select"
                      style={{ fontSize: 11, padding: "2px 6px", height: 24 }}
                      value=""
                      onChange={(e) => {
                        const tpl = templates.find((t) => t.template_id === e.target.value);
                        if (tpl) setCreateClarifications((prev) => prev ? prev + "\n\n" + tpl.body : tpl.body);
                      }}
                    >
                      <option value="">Insert template…</option>
                      {templates.filter((t) => t.template_type === "clarification").map((t) => (
                        <option key={t.template_id} value={t.template_id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <textarea
                  className="eq-quotes__textarea"
                  style={{ maxWidth: 560, minHeight: 72 }}
                  value={createClarifications}
                  onChange={(e) => setCreateClarifications(e.target.value)}
                  placeholder="Clarifications, exclusions, and conditions…"
                  rows={3}
                />
              </div>
              <div className="eq-quotes__info-item eq-quotes__info-item--full">
                <span className="eq-quotes__info-label">
                  Notes{" "}
                  <span className="eq-quotes__muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 11 }}>
                    (internal)
                  </span>
                </span>
                <textarea
                  className="eq-quotes__textarea"
                  style={{ maxWidth: 560 }}
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  placeholder="Internal notes…"
                  rows={2}
                />
              </div>
            </div>

            {/* Contact / address — for the quote document */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--eq-border)" }}>
              <span style={{
                display: "block", marginBottom: 10, fontSize: 11,
                textTransform: "uppercase", letterSpacing: "0.06em",
                color: "var(--eq-muted)", fontWeight: 600,
              }}>
                Contact &amp; Address
              </span>
              <div className="eq-quotes__info-grid">
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">First Name</span>
                  <input
                    className="eq-quotes__input"
                    value={createAttnFirstName}
                    onChange={(e) => setCreateAttnFirstName(e.target.value)}
                    placeholder="e.g. Jacob"
                  />
                </div>
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">Last Name</span>
                  <input
                    className="eq-quotes__input"
                    value={createAttnName}
                    onChange={(e) => setCreateAttnName(e.target.value)}
                    placeholder="e.g. Brennan"
                  />
                </div>
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">Phone</span>
                  <input
                    className="eq-quotes__input"
                    value={createAttnPhone}
                    onChange={(e) => setCreateAttnPhone(e.target.value)}
                    placeholder="e.g. 02 9999 0000"
                  />
                </div>
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">Payment Terms</span>
                  <input
                    className="eq-quotes__input"
                    value={createPaymentTerms}
                    onChange={(e) => setCreatePaymentTerms(e.target.value)}
                    placeholder="e.g. 30 days net"
                  />
                </div>
                <div className="eq-quotes__info-item eq-quotes__info-item--full">
                  <span className="eq-quotes__info-label">Address</span>
                  <input
                    className="eq-quotes__input"
                    style={{ maxWidth: 440 }}
                    value={createAddress}
                    onChange={(e) => setCreateAddress(e.target.value)}
                    placeholder="e.g. Herbert St, St Leonards NSW 2065"
                  />
                </div>
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">Validity (days)</span>
                  <input
                    className="eq-quotes__input eq-quotes__input--sm"
                    type="number"
                    min="1"
                    max="365"
                    style={{ width: 80 }}
                    value={createValidityDays}
                    onChange={(e) => setCreateValidityDays(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="eq-quotes__detail-card">
            <h3 className="eq-quotes__section-title">Line Items</h3>
            <div className="eq-quotes__table-wrap">
              <table className="eq-quotes__table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th style={{ width: 70 }}>Qty</th>
                    <th style={{ width: 56 }}>Unit</th>
                    <th style={{ width: 88 }}>Cost ($)</th>
                    <th style={{ width: 72 }}>Mark-up%</th>
                    <th style={{ width: 96 }}>Rate ($)</th>
                    <th className="eq-quotes__th--right" style={{ width: 96 }}>Total</th>
                    <th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {QUOTE_SECTIONS.map((sec) => {
                    const secRows = createLineItems
                      .map((li, i) => ({ li, i }))
                      .filter((x) => x.li.category === sec.value);
                    const secTotal = secRows.reduce((s, x) => s + calcLineTotal(x.li), 0);
                    return (
                      <React.Fragment key={sec.value}>
                        <tr className="eq-quotes__row--group-header">
                          <td colSpan={8} className="eq-quotes__group-label">{sec.label}</td>
                        </tr>
                        {secRows.map(({ li, i }) => renderLineRow(li, i))}
                        <tr>
                          <td colSpan={8} style={{ padding: "4px 8px" }}>
                            <button
                              type="button"
                              style={{
                                background: "none", border: "none", color: "var(--eq-sky, #3DA8D8)",
                                cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "2px 0",
                              }}
                              onClick={() => addLineItem(sec.value)}
                            >
                              + Add {sec.label.toLowerCase()} line
                            </button>
                          </td>
                        </tr>
                        {secTotal > 0 && (
                          <tr className="eq-quotes__row--cat-subtotal">
                            <td colSpan={7} className="eq-quotes__td--right">
                              <span className="eq-quotes__muted" style={{ fontSize: 12 }}>{sec.label} subtotal</span>
                            </td>
                            <td className="eq-quotes__td--right eq-quotes__td--bold">{aud(secTotal)}</td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {(() => {
                    const other = createLineItems
                      .map((li, i) => ({ li, i }))
                      .filter((x) => !SECTION_VALUES.has(x.li.category));
                    if (other.length === 0) return null;
                    const t = other.reduce((s, x) => s + calcLineTotal(x.li), 0);
                    return (
                      <React.Fragment key="_other">
                        <tr className="eq-quotes__row--group-header">
                          <td colSpan={8} className="eq-quotes__group-label">Other / uncategorised</td>
                        </tr>
                        {other.map(({ li, i }) => renderLineRow(li, i))}
                        {t > 0 && (
                          <tr className="eq-quotes__row--cat-subtotal">
                            <td colSpan={7} className="eq-quotes__td--right">
                              <span className="eq-quotes__muted" style={{ fontSize: 12 }}>Other subtotal</span>
                            </td>
                            <td className="eq-quotes__td--right eq-quotes__td--bold">{aud(t)}</td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })()}
                </tbody>
              </table>
            </div>
            {/* Rate preset chips */}
            {!presetsLoading && presets.length > 0 && (() => {
              const categories = Array.from(new Set(presets.map((p) => p.category ?? "")));
              return (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--eq-border)" }}>
                  <span style={{
                    display: "block", marginBottom: 8, fontSize: 11,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    color: "var(--eq-muted)", fontWeight: 600,
                  }}>
                    Quick Add
                  </span>
                  {categories.map((cat) => (
                    <div key={cat} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      {cat && (
                        <span style={{
                          fontSize: 11, color: "var(--eq-muted)", minWidth: 64,
                          textTransform: "uppercase", letterSpacing: "0.04em",
                        }}>
                          {cat}
                        </span>
                      )}
                      {presets.filter((p) => (p.category ?? "") === cat).map((p) => (
                        <button
                          key={p.preset_id}
                          type="button"
                          onClick={() => applyPreset(p)}
                          title={`${p.description}${p.unit_rate_cents > 0 ? ` — ${aud(p.unit_rate_cents)}${p.unit ? " / " + p.unit : ""}` : ""}`}
                          style={{
                            border: "1px solid var(--eq-border)",
                            borderRadius: 6,
                            background: "var(--eq-surface)",
                            color: "var(--eq-text)",
                            fontSize: 12,
                            padding: "3px 10px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            lineHeight: 1.4,
                          }}
                        >
                          {p.description}
                          {p.unit_rate_cents > 0 && (
                            <span style={{ color: "var(--eq-muted)", fontSize: 11 }}>
                              {aud(p.unit_rate_cents)}{p.unit ? ` / ${p.unit}` : ""}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Outlet pricing calculator */}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--eq-border)" }}>
              <button
                type="button"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 12, color: "var(--eq-muted)", fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.06em", padding: 0,
                }}
                onClick={() => {
                  setCalcOpen((o) => !o);
                  if (!calcOpen && calcProducts.length === 0) void loadCalcProducts();
                }}
              >
                <span style={{ fontSize: 14 }}>{calcOpen ? "▾" : "▸"}</span>
                Outlet Pricing Calculator
              </button>

              {calcOpen && (
                <div style={{ marginTop: 12, padding: "12px 14px", background: "var(--eq-surface-alt, var(--eq-surface))", borderRadius: 8, border: "1px solid var(--eq-border)" }}>
                  {/* Mode tabs */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    {(["install", "removal"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => { setCalcMode(m); setCalcResult(null); setCalcError(null); }}
                        style={{
                          padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                          cursor: "pointer", border: "1px solid var(--eq-border)",
                          background: calcMode === m ? "var(--eq-sky, #3DA8D8)" : "var(--eq-surface)",
                          color: calcMode === m ? "#fff" : "var(--eq-text)",
                        }}
                      >
                        {m === "install" ? "Install" : "Removal"}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
                    {calcMode === "install" && (
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                        <span style={{ color: "var(--eq-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.04em" }}>Product</span>
                        <select
                          className="eq-quotes__select"
                          style={{ minWidth: 280, fontSize: 13 }}
                          value={calcProductId}
                          onChange={(e) => { setCalcProductId(e.target.value); setCalcResult(null); }}
                        >
                          {calcProducts.length === 0 && <option value="">Loading…</option>}
                          {calcProducts.map((p) => (
                            <option key={p.product_id} value={p.product_id}>{p.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      <span style={{ color: "var(--eq-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.04em" }}>Pairs</span>
                      <input
                        className="eq-quotes__input"
                        type="number"
                        min="1"
                        style={{ width: 72, fontSize: 13, textAlign: "right" }}
                        value={calcPairs}
                        onChange={(e) => { setCalcPairs(e.target.value); setCalcResult(null); }}
                      />
                    </label>
                    <button
                      type="button"
                      className="eq-quotes__btn eq-quotes__btn--primary"
                      disabled={calcLoading}
                      onClick={() => void runCalc()}
                    >
                      {calcLoading ? "Calculating…" : "Calculate"}
                    </button>
                  </div>

                  {calcError && <div className="eq-quotes__inline-err" style={{ marginTop: 8 }}>{calcError}</div>}

                  {calcResult && (() => {
                    const lines: CalcLine[] = "lines" in calcResult ? calcResult.lines : [calcResult.line];
                    const discountFactor = "discount_factor" in calcResult ? calcResult.discount_factor : 1;
                    return (
                      <div style={{ marginTop: 12 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid var(--eq-border)" }}>
                              <th style={{ textAlign: "left", padding: "3px 6px", fontWeight: 600 }}>Description</th>
                              <th style={{ textAlign: "right", padding: "3px 6px", fontWeight: 600 }}>Qty</th>
                              <th style={{ textAlign: "right", padding: "3px 6px", fontWeight: 600 }}>Rate</th>
                              <th style={{ textAlign: "right", padding: "3px 6px", fontWeight: 600 }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.map((l, i) => (
                              <tr key={i}>
                                <td style={{ padding: "3px 6px" }}>{l.description}</td>
                                <td style={{ textAlign: "right", padding: "3px 6px" }}>{qty(l.qty_thousandths)} {l.unit}</td>
                                <td style={{ textAlign: "right", padding: "3px 6px" }}>{aud(l.unit_rate_cents)}</td>
                                <td style={{ textAlign: "right", padding: "3px 6px", fontWeight: 600 }}>{aud(l.line_total_cents)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop: "1px solid var(--eq-border)" }}>
                              <td colSpan={3} style={{ textAlign: "right", padding: "4px 6px", fontSize: 11, color: "var(--eq-muted)" }}>
                                {discountFactor < 1 && `${Math.round((1 - discountFactor) * 100)}% volume discount applied · `}Total (ex GST)
                              </td>
                              <td style={{ textAlign: "right", padding: "4px 6px", fontWeight: 700 }}>{aud(calcResult.total_cents)}</td>
                            </tr>
                          </tfoot>
                        </table>
                        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            className="eq-quotes__btn eq-quotes__btn--primary"
                            onClick={addCalcLinesToQuote}
                          >
                            Add to Quote
                          </button>
                          <button
                            type="button"
                            className="eq-quotes__btn eq-quotes__btn--outline"
                            onClick={() => setCalcResult(null)}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <div className="eq-quotes__financials" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
                <div className="eq-quotes__financial-row">
                  <span>Subtotal</span>
                  <span>{aud(createSubtotal)}</span>
                </div>
                <div className="eq-quotes__financial-row">
                  <span>GST (10%)</span>
                  <span>{aud(createGst)}</span>
                </div>
                <div className="eq-quotes__financial-row eq-quotes__financial-row--total">
                  <span>Total</span>
                  <span>{aud(createTotal)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Submit row */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0", flexWrap: "wrap" }}>
            <button
              type="button"
              className="eq-quotes__btn eq-quotes__btn--primary"
              style={{ padding: "9px 24px", fontSize: 14 }}
              disabled={creating || !createCustomerId || createLineItems.filter((li) => li.description.trim()).length === 0}
              onClick={() => isEditMode ? void handleEditQuote() : void handleCreateQuote()}
            >
              {creating
                ? (isEditMode ? "Saving…" : "Creating…")
                : (isEditMode ? "Save Changes" : "Create Quote")}
            </button>
            <button
              type="button"
              className="eq-quotes__btn eq-quotes__btn--outline"
              onClick={handleCancelCreateEdit}
            >
              Cancel
            </button>
            {createError && <div className="eq-quotes__inline-err">{createError}</div>}
          </div>
        </div>
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
          <button
            type="button"
            className="eq-quotes__btn eq-quotes__btn--primary eq-quotes__btn--new-quote"
            onClick={() => setView("create")}
          >
            + New Quote
          </button>
          <div className="eq-quotes__view-tabs">
            {(["pipeline", "accordion", "import", "customers", "reports", "setup", "trash"] as ModuleView[]).map((v) => (
              <button
                key={v}
                type="button"
                className={`eq-quotes__view-tab${view === v ? " eq-quotes__view-tab--active" : ""}`}
                onClick={() => setView(v)}
              >
                {v === "pipeline" ? "Jobs" : v === "accordion" ? "By Client" : v === "import" ? "Import Coupa" : v === "customers" ? "Clients" : v === "reports" ? "Reports" : v === "setup" ? "Setup" : "Trash"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "setup" && <QuotesSetup supabase={supabase} />}
      {view === "reports" && <QuotesReports supabase={supabase} />}
      {view === "customers" && (
        <QuotesCustomers
          supabase={supabase}
          onOpenQuote={(quoteId) => {
            setView("pipeline");
            void openDetail(quoteId);
          }}
        />
      )}

      {/* Trash view */}
      {view === "trash" && (
        <div className="eq-quotes__pipeline">
          {trashedLoading ? (
            <div className="eq-quotes__loading">Loading…</div>
          ) : trashed.length === 0 ? (
            <div className="eq-quotes__empty">Trash is empty.</div>
          ) : (
            <div className="eq-quotes__table-wrap">
              <table className="eq-quotes__table">
                <thead>
                  <tr>
                    <th>Quote #</th>
                    <th>Customer</th>
                    <th>Project</th>
                    <th className="eq-quotes__th--right">Total</th>
                    <th>Deleted</th>
                    <th style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {trashed.map((q) => (
                    <tr key={q.quote_id} className="eq-quotes__row">
                      <td className="eq-quotes__td--mono">{q.quote_number}</td>
                      <td>{q.customer_name ?? "—"}</td>
                      <td>{q.project_name ?? <span className="eq-quotes__muted">—</span>}</td>
                      <td className="eq-quotes__td--right">{aud(q.total_cents)}</td>
                      <td>{fmtDate(q.deleted_at)}</td>
                      <td>
                        <button
                          type="button"
                          className="eq-quotes__btn eq-quotes__btn--outline"
                          onClick={() => void handleRestore(q.quote_id)}
                        >
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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

          {/* Search + filters + export */}
          <div className="eq-quotes__pipeline-controls">
            <input
              className="eq-quotes__search"
              type="search"
              placeholder="Search by quote #, project, or customer…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
            <input
              className="eq-quotes__input eq-quotes__input--sm"
              type="date"
              title="Created from"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <span style={{ fontSize: 12, color: "var(--eq-muted, #888)" }}>–</span>
            <input
              className="eq-quotes__input eq-quotes__input--sm"
              type="date"
              title="Created to"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
            {estimatorOptions.length > 0 && (
              <select
                className="eq-quotes__select"
                style={{ fontSize: 13, padding: "4px 6px" }}
                value={estFilter}
                onChange={(e) => setEstFilter(e.target.value)}
              >
                <option value="">All estimators</option>
                {estimatorOptions.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            )}
            {(dateFrom || dateTo || estFilter) && (
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                onClick={() => { setDateFrom(""); setDateTo(""); setEstFilter(""); }}
              >
                Clear filters
              </button>
            )}
            {!pipelineLoading && displayedQuotes.length > 0 && (
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                title="Export current view to CSV"
                onClick={() => {
                  const header = ["Quote #", "Customer", "Site", "Project", "Estimator", "Status", "Job No.", "Total inc GST", "Sent", "Created"];
                  const today = new Date().toISOString().slice(0, 10);
                  downloadCsv([header, ...displayedQuotes.map((q) => [
                    q.quote_number, q.customer_name ?? "", q.site_code ?? "", q.project_name ?? "",
                    q.estimator_initials ?? "", STATUS_LABELS[q.status] ?? q.status, q.workbench_job_no ?? "",
                    (q.total_cents / 100).toFixed(2),
                    q.sent_at ? q.sent_at.slice(0, 10) : "",
                    q.created_at.slice(0, 10),
                  ])], `eq-pipeline-${today}.csv`);
                }}
              >
                Export CSV
              </button>
            )}
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

          {/* Bulk actions — appear when rows are ticked */}
          {selectedIds.size > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "8px 0", padding: "8px 12px", background: "var(--eq-ice, #EAF5FB)", borderRadius: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedIds.size} selected</span>
              <select
                className="eq-quotes__select"
                style={{ fontSize: 13, padding: "4px 6px" }}
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
              >
                <option value="">Set status…</option>
                {Object.entries(STATUS_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
              <input
                className="eq-quotes__input eq-quotes__input--sm"
                style={{ width: 70 }}
                placeholder="Initials"
                value={initials}
                onChange={(e) => setInitials(e.target.value.toUpperCase())}
                maxLength={4}
              />
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--primary"
                disabled={!bulkStatus || bulkBusy}
                onClick={() => void handleBulkStatus()}
              >
                {bulkBusy ? "Applying…" : "Apply"}
              </button>
              <button type="button" className="eq-quotes__btn eq-quotes__btn--outline" onClick={() => setSelectedIds(new Set())}>
                Clear
              </button>
            </div>
          )}

          {/* Table — canonical eq-ui Table (sortable + per-column filters + select) */}
          {pipelineError ? (
            <div className="eq-quotes__error-banner">{pipelineError}</div>
          ) : (
            <Table
              className="eq-quotes__pipeline-table"
              rows={displayedQuotes}
              columns={pipelineColumns}
              getRowId={(q) => q.quote_id}
              onRowClick={(q) => void openDetail(q.quote_id)}
              loading={pipelineLoading}
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              emptyMessage={search ? `No quotes match "${search}".` : "No quotes in this filter."}
            />
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
