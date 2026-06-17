import React, { useState, useEffect, useCallback, useRef } from "react";
import { EqLogo } from "../../components/EqLogo";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateQuoteDoc, generateJobExcel } from "./quoteDocGenerator";
import { computeSellRate, computeMarkupPct, lineTotalCentsFromInput } from "./quoteMath";
import {
  STATUS_LABELS,
  ACTIVE_JOB_STATUSES,
  CLOSED_LOST_STATUSES as CLOSED_STATUSES,
  OPEN_PIPELINE_STATUSES,
} from "./taxonomy";
import { QuotesSetup } from "./QuotesSetup";
import { QuotesReports } from "./QuotesReports";
import { QuotesCustomers } from "./QuotesCustomers";
import { captureRpcError } from "./quoteTelemetry";
import { Table, type TableColumn, DropdownMenu, type DropdownMenuEntry } from "@eq-solutions/ui";
import {
  MoreHorizontal, Copy, Trash2, FileUp, Users, BarChart2, Settings,
  Clock, Briefcase, CalendarClock, AlarmClock, LayoutGrid, List, SlidersHorizontal, X, Archive, Columns3,
} from "lucide-react";

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
  follow_up_at: string | null;
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
  follow_up_at: string | null;
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
  contact_id: string | null;
  contact_email: string | null;
  line_items: LineItem[];
  notes: QuoteNote[];
}

interface ContactRow {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile_phone: string | null;
  work_phone: string | null;
  contact_position: string | null;
  is_default_quote_contact: boolean;
}

interface EstimatorRow {
  estimator_id: string;
  name: string;
  initials: string | null;
  sort_order: number;
}

interface ParsedQuotePdf {
  customer_name?: string | null;
  site_name?: string | null;
  project_name?: string | null;
  estimator_name?: string | null;
  estimator_initials?: string | null;
  scope?: string | null;
  clarifications?: string | null;
  attn_first_name?: string | null;
  attn_last_name?: string | null;
  attn_phone?: string | null;
  address?: string | null;
  payment_terms?: string | null;
  line_items?: Array<{
    description?: string;
    qty?: number;
    unit?: string;
    rate?: number;
    cost?: number;
    category?: string;
  }> | null;
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

interface ParsedSubItem {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
}

interface PdfParseResult {
  supplier_name?: string;
  quote_ref?: string;
  project_name?: string;
  scope_summary?: string;
  address?: string;
  items: ParsedSubItem[];
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
  scope: "updated scope",
  expires_at: "changed expiry",
  sent_at: "changed sent date",
  contact_linked: "linked contact",
  expired: "auto-expired",
  project: "updated project",
  payment_terms: "updated payment terms",
  recipient: "updated recipient",
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
  if (a.action === "expires_at" || a.action === "sent_at") {
    const oldVal = c["old"] as string | null | undefined;
    const newVal = c["new"] as string | null | undefined;
    if (newVal) return `${fmtDate(oldVal ?? null)} → ${fmtDate(newVal)}`;
    return oldVal ? `Cleared (was ${fmtDate(oldVal)})` : "Cleared";
  }
  if (a.action === "contact_linked") {
    const newCid = c["new_contact_id"];
    return newCid ? "Contact linked" : "Contact unlinked";
  }
  if (a.action === "scope") {
    return "Scope of works updated";
  }
  if (a.action === "expired") {
    return "Auto-expired by scheduler";
  }
  if (a.action === "project") {
    const parts: string[] = [];
    if (c["project_name"]) parts.push(`Project: ${String(c["project_name"])}`);
    if (c["estimator_name"]) parts.push(`Estimator: ${String(c["estimator_name"])}`);
    return parts.length > 0 ? parts.join(" · ") : "Project details updated";
  }
  if (a.action === "payment_terms") {
    const parts: string[] = [];
    if (c["payment_terms"]) parts.push(String(c["payment_terms"]));
    if (c["validity_days"] != null) parts.push(`${String(c["validity_days"])}d validity`);
    return parts.length > 0 ? parts.join(" · ") : "Payment terms updated";
  }
  if (a.action === "header") {
    const FIELD_LABELS: Record<string, string> = {
      project_name: "Project", quote_number: "Quote #", customer_id: "Customer",
      site_id: "Site", estimator_name: "Estimator", po_number: "PO",
    };
    const changed = Object.entries(c)
      .filter(([, v]) => v && typeof v === "object" && ("old" in (v as object) || "new" in (v as object)))
      .map(([k, v]) => {
        const label = FIELD_LABELS[k] ?? k.replace(/_/g, " ");
        const diff = v as { old?: unknown; new?: unknown };
        if (diff.old && diff.new) return `${label}: ${String(diff.old)} → ${String(diff.new)}`;
        if (diff.new) return `${label}: set to ${String(diff.new)}`;
        if (diff.old) return `${label}: cleared`;
        return label;
      });
    return changed.length > 0 ? changed.join(", ") : "Details edited";
  }
  if (a.action === "recipient") {
    const parts: string[] = [];
    const first = c["attn_first_name"];
    const last = c["attn_name"];
    if (first || last) parts.push([first, last].filter(Boolean).map(String).join(" "));
    if (c["attn_phone"]) parts.push(`Ph: ${String(c["attn_phone"])}`);
    if (c["address"]) parts.push("Address updated");
    return parts.length > 0 ? parts.join(" · ") : "Recipient updated";
  }
  return "Changed " + Object.keys(c).map((f) => f.replace(/_/g, " ")).join(", ");
}

// STATUS_LABELS, ACTIVE_JOB_STATUSES and CLOSED_STATUSES are imported from
// ./taxonomy (the single source of truth, locked by taxonomy.test.ts).

const ACCORDION_ACTIVE = new Set([...ACTIVE_JOB_STATUSES, "sent"]);

const DRAFT_KEY = "eq-quotes-draft-new";

// Simplified 5-stage pipeline view. Each stage covers one or more internal statuses.
// internalStatus = the value written to DB when the user picks this stage in a row dropdown.
const STATUS_FILTERS: Array<{ key: string; label: string; internalStatus?: string; match: (s: string) => boolean }> = [
  { key: "quote-sent",  label: "Quote Sent",  internalStatus: "submitted",       match: (s) => ["draft", "submitted", "client-reviewing", "on-hold", "verbal-win", "won-awaiting-job-no"].includes(s) },
  { key: "job-created", label: "Job Created", internalStatus: "won-job-created", match: (s) => ["won-job-created", "po-matched"].includes(s) },
  { key: "in-progress", label: "In Progress", internalStatus: "active",          match: (s) => s === "active" },
  { key: "completed",   label: "Completed",   internalStatus: "complete",        match: (s) => ["complete", "ready-to-invoice"].includes(s) },
  { key: "invoiced",    label: "Invoiced",    internalStatus: "invoiced",        match: (s) => s === "invoiced" },
  { key: "all",         label: "All",                                            match: () => true },
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
  "ready-to-invoice": ["invoiced"],
  "on-hold": ["submitted", "verbal-win", "lost", "cancelled"],
};

// STAGES is an alias for STATUS_FILTERS — both the top chips and the column
// header filter use the same 5-stage list.
const STAGES = STATUS_FILTERS;
const STAGE_KEYS = new Set(STAGES.map((s) => s.key));

// Board columns — one status per column so a drag-drop is an unambiguous status
// set. Terminal/loss statuses are intentionally omitted (set those from the row).
const BOARD_COLUMNS: string[] = [
  "draft", "submitted", "client-reviewing", "on-hold",
  "verbal-win", "won-awaiting-job-no", "won-job-created", "po-matched",
  "active", "complete",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcLineTotal(li: CreateLineItem): number {
  // Mirror the persistence defaults (qty blank/0 → 1, rate blank → 0) and the DB's
  // truncating cents math, so the preview total equals the value the server stores.
  return lineTotalCentsFromInput(parseFloat(li.qty) || 1, parseFloat(li.rate) || 0);
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
function fmtExpiry(iso: string | null): { text: string; urgent: boolean; overdue: boolean } {
  if (!iso) return { text: "—", urgent: false, overdue: false };
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: `${Math.abs(days)}d ago`, urgent: false, overdue: true };
  if (days === 0) return { text: "Today", urgent: true, overdue: false };
  if (days <= 7) return { text: `${days}d`, urgent: true, overdue: false };
  return { text: fmtDate(iso), urgent: false, overdue: false };
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

function toSimpleLabel(status: string): string {
  return STATUS_FILTERS.find((s) => s.key !== "all" && s.match(status))?.label
    ?? STATUS_LABELS[status]
    ?? status;
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
  if (["complete", "ready-to-invoice", "invoiced"].includes(status))
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
  const [statusFilter, setStatusFilter] = useState(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem("eq-quotes-tab") : null;
    return (stored && STAGE_KEYS.has(stored)) ? stored : "in-progress";
  });
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Pipeline client-side filters persist across reloads (estimator/customer/site +
  // quick toggles). Date range is intentionally NOT persisted (time-sensitive).
  const savedFiltersRef = useRef<Record<string, unknown> | null>(null);
  if (savedFiltersRef.current === null) {
    try {
      savedFiltersRef.current = typeof localStorage !== "undefined"
        ? (JSON.parse(localStorage.getItem("eq-quotes-pipeline-filters") || "{}") as Record<string, unknown>)
        : {};
    } catch { savedFiltersRef.current = {}; }
  }
  const _sf = savedFiltersRef.current;
  const [estFilter, setEstFilter] = useState(() => (typeof _sf.est === "string" ? _sf.est : ""));
  const [customerFilter, setCustomerFilter] = useState(() => (typeof _sf.customer === "string" ? _sf.customer : ""));
  const [siteFilter, setSiteFilter] = useState(() => (typeof _sf.site === "string" ? _sf.site : ""));
  const [expiringOnly, setExpiringOnly] = useState(() => _sf.expiring === true);
  const [unsentOnly, setUnsentOnly] = useState(() => _sf.unsent === true);
  const [needsJobNoOnly, setNeedsJobNoOnly] = useState(() => _sf.needsJobNo === true);
  const [overdueFupOnly, setOverdueFupOnly] = useState(() => _sf.overdueFup === true);
  const [staleOnly, setStaleOnly] = useState(() => _sf.stale === true);
  const [pipelineLoading, setPipelineLoading] = useState(true);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const detailIdRef = useRef<string | null>(null);
  const displayedQuotesRef = useRef<Quote[]>([]);
  const detailRef = useRef<QuoteDetail | null>(null);
  // Action refs so the keydown handler calls the current functions without listing
  // them (declared later) in its dependency array. Assigned in the render body below.
  const openEditFormRef = useRef<((d: QuoteDetail) => void) | null>(null);
  const handleDuplicateRef = useRef<((quoteId: string) => Promise<void>) | null>(null);

  // ── Detail state ──────────────────────────────────────────────────────────
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Status update
  const [advanceStatus, setAdvanceStatus] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [initials, setInitials] = useState(() =>
    (typeof localStorage !== "undefined" ? localStorage.getItem("eq-quotes-initials") : null) ?? ""
  );
  const updateInitials = (v: string) => {
    const upper = v.toUpperCase();
    setInitials(upper);
    try { localStorage.setItem("eq-quotes-initials", upper); } catch { /* ignore */ }
  };
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

  // Sent date inline edit
  const [sentAtInput, setSentAtInput] = useState("");
  const [savingSentAt, setSavingSentAt] = useState(false);
  const [sentAtErr, setSentAtErr] = useState<string | null>(null);

  // Expiry date inline edit
  const [expiresInput, setExpiresInput] = useState("");
  const [savingExpires, setSavingExpires] = useState(false);
  const [expiresErr, setExpiresErr] = useState<string | null>(null);

  // Follow-up date inline edit (detail panel)
  const [followUpInput, setFollowUpInput] = useState("");
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [followUpErr, setFollowUpErr] = useState<string | null>(null);

  // Inline follow-up edit from pipeline table
  const [pipelineFupEdit, setPipelineFupEdit] = useState<{ quoteId: string; value: string } | null>(null);
  const [pipelinePoEdit, setPipelinePoEdit] = useState<{ quoteId: string; value: string } | null>(null);

  // Inline status + job-no edit from pipeline table
  const [pipelineStatusEdit, setPipelineStatusEdit] = useState<string | null>(null);
  const [pipelineJobNoEdit, setPipelineJobNoEdit] = useState<{ quoteId: string; value: string } | null>(null);

  // Pipeline layout (table vs board) + consolidated-filters popover + board drag target
  const [pipelineLayout, setPipelineLayout] = useState<"table" | "board">(() =>
    (typeof localStorage !== "undefined" && localStorage.getItem("eq-quotes-layout") === "board") ? "board" : "table"
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);

  // Customisable pipeline columns — localStorage for instant render, DB for cross-device persistence.
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem("eq-quotes-hidden-cols") : null;
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    return new Set(["margin_pct"]);
  });
  const colsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveHiddenColsToDb = (next: Set<string>) => {
    if (colsSaveTimer.current) clearTimeout(colsSaveTimer.current);
    colsSaveTimer.current = setTimeout(() => {
      fetch("/.netlify/functions/user-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ key: "ops:hidden_cols", value: [...next] }),
      }).catch(() => { /* non-fatal */ });
    }, 800);
  };
  const toggleCol = (key: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem("eq-quotes-hidden-cols", JSON.stringify([...next])); } catch { /* ignore */ }
      saveHiddenColsToDb(next);
      return next;
    });
  };
  // Load column prefs from DB on mount — overrides localStorage if user has a saved value.
  useEffect(() => {
    fetch("/.netlify/functions/user-preferences", { credentials: "include" })
      .then((r) => r.ok ? r.json() as Promise<{ ok: boolean; preferences?: Record<string, unknown> }> : null)
      .then((data) => {
        if (!data?.ok || !data.preferences) return;
        const saved = data.preferences["ops:hidden_cols"];
        if (Array.isArray(saved)) {
          const next = new Set(saved as string[]);
          setHiddenCols(next);
          try { localStorage.setItem("eq-quotes-hidden-cols", JSON.stringify([...next])); } catch { /* ignore */ }
        }
      })
      .catch(() => { /* non-fatal — localStorage value stays */ });
  }, []);

  // Payment terms / validity days inline edit
  const [termsEditing, setTermsEditing] = useState(false);
  const [termsInput, setTermsInput] = useState("");
  const [validityInput, setValidityInput] = useState("");
  const [savingTerms, setSavingTerms] = useState(false);
  const [termsErr, setTermsErr] = useState<string | null>(null);

  // Project name / estimator inline edit
  const [projectEditing, setProjectEditing] = useState(false);
  const [projectInput, setProjectInput] = useState("");
  const [estimatorInput, setEstimatorInput] = useState("");
  const [estInitialsInput, setEstInitialsInput] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [projectErr, setProjectErr] = useState<string | null>(null);

  // Recipient (attention block + address) inline edit
  const [recipientEditing, setRecipientEditing] = useState(false);
  const [attnFirstInput, setAttnFirstInput] = useState("");
  const [attnLastInput, setAttnLastInput] = useState("");
  const [attnPhoneInput, setAttnPhoneInput] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [savingRecipient, setSavingRecipient] = useState(false);
  const [recipientErr, setRecipientErr] = useState<string | null>(null);

  // Scope / clarifications / notes inline edit
  const [scopeEditing, setScopeEditing] = useState(false);
  const [scopeInput, setScopeInput] = useState("");
  const [clarInput, setClarInput] = useState("");
  const [quoteNotesInput, setQuoteNotesInput] = useState("");
  const [savingScope, setSavingScope] = useState(false);
  const [scopeErr, setScopeErr] = useState<string | null>(null);

  // Contact picker
  const [detailContacts, setDetailContacts] = useState<ContactRow[]>([]);
  const [detailSiteContacts, setDetailSiteContacts] = useState<ContactRow[]>([]);
  const [contactPickerVal, setContactPickerVal] = useState("");
  const [linkingContact, setLinkingContact] = useState(false);
  const [linkContactErr, setLinkContactErr] = useState<string | null>(null);

  // Job Creation Excel
  const [jobCreationBusy, setJobCreationBusy] = useState(false);
  const [jobCreationErr, setJobCreationErr] = useState<string | null>(null);

  // Note
  const [noteBody, setNoteBody] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [noteMutErr, setNoteMutErr] = useState<string | null>(null);

  // PDF download + email
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailToName, setEmailToName] = useState("");
  const [emailingPdf, setEmailingPdf] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Share link
  const [sharingLink, setSharingLink] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [docMode, setDocMode] = useState<"detailed" | "summary" | "lump_sum">("detailed");

  // ── Accordion state ───────────────────────────────────────────────────────
  const [clientGroups, setClientGroups] = useState<ClientGroup[]>([]);
  const [accordionQuotes, setAccordionQuotes] = useState<Quote[]>([]);
  const [accordionLoading, setAccordionLoading] = useState(false);
  const [accordionError, setAccordionError] = useState<string | null>(null);
  const [accordionActiveOnly, setAccordionActiveOnly] = useState(true);
  const [accordionSearch, setAccordionSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["equinix"]));

  // ── Customers + sites + presets + create form state ─────────────────────
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [presets, setPresets] = useState<RatePreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [createCustomerId, setCreateCustomerId] = useState("");
  const [createCustomerSearch, setCreateCustomerSearch] = useState("");
  const [createSiteId, setCreateSiteId] = useState("");
  const [createSiteSearch, setCreateSiteSearch] = useState("");
  const [createContacts, setCreateContacts] = useState<ContactRow[]>([]);
  const [siteContactsForForm, setSiteContactsForForm] = useState<ContactRow[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [estimators, setEstimators] = useState<EstimatorRow[]>([]);
  const [createProjectName, setCreateProjectName] = useState("");
  const [createEstimatorName, setCreateEstimatorName] = useState("");
  const [createEstimatorInitials, setCreateEstimatorInitials] = useState("");
  const [createScope, setCreateScope] = useState("");
  const [draftingScope, setDraftingScope] = useState(false);
  const [scopeAiErr, setScopeAiErr] = useState<string | null>(null);
  const [createNotes, setCreateNotes] = useState("");
  const [createAttnName, setCreateAttnName] = useState("");
  const [createAttnFirstName, setCreateAttnFirstName] = useState("");
  const [createAttnPhone, setCreateAttnPhone] = useState("");
  const [createAddress, setCreateAddress] = useState("");
  const [createPaymentTerms, setCreatePaymentTerms] = useState("");
  const [createValidityDays, setCreateValidityDays] = useState("30");
  const [createQuoteNumber, setCreateQuoteNumber] = useState("SKS-");
  const [createClarifications, setCreateClarifications] = useState("");
  const [createLineItems, setCreateLineItems] = useState<CreateLineItem[]>([
    { description: "", qty: "1", unit: "", cost: "", markup: "", rate: "", category: "labour" },
  ]);
  const [showDraftBanner, setShowDraftBanner] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactFirst, setNewContactFirst] = useState("");
  const [newContactLast, setNewContactLast] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [addingContact, setAddingContact] = useState(false);
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
  const [presetPanelOpen, setPresetPanelOpen] = useState(false);
  const [presetPanelCat, setPresetPanelCat] = useState("labour");
  interface CalcMatrixRow { product_id: string; name: string; band_label: string; min_qty: number; computed_price: number; }
  const [calcMatrix, setCalcMatrix] = useState<CalcMatrixRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [audit, setAudit] = useState<QuoteAuditEntry[]>([]);
  const [trashed, setTrashed] = useState<TrashedQuote[]>([]);
  const [trashedLoading, setTrashedLoading] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [markingSent, setMarkingSent] = useState(false);
  const [quickWinBusy, setQuickWinBusy] = useState(false);
  const [quickLoseBusy, setQuickLoseBusy] = useState(false);
  const [losePromptOpen, setLosePromptOpen] = useState(false);
  const [loseReason, setLoseReason] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkFupDate, setBulkFupDate] = useState("");
  const [bulkFupBusy, setBulkFupBusy] = useState(false);

  // ── PDF import state ─────────────────────────────────────────────────────
  const pdfFileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfStartFileInputRef = useRef<HTMLInputElement | null>(null);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfParseErr, setPdfParseErr] = useState<string | null>(null);
  const [pdfStartErr, setPdfStartErr] = useState<string | null>(null);
  const [pdfParseResult, setPdfParseResult] = useState<PdfParseResult | null>(null);

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
        p_status: STAGE_KEYS.has(status) ? null : status,
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
    try { localStorage.setItem("eq-quotes-tab", statusFilter); } catch { /* ignore */ }
    void loadQuotes(statusFilter, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist the client-side pipeline filters so they survive a reload.
  useEffect(() => {
    try {
      localStorage.setItem("eq-quotes-pipeline-filters", JSON.stringify({
        est: estFilter, customer: customerFilter, site: siteFilter,
        expiring: expiringOnly, unsent: unsentOnly, needsJobNo: needsJobNoOnly,
        overdueFup: overdueFupOnly, stale: staleOnly,
      }));
    } catch { /* ignore */ }
  }, [estFilter, customerFilter, siteFilter, expiringOnly, unsentOnly, needsJobNoOnly, overdueFupOnly, staleOnly]);

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
        setSentAtInput(row.sent_at ? row.sent_at.slice(0, 10) : "");
        setExpiresInput(row.expires_at ? row.expires_at.slice(0, 10) : "");
        setExpiresErr(null);
        setFollowUpInput(row.follow_up_at ? row.follow_up_at.slice(0, 10) : "");
        setFollowUpErr(null);
        setTermsEditing(false);
        setTermsInput(row.payment_terms ?? "");
        setValidityInput(row.validity_days != null ? String(row.validity_days) : "");
        setTermsErr(null);
        setProjectEditing(false);
        setProjectInput(row.project_name ?? "");
        setEstimatorInput(row.estimator_name ?? "");
        setEstInitialsInput(row.estimator_initials ?? "");
        setProjectErr(null);
        setRecipientEditing(false);
        setAttnFirstInput(row.attn_first_name ?? "");
        setAttnLastInput(row.attn_name ?? "");
        setAttnPhoneInput(row.attn_phone ?? "");
        setAddressInput(row.address ?? "");
        setRecipientErr(null);
        setScopeEditing(false);
        setScopeInput(row.scope_of_works ?? "");
        setClarInput(row.clarifications ?? "");
        setQuoteNotesInput(row.quote_notes ?? "");
        setScopeErr(null);
        setContactPickerVal(row.contact_id ?? "");
        setLinkContactErr(null);
        if (row.customer_id) {
          const { data: contactsData } = await supabase.rpc("eq_list_contacts_for_customer", {
            p_customer_id: row.customer_id,
          });
          setDetailContacts((contactsData as ContactRow[]) ?? []);
        } else {
          setDetailContacts([]);
        }
        if (row.site_id) {
          const { data: siteCtData } = await supabase.rpc("eq_list_contacts_for_site", {
            p_site_id: row.site_id,
          });
          setDetailSiteContacts((siteCtData as ContactRow[]) ?? []);
        } else {
          setDetailSiteContacts([]);
        }
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

  const loadEstimators = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("eq_list_estimators");
    if (!error) setEstimators((data as EstimatorRow[]) ?? []);
  }, [supabase]);

  const loadSiteContactsForForm = useCallback(async (siteId: string) => {
    if (!supabase || !siteId) { setSiteContactsForForm([]); return; }
    const { data, error } = await supabase.rpc("eq_list_contacts_for_site", { p_site_id: siteId });
    if (!error) setSiteContactsForForm((data as ContactRow[]) ?? []);
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

  const loadCalcMatrix = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("eq_get_pricing_matrix");
    if (!error && data) {
      setCalcMatrix(((data as Record<string, unknown>[]) ?? []).map((r) => ({
        product_id: String(r.product_id),
        name: String(r.name ?? ""),
        band_label: String(r.band_label ?? ""),
        min_qty: Number(r.min_qty ?? 0),
        computed_price: Number(r.computed_price ?? 0),
      })));
    }
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
      void loadEstimators();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keyboard shortcuts: / = focus search, N = new quote, Escape/E/D in detail
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === "n" && detailIdRef.current === null && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setView("create");
        return;
      }
      if (detailIdRef.current === null) return;
      if (e.key === "Escape") {
        setDetailId(null);
        setDetail(null);
        return;
      }
      if (e.key === "e" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const d = detailRef.current;
        if (d) openEditFormRef.current?.(d);
        return;
      }
      if (e.key === "d" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const id = detailIdRef.current;
        if (id) void handleDuplicateRef.current?.(id);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dq = displayedQuotesRef.current;
        const idx = dq.findIndex((q) => q.quote_id === detailIdRef.current);
        if (idx < 0) return;
        const target = e.key === "ArrowLeft" ? dq[idx - 1] : dq[idx + 1];
        if (target) void openDetail(target.quote_id);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [openDetail]);

  // Update browser tab title when viewing a quote
  useEffect(() => {
    const prev = document.title;
    if (detail) { document.title = `${detail.quote_number} — EQ Ops`; }
    else        { document.title = "EQ Ops"; }
    return () => { document.title = prev; };
  }, [detail]);

  // ── Create form helpers ───────────────────────────────────────────────────

  const resetCreateForm = () => {
    setCreateCustomerId("");
    setCreateCustomerSearch("");
    setCreateSiteId("");
    setCreateSiteSearch("");
    setSites([]);
    setCreateContacts([]);
    setSiteContactsForForm([]);
    setSelectedContactId(null);
    setPdfParsing(false);
    setPdfParseErr(null);
    setCreateProjectName("");
    const savedEstName = (typeof localStorage !== "undefined" ? localStorage.getItem("eq-quotes-estimator-name") : null) ?? "";
    const savedEstInitials = (typeof localStorage !== "undefined" ? localStorage.getItem("eq-quotes-initials") : null) ?? "";
    setCreateEstimatorName(savedEstName);
    setCreateEstimatorInitials(savedEstInitials);
    const savedTerms = (typeof localStorage !== "undefined" ? localStorage.getItem("eq-quotes-payment-terms") : null) ?? "";
    setCreatePaymentTerms(savedTerms);
    setCreateScope("");
    setCreateNotes("");
    setCreateAttnName("");
    setCreateAttnFirstName("");
    setCreateAttnPhone("");
    setCreateAddress("");
    setCreateValidityDays("30");
    setCreateQuoteNumber("SKS-");
    setCreateClarifications("");
    setCreateLineItems([{ description: "", qty: "1", unit: "", cost: "", markup: "", rate: "", category: "labour" }]);
    setCreateError(null);
    setScopeAiErr(null);
    setDraftingScope(false);
    setEditingQuoteId(null);
  };

  const clearDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    setShowDraftBanner(false);
  };

  const restoreDraft = () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as {
        savedAt?: string; customerId?: string; customerSearch?: string;
        siteId?: string; siteSearch?: string; projectName?: string;
        estimatorName?: string; estimatorInitials?: string; scope?: string;
        clarifications?: string; notes?: string; attnFirstName?: string;
        attnLastName?: string; attnPhone?: string; address?: string;
        paymentTerms?: string; validityDays?: string; quoteNumber?: string;
        lineItems?: CreateLineItem[];
      };
      if (d.customerId) setCreateCustomerId(d.customerId);
      if (d.customerSearch) setCreateCustomerSearch(d.customerSearch);
      if (d.siteId) setCreateSiteId(d.siteId);
      if (d.siteSearch) setCreateSiteSearch(d.siteSearch);
      if (d.projectName) setCreateProjectName(d.projectName);
      if (d.estimatorName) setCreateEstimatorName(d.estimatorName);
      if (d.estimatorInitials) setCreateEstimatorInitials(d.estimatorInitials);
      if (d.scope) setCreateScope(d.scope);
      if (d.clarifications) setCreateClarifications(d.clarifications);
      if (d.notes) setCreateNotes(d.notes);
      if (d.attnFirstName) setCreateAttnFirstName(d.attnFirstName);
      if (d.attnLastName) setCreateAttnName(d.attnLastName);
      if (d.attnPhone) setCreateAttnPhone(d.attnPhone);
      if (d.address) setCreateAddress(d.address);
      if (d.paymentTerms) setCreatePaymentTerms(d.paymentTerms);
      if (d.validityDays) setCreateValidityDays(d.validityDays);
      if (d.quoteNumber) setCreateQuoteNumber(d.quoteNumber);
      if (d.lineItems?.length) setCreateLineItems(d.lineItems);
      setShowDraftBanner(false);
    } catch { setShowDraftBanner(false); }
  };

  // Show draft banner when entering create view (not edit) and a draft exists
  useEffect(() => {
    if (view !== "create" || editingQuoteId) { setShowDraftBanner(false); return; }
    try {
      if (localStorage.getItem(DRAFT_KEY)) setShowDraftBanner(true);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Auto-save draft to localStorage while creating (debounced 800ms)
  useEffect(() => {
    if (view !== "create" || editingQuoteId) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const isEmpty =
        createQuoteNumber === "SKS-" &&
        !createCustomerSearch &&
        createLineItems.every((li) => !li.description.trim());
      if (isEmpty) { try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ } return; }
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          savedAt: new Date().toISOString(),
          customerId: createCustomerId,
          customerSearch: createCustomerSearch,
          siteId: createSiteId,
          siteSearch: createSiteSearch,
          projectName: createProjectName,
          estimatorName: createEstimatorName,
          estimatorInitials: createEstimatorInitials,
          scope: createScope,
          clarifications: createClarifications,
          notes: createNotes,
          attnFirstName: createAttnFirstName,
          attnLastName: createAttnName,
          attnPhone: createAttnPhone,
          address: createAddress,
          paymentTerms: createPaymentTerms,
          validityDays: createValidityDays,
          quoteNumber: createQuoteNumber,
          lineItems: createLineItems,
        }));
      } catch { /* storage full — ignore */ }
    }, 800);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [
    view, editingQuoteId,
    createCustomerId, createCustomerSearch, createSiteId, createSiteSearch,
    createProjectName, createEstimatorName, createEstimatorInitials,
    createScope, createClarifications, createNotes,
    createAttnFirstName, createAttnName, createAttnPhone, createAddress,
    createPaymentTerms, createValidityDays, createQuoteNumber, createLineItems,
  ]);

  const handleAddNewContact = async () => {
    if (!supabase || !createCustomerId || !newContactFirst.trim()) return;
    setAddingContact(true);
    const extId = `eq-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await supabase.rpc("eq_upsert_contact", {
      p_external_id: extId,
      p_customer_id: createCustomerId,
      p_first_name: newContactFirst.trim() || null,
      p_last_name: newContactLast.trim() || null,
      p_mobile_phone: newContactPhone.trim() || null,
      p_email: newContactEmail.trim() || null,
    });
    setAddingContact(false);
    if (error || !data) return;
    const newId = data as string;
    const newContact: ContactRow = {
      contact_id: newId,
      first_name: newContactFirst.trim() || null,
      last_name: newContactLast.trim() || null,
      email: newContactEmail.trim() || null,
      mobile_phone: newContactPhone.trim() || null,
      work_phone: null,
      contact_position: null,
      is_default_quote_contact: false,
    };
    setCreateContacts((prev) => [...prev, newContact]);
    // Auto-fill attention from new contact
    setSelectedContactId(newId);
    setCreateAttnFirstName(newContact.first_name ?? "");
    setCreateAttnName(newContact.last_name ?? "");
    setCreateAttnPhone(newContact.mobile_phone ?? "");
    // Reset add form
    setNewContactFirst("");
    setNewContactLast("");
    setNewContactPhone("");
    setNewContactEmail("");
    setShowAddContact(false);
  };

  const openEditForm = useCallback((d: QuoteDetail) => {
    setEditingQuoteId(d.quote_id);
    setDetailId(null);
    setCreateCustomerId(d.customer_id);
    setCreateCustomerSearch(d.customer_name ?? "");
    setCreateSiteId(d.site_id ?? "");
    setCreateSiteSearch(d.site_name ? `${d.site_name}${d.site_code ? ` [${d.site_code}]` : ""}` : "");
    setSiteContactsForForm([]);
    setSelectedContactId(null);
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
    if (supabase && d.customer_id) {
      void supabase.rpc("eq_list_contacts_for_customer", { p_customer_id: d.customer_id }).then(({ data }) => {
        setCreateContacts((data as ContactRow[]) ?? []);
      });
    } else {
      setCreateContacts([]);
    }
    setView("edit");
  }, [loadSites, supabase]);

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

  const handleDraftScope = async () => {
    setDraftingScope(true);
    setScopeAiErr(null);
    try {
      const customer = customers.find((c) => c.customer_id === createCustomerId);
      const site = sites.find((s) => s.site_id === createSiteId);
      const lineDescriptions = createLineItems.map((li) => li.description).filter((d) => d.trim());
      const res = await fetch("/.netlify/functions/quote-suggest-scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          customer_name: customer?.company_name || undefined,
          project_name: createProjectName.trim() || undefined,
          site: site ? (site.code ?? site.name) : undefined,
          brief: createScope.trim() || undefined,
          line_items: lineDescriptions,
        }),
      });
      const j = await res.json() as { ok: boolean; scope?: string; clarifications?: string; error?: string };
      if (!res.ok || !j.ok) {
        setScopeAiErr(
          j.error === "ai_not_configured" ? "AI isn't configured on the server."
          : j.error === "need_brief" ? "Add a project name, a few words of scope, or some line items first."
          : "Couldn't draft the scope — try again.",
        );
        return;
      }
      if (j.scope) setCreateScope(j.scope);
      if (j.clarifications && !createClarifications.trim()) setCreateClarifications(j.clarifications);
    } catch {
      setScopeAiErr("Couldn't reach the AI service.");
    } finally {
      setDraftingScope(false);
    }
  };

  const handlePdfImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setPdfParsing(true);
    setPdfParseErr(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary);
      const res = await fetch("/.netlify/functions/quote-parse-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pdf_base64: b64 }),
      });
      const parsed = await res.json() as ParsedQuotePdf & { ok?: boolean; error?: string };
      if (!res.ok || parsed.ok === false) {
        setPdfParseErr(parsed.error === "ai_not_configured" ? "AI not configured on this server." : "Could not parse PDF — check the format.");
        return;
      }
      if (parsed.customer_name) {
        setCreateCustomerSearch(parsed.customer_name);
        const match = customers.find((c) => c.company_name.toLowerCase() === parsed.customer_name!.toLowerCase());
        if (match && match.customer_id !== createCustomerId) {
          setCreateCustomerId(match.customer_id);
          void loadSites(match.customer_id);
          if (supabase) {
            void supabase.rpc("eq_list_contacts_for_customer", { p_customer_id: match.customer_id }).then(({ data }) => {
              setCreateContacts((data as ContactRow[]) ?? []);
            });
          }
        }
      }
      if (parsed.site_name) setCreateSiteSearch(parsed.site_name);
      if (parsed.project_name) setCreateProjectName(parsed.project_name);
      if (parsed.estimator_name) setCreateEstimatorName(parsed.estimator_name);
      if (parsed.estimator_initials) { const upper = parsed.estimator_initials.toUpperCase(); setCreateEstimatorInitials(upper); updateInitials(upper); }
      if (parsed.scope) setCreateScope(parsed.scope);
      if (parsed.clarifications) setCreateClarifications(parsed.clarifications);
      if (parsed.attn_first_name) setCreateAttnFirstName(parsed.attn_first_name);
      if (parsed.attn_last_name) setCreateAttnName(parsed.attn_last_name);
      if (parsed.attn_phone) setCreateAttnPhone(parsed.attn_phone);
      if (parsed.address) setCreateAddress(parsed.address);
      if (parsed.payment_terms) setCreatePaymentTerms(parsed.payment_terms);
      if (parsed.line_items?.length) {
        setCreateLineItems(parsed.line_items.map((li) => ({
          description: li.description ?? "",
          qty: String(li.qty ?? 1),
          unit: li.unit ?? "",
          cost: li.cost != null ? String(li.cost) : "",
          markup: "",
          rate: li.rate != null ? String(li.rate) : "",
          category: li.category ?? "labour",
        })));
      }
    } catch {
      setPdfParseErr("PDF parse failed — try again.");
    } finally {
      setPdfParsing(false);
    }
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
      p_quote_number: createQuoteNumber.trim() || null,
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
    clearDraft();
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

  const handleRevise = async () => {
    if (!supabase || !detail) return;
    setDuplicating(true);
    // 1. Supersede the original
    await supabase.rpc("eq_update_quote_status", {
      p_quote_id: detail.quote_id,
      p_new_status: "superseded",
      p_note: null,
      p_initials: initials.trim() || null,
    });
    // 2. Duplicate to a new draft
    const { data, error } = await supabase.rpc("eq_duplicate_quote", { p_source_quote_id: detail.quote_id });
    setDuplicating(false);
    if (error) { captureRpcError("eq_duplicate_quote", error, { quote_id: detail.quote_id }); setDetailError(error.message); return; }
    const row = (data as Array<{ quote_id: string; quote_number: string }>)[0];
    if (!row) { setDetailError("Revise failed: no quote returned."); return; }
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

  // Permanent delete — removes the quote and all its children (cascade). No undo;
  // Archive (eq_trash_quote) is the recoverable path.
  const handleDelete = async (quoteId: string, quoteNumber?: string | null) => {
    if (!supabase) return;
    if (typeof window !== "undefined" && !window.confirm(
      `Permanently delete quote ${quoteNumber ?? ""}?\n\n` +
      `This removes it and all its line items, notes and history for good. ` +
      `This cannot be undone — use Archive instead if you might need it back.`
    )) return;
    const { error } = await supabase.rpc("eq_delete_quote", { p_quote_id: quoteId });
    if (error) { captureRpcError("eq_delete_quote", error, { quote_id: quoteId }); setDetailError(error.message); return; }
    setDetailId(null);
    setDetail(null);
    void loadTrashed();
    void loadQuotes(statusFilter, search);
  };

  const handleMarkAsSent = async () => {
    if (!supabase || !detail) return;
    setMarkingSent(true);
    if (detail.status === "draft") {
      const { error: se } = await supabase.rpc("eq_update_quote_status", {
        p_quote_id: detail.quote_id,
        p_new_status: "submitted",
        p_note: null,
        p_initials: initials.trim() || null,
      });
      if (se) { captureRpcError("eq_update_quote_status", se, { quote_id: detail.quote_id }); setMarkingSent(false); return; }
    }
    const today = new Date().toISOString();
    const { error } = await supabase.rpc("eq_set_sent_at", {
      p_quote_id: detail.quote_id,
      p_sent_at: today,
      p_initials: initials.trim() || null,
    });
    setMarkingSent(false);
    if (error) { captureRpcError("eq_set_sent_at", error, { quote_id: detail.quote_id }); setDetailError(error.message); return; }
    // Auto-set follow-up to 7 days out if not already set
    if (!detail.follow_up_at) {
      const fupDate = new Date();
      fupDate.setDate(fupDate.getDate() + 7);
      const fupStr = fupDate.toISOString().slice(0, 10);
      await supabase.rpc("eq_set_follow_up_date", {
        p_quote_id: detail.quote_id,
        p_follow_up_at: fupStr,
        p_initials: initials.trim() || null,
      });
      setFollowUpInput(fupStr);
    }
    await openDetail(detail.quote_id);
    void loadQuotes(statusFilter, search);
  };

  const handleQuickWin = async () => {
    if (!supabase || !detail) return;
    setQuickWinBusy(true);
    const { error } = await supabase.rpc("eq_update_quote_status", {
      p_quote_id: detail.quote_id,
      p_new_status: "verbal-win",
      p_note: null,
      p_initials: initials.trim() || null,
    });
    setQuickWinBusy(false);
    if (error) { captureRpcError("eq_update_quote_status", error, { quote_id: detail.quote_id }); setDetailError(error.message); return; }
    await openDetail(detail.quote_id);
    void loadQuotes(statusFilter, search);
  };

  const handleQuickLose = async (reason?: string) => {
    if (!supabase || !detail) return;
    setQuickLoseBusy(true);
    const { error } = await supabase.rpc("eq_update_quote_status", {
      p_quote_id: detail.quote_id,
      p_new_status: "lost",
      p_note: reason?.trim() || null,
      p_initials: initials.trim() || null,
    });
    setQuickLoseBusy(false);
    setLosePromptOpen(false);
    setLoseReason("");
    if (error) { captureRpcError("eq_update_quote_status", error, { quote_id: detail.quote_id }); setDetailError(error.message); return; }
    await openDetail(detail.quote_id);
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

  const handleBulkFollowUp = async () => {
    if (!supabase || !bulkFupDate || selectedIds.size === 0) return;
    setBulkFupBusy(true);
    await Promise.all(Array.from(selectedIds).map((id) =>
      supabase!.rpc("eq_set_follow_up_date", { p_quote_id: id, p_follow_up_at: bulkFupDate, p_initials: initials.trim() || null })
    ));
    setBulkFupBusy(false);
    setBulkFupDate("");
    setSelectedIds(new Set());
    void loadQuotes(statusFilter, search);
  };

  // ── PDF import ───────────────────────────────────────────────────────────

  const handlePdfFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPdfParsing(true);
    setPdfParseErr(null);
    setPdfParseResult(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let b64 = '';
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        b64 += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      b64 = btoa(b64);
      const res = await fetch('/.netlify/functions/quote-parse-subcontractor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ file_base64: b64, mime_type: file.type || 'application/pdf', file_name: file.name }),
      });
      const j = await res.json() as {
        ok: boolean;
        supplier_name?: string;
        quote_ref?: string;
        project_name?: string;
        scope_summary?: string;
        address?: string;
        items?: ParsedSubItem[];
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setPdfParseErr(
          j.error === 'ai_not_configured' ? 'AI not configured on the server.'
          : j.error === 'file_too_large' ? 'File too large (max 10 MB).'
          : 'Could not read the PDF — try again.',
        );
        return;
      }
      if ((j.items ?? []).length === 0) {
        setPdfParseErr('No priced line items found in this document.');
        return;
      }
      setPdfParseResult({
        supplier_name: j.supplier_name,
        quote_ref: j.quote_ref,
        project_name: j.project_name,
        scope_summary: j.scope_summary,
        address: j.address,
        items: j.items ?? [],
      });
    } catch {
      setPdfParseErr('Could not read the PDF — try again.');
    } finally {
      setPdfParsing(false);
    }
  };

  const confirmPdfImport = () => {
    if (!pdfParseResult) return;
    const newItems: CreateLineItem[] = pdfParseResult.items.map((it) => ({
      description: it.description,
      qty: String(it.qty > 0 ? it.qty : 1),
      unit: it.unit,
      cost: it.unit_price > 0 ? it.unit_price.toFixed(2) : '',
      markup: '',
      rate: it.unit_price > 0 ? it.unit_price.toFixed(2) : '',
      category: 'subcontractor',
    }));
    setCreateLineItems((prev) => {
      const filtered = prev.filter((li) => li.category !== 'subcontractor' || li.description.trim());
      return [...filtered, ...newItems];
    });
    setPdfParseResult(null);
    setPdfParseErr(null);
  };

  const handlePdfFileStart = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPdfParsing(true);
    setPdfStartErr(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let b64 = '';
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        b64 += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      b64 = btoa(b64);
      const res = await fetch('/.netlify/functions/quote-parse-subcontractor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ file_base64: b64, mime_type: file.type || 'application/pdf', file_name: file.name }),
      });
      const j = await res.json() as {
        ok: boolean;
        supplier_name?: string;
        quote_ref?: string;
        project_name?: string;
        scope_summary?: string;
        address?: string;
        items?: ParsedSubItem[];
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setPdfStartErr(
          j.error === 'ai_not_configured' ? 'AI not configured on the server.'
          : j.error === 'file_too_large' ? 'File too large (max 10 MB).'
          : 'Could not read the PDF — try again.',
        );
        return;
      }
      if ((j.items ?? []).length === 0) {
        setPdfStartErr('No priced line items found in this document.');
        return;
      }
      resetCreateForm();
      if (j.project_name) setCreateProjectName(j.project_name);
      if (j.scope_summary) setCreateScope(j.scope_summary);
      if (j.address) setCreateAddress(j.address);
      const supplierNote = [
        j.supplier_name && `Subcontractor: ${j.supplier_name}`,
        j.quote_ref && `Supplier ref: ${j.quote_ref}`,
      ].filter(Boolean).join(' · ');
      if (supplierNote) setCreateClarifications(supplierNote);
      setCreateLineItems((j.items ?? []).map((it) => ({
        description: it.description,
        qty: String(it.qty > 0 ? it.qty : 1),
        unit: it.unit,
        cost: it.unit_price > 0 ? it.unit_price.toFixed(2) : '',
        markup: '',
        rate: it.unit_price > 0 ? it.unit_price.toFixed(2) : '',
        category: 'subcontractor' as const,
      })));
      setView('create');
    } catch {
      setPdfStartErr('Could not read the PDF — try again.');
    } finally {
      setPdfParsing(false);
    }
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
    if (error) { captureRpcError("eq_set_workbench_job_no", error, { quote_id: detail.quote_id }); setJobNoErr(error.message); setSavingJobNo(false); return; }
    // Auto-advance "won-awaiting-job-no" → "won-job-created" when a job number is saved
    if (detail.status === "won-awaiting-job-no") {
      await supabase.rpc("eq_update_quote_status", {
        p_quote_id: detail.quote_id,
        p_new_status: "won-job-created",
        p_note: null,
        p_initials: initials.trim() || null,
      });
    }
    setSavingJobNo(false);
    await openDetail(detail.quote_id);
    void loadQuotes(statusFilter, search);
  };

  const handleSaveSentAt = async () => {
    if (!supabase || !detail) return;
    setSavingSentAt(true);
    setSentAtErr(null);
    const sentAtValue = sentAtInput ? new Date(sentAtInput + "T00:00:00").toISOString() : null;
    const { error } = await supabase.rpc("eq_set_sent_at", {
      p_quote_id: detail.quote_id,
      p_sent_at: sentAtValue,
      p_initials: initials.trim() || null,
    });
    setSavingSentAt(false);
    if (error) { captureRpcError("eq_set_sent_at", error, { quote_id: detail.quote_id }); setSentAtErr(error.message); return; }
    await openDetail(detail.quote_id);
    void loadQuotes(statusFilter, search);
  };

  const handleSaveExpires = async () => {
    if (!supabase || !detail || !expiresInput) return;
    setSavingExpires(true);
    setExpiresErr(null);
    const { error } = await supabase.rpc("eq_set_expires_at", {
      p_quote_id: detail.quote_id,
      p_expires_at: new Date(expiresInput + "T00:00:00").toISOString(),
      p_initials: initials.trim() || null,
    });
    setSavingExpires(false);
    if (error) { captureRpcError("eq_set_expires_at", error, { quote_id: detail.quote_id }); setExpiresErr(error.message); return; }
    await openDetail(detail.quote_id);
    void loadQuotes(statusFilter, search);
  };

  const handleSaveFollowUp = async () => {
    if (!supabase || !detail) return;
    setSavingFollowUp(true);
    setFollowUpErr(null);
    const { error } = await supabase.rpc("eq_set_follow_up_date", {
      p_quote_id: detail.quote_id,
      p_follow_up_at: followUpInput || null,
      p_initials: initials.trim() || null,
    });
    setSavingFollowUp(false);
    if (error) { captureRpcError("eq_set_follow_up_date", error, { quote_id: detail.quote_id }); setFollowUpErr(error.message); return; }
    await openDetail(detail.quote_id);
    void loadQuotes(statusFilter, search);
  };

  const savePipelineFup = async (quoteId: string, dateStr: string) => {
    setPipelineFupEdit(null);
    if (!supabase) return;
    await supabase.rpc("eq_set_follow_up_date", {
      p_quote_id: quoteId,
      p_follow_up_at: dateStr || null,
      p_initials: initials.trim() || null,
    });
    void loadQuotes(statusFilter, search);
  };

  const savePipelineStatus = async (q: Quote, newStatus: string) => {
    setPipelineStatusEdit(null);
    if (!supabase || !newStatus || newStatus === q.status) return;
    const { error } = await supabase.rpc("eq_update_quote_status", {
      p_quote_id: q.quote_id,
      p_new_status: newStatus,
      p_note: null,
      p_initials: initials.trim() || null,
    });
    if (error) { captureRpcError("eq_update_quote_status", error, { quote_id: q.quote_id, new_status: newStatus }); return; }
    void loadQuotes(statusFilter, search);
  };

  const savePipelineJobNo = async (q: Quote, value: string) => {
    setPipelineJobNoEdit(null);
    const trimmed = value.trim();
    if (!supabase || !trimmed || trimmed === (q.workbench_job_no ?? "")) return;
    const { error } = await supabase.rpc("eq_set_workbench_job_no", {
      p_quote_id: q.quote_id,
      p_workbench_job_no: trimmed,
      p_initials: initials.trim() || null,
    });
    if (error) { captureRpcError("eq_set_workbench_job_no", error, { quote_id: q.quote_id }); return; }
    // Mirror the detail-panel rule: setting a job no on a won-awaiting quote advances it.
    if (q.status === "won-awaiting-job-no") {
      await supabase.rpc("eq_update_quote_status", {
        p_quote_id: q.quote_id,
        p_new_status: "won-job-created",
        p_note: null,
        p_initials: initials.trim() || null,
      });
    }
    void loadQuotes(statusFilter, search);
  };

  const savePipelinePoNo = async (q: Quote, value: string) => {
    setPipelinePoEdit(null);
    const trimmed = value.trim();
    if (!supabase || !trimmed || trimmed === (q.po_number ?? "")) return;
    const { error } = await supabase.rpc("eq_set_po_number", {
      p_quote_id: q.quote_id,
      p_po_number: trimmed,
      p_initials: initials.trim() || null,
    });
    if (error) { captureRpcError("eq_set_po_number", error, { quote_id: q.quote_id }); return; }
    if (q.status === "won-job-created") {
      await supabase.rpc("eq_update_quote_status", {
        p_quote_id: q.quote_id,
        p_new_status: "po-matched",
        p_note: null,
        p_initials: initials.trim() || null,
      });
    }
    void loadQuotes(statusFilter, search);
  };

  const resetSmartFilters = () => {
    setExpiringOnly(false); setUnsentOnly(false); setNeedsJobNoOnly(false);
    setOverdueFupOnly(false); setStaleOnly(false);
  };

  const handleSaveProject = async () => {
    if (!supabase || !detail) return;
    setSavingProject(true);
    setProjectErr(null);
    const { error } = await supabase.rpc("eq_set_quote_project", {
      p_quote_id:           detail.quote_id,
      p_project_name:       projectInput.trim() || null,
      p_estimator_name:     estimatorInput.trim() || null,
      p_estimator_initials: estInitialsInput.trim() || null,
      p_initials:           initials.trim() || null,
    });
    setSavingProject(false);
    if (error) { captureRpcError("eq_set_quote_project", error, { quote_id: detail.quote_id }); setProjectErr(error.message); return; }
    setProjectEditing(false);
    await openDetail(detail.quote_id);
    void loadQuotes(statusFilter, search);
  };

  const handleSaveTerms = async () => {
    if (!supabase || !detail) return;
    setSavingTerms(true);
    setTermsErr(null);
    const validityDays = validityInput.trim() ? parseInt(validityInput, 10) : null;
    const { error } = await supabase.rpc("eq_set_payment_terms", {
      p_quote_id:      detail.quote_id,
      p_payment_terms: termsInput.trim() || null,
      p_validity_days: validityDays && !isNaN(validityDays) ? validityDays : null,
      p_initials:      initials.trim() || null,
    });
    setSavingTerms(false);
    if (error) { captureRpcError("eq_set_payment_terms", error, { quote_id: detail.quote_id }); setTermsErr(error.message); return; }
    setTermsEditing(false);
    await openDetail(detail.quote_id);
  };

  const handleSaveRecipient = async () => {
    if (!supabase || !detail) return;
    setSavingRecipient(true);
    setRecipientErr(null);
    const { error } = await supabase.rpc("eq_set_quote_recipient", {
      p_quote_id:        detail.quote_id,
      p_attn_first_name: attnFirstInput.trim() || null,
      p_attn_name:       attnLastInput.trim() || null,
      p_attn_phone:      attnPhoneInput.trim() || null,
      p_address:         addressInput.trim() || null,
      p_initials:        initials.trim() || null,
    });
    setSavingRecipient(false);
    if (error) { captureRpcError("eq_set_quote_recipient", error, { quote_id: detail.quote_id }); setRecipientErr(error.message); return; }
    setRecipientEditing(false);
    await openDetail(detail.quote_id);
  };

  const handleSaveScope = async () => {
    if (!supabase || !detail) return;
    setSavingScope(true);
    setScopeErr(null);
    const { error } = await supabase.rpc("eq_set_quote_scope", {
      p_quote_id:       detail.quote_id,
      p_scope_of_works: scopeInput.trim() || null,
      p_clarifications: clarInput.trim() || null,
      p_quote_notes:    quoteNotesInput.trim() || null,
      p_initials:       initials.trim() || null,
    });
    setSavingScope(false);
    if (error) { captureRpcError("eq_set_quote_scope", error, { quote_id: detail.quote_id }); setScopeErr(error.message); return; }
    setScopeEditing(false);
    await openDetail(detail.quote_id);
  };

  const handleLinkContact = async (newContactId?: string) => {
    if (!supabase || !detail) return;
    const linkId = newContactId !== undefined ? newContactId : contactPickerVal;
    setLinkingContact(true);
    setLinkContactErr(null);
    const { error } = await supabase.rpc("eq_link_quote_contact", {
      p_quote_id: detail.quote_id,
      p_contact_id: linkId || null,
      p_initials: initials.trim() || null,
    });
    setLinkingContact(false);
    if (error) { captureRpcError("eq_link_quote_contact", error, { quote_id: detail.quote_id }); setLinkContactErr(error.message); return; }
    await openDetail(detail.quote_id);
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
    if (error) { captureRpcError("eq_set_po_number", error, { quote_id: detail.quote_id }); setPoErr(error.message); setSavingPo(false); return; }
    // Auto-advance "won-job-created" → "po-matched" when a PO number is saved
    if (detail.status === "won-job-created") {
      await supabase.rpc("eq_update_quote_status", {
        p_quote_id: detail.quote_id,
        p_new_status: "po-matched",
        p_note: null,
        p_initials: initials.trim() || null,
      });
    }
    setSavingPo(false);
    await openDetail(detail.quote_id);
    void loadQuotes(statusFilter, search);
  };

  const handleGenerateDoc = async () => {
    if (!supabase || !detail) return;
    await generateQuoteDoc(detail, docMode);
    await supabase.rpc("eq_add_quote_note", {
      p_quote_id: detail.quote_id,
      p_body: "Quote document generated",
      p_note_type: "system",
      p_initials: initials.trim() || null,
    });
    // Auto-mark sent if not already set
    if (!detail.sent_at) {
      const today = new Date().toISOString().slice(0, 10);
      await supabase.rpc("eq_set_sent_at", {
        p_quote_id: detail.quote_id,
        p_sent_at: new Date(today + "T00:00:00").toISOString(),
        p_initials: initials.trim() || null,
      });
      void loadQuotes(statusFilter, search);
    }
    await openDetail(detail.quote_id);
  };

  const handleDownloadPdf = async () => {
    if (!detail || !supabase) return;
    setDownloadingPdf(true);
    try {
      const res = await fetch("/.netlify/functions/quote-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_id: detail.quote_id }),
        credentials: "include",
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SKS Quote - ${detail.project_name || detail.quote_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      // Auto-mark sent if not already set
      if (!detail.sent_at) {
        const today = new Date().toISOString().slice(0, 10);
        await supabase.rpc("eq_set_sent_at", {
          p_quote_id: detail.quote_id,
          p_sent_at: new Date(today + "T00:00:00").toISOString(),
          p_initials: initials.trim() || null,
        });
        await openDetail(detail.quote_id);
        void loadQuotes(statusFilter, search);
      }
    } finally {
      setDownloadingPdf(false);
    }
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

  // Build: customer_name → Quote[] (respects active-only toggle)
  const effectiveAccordionQuotes = accordionActiveOnly
    ? accordionQuotes.filter((q) => ACCORDION_ACTIVE.has(q.status))
    : accordionQuotes;
  const quotesByCustomer = effectiveAccordionQuotes.reduce<Record<string, Quote[]>>((acc, q) => {
    const k = q.customer_name ?? "Unknown";
    (acc[k] ??= []).push(q);
    return acc;
  }, {});

  // ── Computed totals ───────────────────────────────────────────────────────

  const activeStage = STAGES.find((s) => s.key === statusFilter);
  let displayedQuotes = activeStage
    ? quotes.filter((q) => activeStage.match(q.status))
    : quotes.filter((q) => q.status === statusFilter); // backward-compat: a stored granular key
  if (dateFrom) displayedQuotes = displayedQuotes.filter((q) => q.created_at >= dateFrom);
  if (dateTo)   displayedQuotes = displayedQuotes.filter((q) => q.created_at.slice(0, 10) <= dateTo);
  if (estFilter) displayedQuotes = displayedQuotes.filter((q) => q.estimator_initials === estFilter);
  if (customerFilter) displayedQuotes = displayedQuotes.filter((q) => q.customer_name === customerFilter);
  if (siteFilter) displayedQuotes = displayedQuotes.filter((q) => q.site_code === siteFilter);
  if (expiringOnly) {
    const soon = new Date(Date.now() + 14 * 86_400_000).toISOString();
    displayedQuotes = displayedQuotes.filter(
      (q) => q.expires_at && q.expires_at <= soon && ["submitted", "client-reviewing", "on-hold", "verbal-win"].includes(q.status)
    );
  }
  if (unsentOnly) {
    displayedQuotes = displayedQuotes.filter(
      (q) => !q.sent_at && ["submitted", "client-reviewing", "on-hold", "verbal-win"].includes(q.status)
    );
  }
  if (needsJobNoOnly) {
    displayedQuotes = displayedQuotes.filter(
      (q) => !q.workbench_job_no && ACTIVE_JOB_STATUSES.has(q.status)
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  if (overdueFupOnly) {
    displayedQuotes = displayedQuotes.filter(
      (q) => q.follow_up_at !== null && q.follow_up_at <= today
    );
  }
  if (staleOnly) {
    const staleThreshold = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    displayedQuotes = displayedQuotes.filter(
      (q) => !CLOSED_STATUSES.has(q.status) && !ACTIVE_JOB_STATUSES.has(q.status) &&
             !q.follow_up_at && q.created_at.slice(0, 10) < staleThreshold
    );
  }
  const estimatorOptions = Array.from(
    new Set(quotes.map((q) => q.estimator_initials).filter((i): i is string => i !== null && i !== ""))
  ).sort();
  const customerOptions = Array.from(
    new Set(quotes.map((q) => q.customer_name).filter((n): n is string => n !== null && n !== ""))
  ).sort();
  const siteOptions = Array.from(
    new Set(quotes.map((q) => q.site_code).filter((s): s is string => s !== null && s !== ""))
  ).sort();
  const visibleTotal = displayedQuotes.reduce((s, q) => s + q.total_cents, 0);
  const activeFilterCount =
    (dateFrom || dateTo ? 1 : 0) + (estFilter ? 1 : 0) + (customerFilter ? 1 : 0) + (siteFilter ? 1 : 0) +
    (expiringOnly ? 1 : 0) + (unsentOnly ? 1 : 0) + (needsJobNoOnly ? 1 : 0) + (overdueFupOnly ? 1 : 0) + (staleOnly ? 1 : 0);
  // Keep refs fresh for keyboard handler
  detailIdRef.current = detailId;
  displayedQuotesRef.current = displayedQuotes;
  detailRef.current = detail;
  openEditFormRef.current = openEditForm;
  handleDuplicateRef.current = handleDuplicate;
  const wonTotal = displayedQuotes
    .filter((q) => ACTIVE_JOB_STATUSES.has(q.status))
    .reduce((s, q) => s + q.total_cents, 0);
  const atRiskTotal = displayedQuotes
    .filter((q) => ["submitted", "client-reviewing", "on-hold", "verbal-win"].includes(q.status))
    .reduce((s, q) => s + q.total_cents, 0);
  const winRateDisplayed = (() => {
    const won  = displayedQuotes.filter((q) => ACTIVE_JOB_STATUSES.has(q.status)).length;
    const lost = displayedQuotes.filter((q) => CLOSED_STATUSES.has(q.status)).length;
    const decided = won + lost;
    return decided >= 3 ? Math.round((won / decided) * 100) : null;
  })();

  // Canonical eq-ui table: sortable columns + per-column text/select filters.
  const pipelineColumns: TableColumn<Quote>[] = [
    {
      key: "quote_number", header: "Quote #",
      sortAccessor: (q) => q.quote_number,
      className: "eq-quotes__td--mono eq-quotes__td--bold",
      render: (q) => (
        <span
          className="eq-quotes__filter-link"
          title="Open quote"
          style={{ fontFamily: "ui-monospace, 'Cascadia Code', monospace", fontWeight: 600 }}
          onClick={(e) => {
            e.stopPropagation();
            void openDetail(q.quote_id);
          }}
        >
          {q.quote_number}
        </span>
      ),
    },
    {
      key: "customer_name", header: "Customer / Site", filterable: "text",
      sortAccessor: (q) => q.customer_name ?? "",
      render: (q) => (
        <div className="eq-quotes__customer-cell">
          {q.customer_name ? (
            <span
              className="eq-quotes__filter-link"
              title={`Filter by ${q.customer_name}`}
              onClick={(e) => { e.stopPropagation(); setCustomerFilter(q.customer_name ?? ""); }}
            >
              {q.customer_name}
            </span>
          ) : <span className="eq-quotes__muted">—</span>}
          {q.site_code && (
            <span
              className="eq-quotes__site-code eq-quotes__filter-link"
              title={`Filter by site ${q.site_code}`}
              onClick={(e) => { e.stopPropagation(); setSiteFilter(q.site_code ?? ""); }}
            >
              {q.site_code}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "project_name", header: "Project", filterable: "text",
      sortAccessor: (q) => q.project_name ?? "",
      render: (q) => (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>{q.project_name ?? <span className="eq-quotes__muted">—</span>}</span>
          {q.line_item_count === 0 && (
            <span className="eq-quotes__badge eq-quotes__badge--xs" style={{ background: "#fef2f2", color: "#c0392b", fontSize: 10, flexShrink: 0 }} title="No line items — add items before sending">
              no items
            </span>
          )}
        </span>
      ),
    },
    {
      key: "estimator_initials", header: "Est.",
      sortAccessor: (q) => q.estimator_initials ?? "",
      render: (q) => q.estimator_initials
        ? (
          <span
            className="eq-quotes__initials-badge eq-quotes__filter-link"
            title={`Filter by ${q.estimator_initials}`}
            onClick={(e) => { e.stopPropagation(); setEstFilter(q.estimator_initials ?? ""); }}
          >
            {q.estimator_initials}
          </span>
        )
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
        .filter((f) => f.key !== "all")
        .map((f) => ({ value: f.key, label: f.label })),
      sortAccessor: (q) => toSimpleLabel(q.status),
      render: (q) => {
        if (pipelineStatusEdit === q.quote_id) {
          const currentStage = STATUS_FILTERS.find((s) => s.key !== "all" && s.match(q.status));
          return (
            <select
              autoFocus
              value={currentStage?.key ?? ""}
              style={{ fontSize: 12, padding: "2px 4px", border: "1px solid var(--eq-primary, #3DA8D8)", borderRadius: 4 }}
              onChange={(e) => {
                const stage = STATUS_FILTERS.find((s) => s.key === e.target.value);
                if (stage?.internalStatus) void savePipelineStatus(q, stage.internalStatus);
              }}
              onBlur={() => setPipelineStatusEdit(null)}
              onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setPipelineStatusEdit(null); } }}
              onClick={(e) => e.stopPropagation()}
            >
              {STATUS_FILTERS.filter((s) => s.key !== "all").map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          );
        }
        return (
          <span
            className={`${statusClass(q.status)} eq-quotes__filter-link`}
            title="Click to change status"
            onClick={(e) => { e.stopPropagation(); setPipelineStatusEdit(q.quote_id); }}
          >
            {toSimpleLabel(q.status)}
          </span>
        );
      },
    },
    {
      key: "workbench_job_no", header: "Job No.",
      sortAccessor: (q) => q.workbench_job_no ?? "",
      render: (q) => {
        if (pipelineJobNoEdit?.quoteId === q.quote_id) {
          return (
            <input
              type="text"
              autoFocus
              value={pipelineJobNoEdit.value}
              placeholder="Job no."
              style={{ fontSize: 12, padding: "2px 4px", border: "1px solid var(--eq-primary, #3DA8D8)", borderRadius: 4, width: 90, fontFamily: "ui-monospace, 'Cascadia Code', monospace" }}
              onChange={(e) => setPipelineJobNoEdit({ quoteId: q.quote_id, value: e.target.value })}
              onBlur={(e) => { void savePipelineJobNo(q, e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.stopPropagation(); setPipelineJobNoEdit(null); }
                if (e.key === "Enter") { void savePipelineJobNo(q, pipelineJobNoEdit.value); }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          );
        }
        if (q.workbench_job_no) {
          return (
            <span
              className="eq-quotes__td--mono eq-quotes__filter-link"
              title="Click to change job number"
              onClick={(e) => { e.stopPropagation(); setPipelineJobNoEdit({ quoteId: q.quote_id, value: q.workbench_job_no ?? "" }); }}
            >
              {q.workbench_job_no}
            </span>
          );
        }
        return (
          <span
            className={ACTIVE_JOB_STATUSES.has(q.status)
              ? "eq-quotes__badge eq-quotes__badge--amber eq-quotes__badge--xs eq-quotes__filter-link"
              : "eq-quotes__muted eq-quotes__filter-link"}
            title="Click to add job number"
            onClick={(e) => { e.stopPropagation(); setPipelineJobNoEdit({ quoteId: q.quote_id, value: "" }); }}
          >
            {ACTIVE_JOB_STATUSES.has(q.status) ? "Needs no." : "—"}
          </span>
        );
      },
    },
    {
      key: "po_number", header: "PO",
      sortAccessor: (q) => q.po_number ?? "",
      render: (q) => {
        if (pipelinePoEdit?.quoteId === q.quote_id) {
          return (
            <input
              type="text"
              autoFocus
              value={pipelinePoEdit.value}
              placeholder="PO number"
              style={{ fontSize: 12, padding: "2px 4px", border: "1px solid var(--eq-primary, #3DA8D8)", borderRadius: 4, width: 110, fontFamily: "ui-monospace, 'Cascadia Code', monospace" }}
              onChange={(e) => setPipelinePoEdit({ quoteId: q.quote_id, value: e.target.value })}
              onBlur={(e) => { void savePipelinePoNo(q, e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.stopPropagation(); setPipelinePoEdit(null); }
                if (e.key === "Enter") { void savePipelinePoNo(q, pipelinePoEdit.value); }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          );
        }
        if (q.po_number) {
          return (
            <span
              className="eq-quotes__td--mono eq-quotes__filter-link"
              title="Click to change PO number"
              onClick={(e) => { e.stopPropagation(); setPipelinePoEdit({ quoteId: q.quote_id, value: q.po_number ?? "" }); }}
            >
              {q.po_number}
            </span>
          );
        }
        return (
          <span
            className="eq-quotes__muted eq-quotes__filter-link"
            title="Click to add PO number"
            onClick={(e) => { e.stopPropagation(); setPipelinePoEdit({ quoteId: q.quote_id, value: "" }); }}
          >
            —
          </span>
        );
      },
    },
    {
      key: "margin_pct", header: "Margin", align: "right" as const,
      sortAccessor: (q) => q.margin_pct ?? -1,
      render: (q) => q.margin_pct !== null
        ? <span style={{ fontSize: 12 }}>{Number(q.margin_pct).toFixed(1)}%</span>
        : <span className="eq-quotes__muted">—</span>,
    },
    {
      key: "created_at", header: "Age",
      sortAccessor: (q) => q.created_at,
      render: (q) => {
        const days = Math.floor((Date.now() - new Date(q.created_at).getTime()) / 86_400_000);
        const label = days === 0 ? "Today" : days === 1 ? "1d" : `${days}d`;
        const color = days > 90 ? "var(--eq-err, #c0392b)" : days > 30 ? "var(--eq-amber, #d4820a)" : undefined;
        return <span title={fmtDate(q.created_at)} style={{ fontSize: 12, color, fontWeight: days > 30 ? 600 : undefined }}>{label}</span>;
      },
    },
    {
      key: "sent_at", header: "Sent",
      sortAccessor: (q) => q.sent_at ?? "",
      render: (q) => fmtDate(q.sent_at),
    },
    {
      key: "expires_at", header: "Expires",
      sortAccessor: (q) => q.expires_at ?? "",
      render: (q) => {
        if (!q.expires_at) return <span className="eq-quotes__muted">—</span>;
        const { text, urgent, overdue } = fmtExpiry(q.expires_at);
        return (
          <span style={{
            fontSize: 12,
            fontWeight: urgent || overdue ? 600 : undefined,
            color: overdue ? "var(--eq-err, #c0392b)" : urgent ? "var(--eq-amber, #d4820a)" : undefined,
          }}>
            {text}
          </span>
        );
      },
    },
    {
      key: "_actions", header: "",
      render: (q) => {
        const items: DropdownMenuEntry[] = [
          { key: "dup",     label: "Duplicate", icon: <Copy size={14} />,    onClick: () => void handleDuplicate(q.quote_id) },
          { key: "archive", label: "Archive",   icon: <Archive size={14} />, onClick: () => void handleTrash(q.quote_id) },
          { key: "sep",     separator: true },
          { key: "delete",  label: "Delete permanently", icon: <Trash2 size={14} />, onClick: () => void handleDelete(q.quote_id, q.quote_number), variant: "danger" },
        ];
        return (
          <DropdownMenu
            trigger={
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--ghost eq-quotes__btn--icon"
                aria-label="More actions"
              >
                <MoreHorizontal size={15} />
              </button>
            }
            items={items}
          />
        );
      },
    },
    {
      key: "follow_up_at", header: "Follow-up",
      sortAccessor: (q) => q.follow_up_at ?? "",
      render: (q) => {
        if (pipelineFupEdit?.quoteId === q.quote_id) {
          return (
            <input
              type="date"
              autoFocus
              value={pipelineFupEdit.value}
              style={{ fontSize: 12, padding: "2px 4px", border: "1px solid var(--eq-primary, #3DA8D8)", borderRadius: 4, width: 120 }}
              onChange={(e) => setPipelineFupEdit({ quoteId: q.quote_id, value: e.target.value })}
              onBlur={(e) => { void savePipelineFup(q.quote_id, e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.stopPropagation(); setPipelineFupEdit(null); }
                if (e.key === "Enter") { void savePipelineFup(q.quote_id, pipelineFupEdit.value); }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          );
        }
        const todayStr = new Date().toISOString().slice(0, 10);
        if (!q.follow_up_at) {
          return (
            <span
              className="eq-quotes__muted eq-quotes__filter-link"
              title="Click to set follow-up date"
              onClick={(e) => { e.stopPropagation(); setPipelineFupEdit({ quoteId: q.quote_id, value: "" }); }}
            >
              Set date
            </span>
          );
        }
        const overdue = q.follow_up_at < todayStr;
        const isToday = q.follow_up_at === todayStr;
        return (
          <span
            className="eq-quotes__filter-link"
            title="Click to change follow-up date"
            onClick={(e) => { e.stopPropagation(); setPipelineFupEdit({ quoteId: q.quote_id, value: q.follow_up_at ?? "" }); }}
            style={{
              fontSize: 12,
              fontWeight: overdue || isToday ? 600 : undefined,
              color: overdue ? "var(--eq-err, #c0392b)" : isToday ? "var(--eq-amber, #d4820a)" : undefined,
            }}
          >
            {fmtDate(q.follow_up_at)}
          </span>
        );
      },
    },
  ];

  // Quote # and the actions column are always shown; everything else is toggleable.
  const LOCKED_COLS = new Set(["quote_number", "_actions"]);
  const visiblePipelineColumns = pipelineColumns.filter((c) => !hiddenCols.has(c.key));

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
              {(() => {
                const idx = displayedQuotes.findIndex((q) => q.quote_id === detail.quote_id);
                if (idx < 0 || displayedQuotes.length <= 1) return null;
                const prev = idx > 0 ? displayedQuotes[idx - 1] : null;
                const next = idx < displayedQuotes.length - 1 ? displayedQuotes[idx + 1] : null;
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="eq-quotes__btn eq-quotes__btn--outline"
                      style={{ padding: "2px 8px", fontSize: 14, lineHeight: 1 }}
                      disabled={!prev}
                      onClick={() => prev && void openDetail(prev.quote_id)}
                      title={prev ? `Previous: ${prev.quote_number}` : undefined}
                    >
                      ←
                    </button>
                    <span style={{ fontSize: 12, color: "var(--eq-muted, #888)", minWidth: 40, textAlign: "center" }}>
                      {idx + 1}/{displayedQuotes.length}
                    </span>
                    <button
                      type="button"
                      className="eq-quotes__btn eq-quotes__btn--outline"
                      style={{ padding: "2px 8px", fontSize: 14, lineHeight: 1 }}
                      disabled={!next}
                      onClick={() => next && void openDetail(next.quote_id)}
                      title={next ? `Next: ${next.quote_number}` : undefined}
                    >
                      →
                    </button>
                  </div>
                );
              })()}
              <h2
                className="eq-quotes__detail-num"
                style={{ cursor: "pointer" }}
                title="Click to copy quote number"
                onClick={() => void navigator.clipboard.writeText(detail.quote_number)}
              >
                {detail.quote_number}
              </h2>
              <span className={statusClass(detail.status)}>
                {STATUS_LABELS[detail.status] ?? detail.status}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--eq-ink, #1A1A2E)", marginLeft: 4 }}>
                {aud(detail.total_cents)}
              </span>
              {/* Row 1: Edit / Duplicate / Revise | Doc mode + Downloads */}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="eq-quotes__btn eq-quotes__btn--outline"
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
                {["submitted", "client-reviewing", "on-hold", "verbal-win"].includes(detail.status) && (
                  <button
                    type="button"
                    className="eq-quotes__btn eq-quotes__btn--outline"
                    disabled={duplicating}
                    onClick={() => void handleRevise()}
                    title="Supersede this quote and open a new draft revision"
                  >
                    {duplicating ? "…" : "Revise"}
                  </button>
                )}
                <span style={{ display: "inline-block", width: 1, height: 20, background: "var(--eq-border, #ddd)", margin: "0 2px" }} />
                <select
                  className="eq-quotes__select"
                  style={{ fontSize: 12, padding: "3px 6px" }}
                  value={docMode}
                  onChange={(e) => setDocMode(e.target.value as "detailed" | "summary" | "lump_sum")}
                  title="Line items table mode"
                >
                  <option value="detailed">Detailed</option>
                  <option value="summary">Summary</option>
                  <option value="lump_sum">Lump Sum</option>
                </select>
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
                  disabled={downloadingPdf}
                  onClick={() => void handleDownloadPdf()}
                  title="Download PDF"
                >
                  {downloadingPdf ? "…" : "Download PDF"}
                </button>
                <button
                  type="button"
                  className="eq-quotes__btn eq-quotes__btn--outline"
                  onClick={() => {
                    setShowEmailForm((v) => {
                      if (!v && detail) {
                        if (!emailToName.trim()) {
                          const name = [detail.attn_first_name, detail.attn_name].filter(Boolean).join(" ");
                          if (name) setEmailToName(name);
                        }
                        if (!emailTo.trim() && detail.contact_email) {
                          setEmailTo(detail.contact_email);
                        }
                      }
                      return !v;
                    });
                    setEmailMsg(null);
                  }}
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
              </div>
              {/* Row 2: Job + status actions + trash — wraps to second line */}
              <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", paddingTop: 4 }}>
                <button
                  type="button"
                  className="eq-quotes__btn eq-quotes__btn--outline"
                  disabled={jobCreationBusy}
                  onClick={async () => {
                    setJobCreationBusy(true);
                    setJobCreationErr(null);
                    try { await generateJobExcel(detail.quote_id); }
                    catch (e) { setJobCreationErr(e instanceof Error ? e.message : "Failed"); }
                    finally { setJobCreationBusy(false); }
                  }}
                >
                  {jobCreationBusy ? "…" : "Job Creation"}
                </button>
                {jobCreationErr && <span className="eq-quotes__inline-err">{jobCreationErr}</span>}
                {["draft", "submitted", "client-reviewing", "on-hold"].includes(detail.status) && (
                  <button
                    type="button"
                    className="eq-quotes__btn eq-quotes__btn--outline"
                    disabled={quickWinBusy}
                    onClick={() => void handleQuickWin()}
                    title="Mark as Verbal Win"
                    style={{ color: "var(--eq-sky, #2986B4)" }}
                  >
                    {quickWinBusy ? "…" : "Win"}
                  </button>
                )}
                {["draft", "submitted", "client-reviewing", "on-hold", "verbal-win"].includes(detail.status) && (
                  <button
                    type="button"
                    className="eq-quotes__btn eq-quotes__btn--outline"
                    disabled={quickLoseBusy}
                    onClick={() => setLosePromptOpen((o) => !o)}
                    title="Mark as Lost"
                    style={{ color: "var(--eq-err, #c0392b)" }}
                  >
                    {quickLoseBusy ? "…" : losePromptOpen ? "Cancel" : "Lose"}
                  </button>
                )}
                {!detail.sent_at && ["draft", "submitted", "client-reviewing", "on-hold", "verbal-win"].includes(detail.status) && (
                  <button
                    type="button"
                    className="eq-quotes__btn eq-quotes__btn--outline"
                    disabled={markingSent}
                    onClick={() => void handleMarkAsSent()}
                    title={detail.status === "draft" ? "Submit and mark as sent today" : "Mark as sent today"}
                  >
                    {markingSent ? "…" : detail.status === "draft" ? "Submit & Mark Sent" : "Mark as Sent"}
                  </button>
                )}
                <button
                  type="button"
                  className="eq-quotes__btn eq-quotes__btn--outline"
                  disabled={trashing}
                  onClick={() => void handleTrash(detail.quote_id)}
                  title="Archive this quote (recoverable from the Archived view)"
                  style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <Archive size={14} /> {trashing ? "…" : "Archive"}
                </button>
                <button
                  type="button"
                  className="eq-quotes__btn eq-quotes__btn--outline"
                  onClick={() => void handleDelete(detail.quote_id, detail.quote_number)}
                  title="Permanently delete this quote — cannot be undone"
                  style={{ color: "var(--eq-err, #c0392b)", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
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
          {/* Lose reason prompt */}
          {losePromptOpen && detail && (
            <div className="eq-quotes__detail-card" style={{ marginTop: 8, padding: "12px 16px" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label className="eq-quotes__info-label">Loss reason (optional)</label>
                  <datalist id="eq-loss-reasons">
                    <option value="Price" />
                    <option value="Timeline" />
                    <option value="No response" />
                    <option value="Competitor" />
                    <option value="Scope change" />
                    <option value="Budget cut" />
                    <option value="Deferred" />
                    <option value="Internal — not proceeding" />
                  </datalist>
                  <input
                    className="eq-quotes__input"
                    style={{ width: "100%" }}
                    list="eq-loss-reasons"
                    placeholder="e.g. Price, Timeline, No response…"
                    value={loseReason}
                    onChange={(e) => setLoseReason(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleQuickLose(loseReason); }}
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  className="eq-quotes__btn eq-quotes__btn--outline"
                  disabled={quickLoseBusy}
                  onClick={() => void handleQuickLose(loseReason)}
                  style={{ color: "var(--eq-err, #c0392b)" }}
                >
                  {quickLoseBusy ? "…" : "Confirm Loss"}
                </button>
                <button type="button" className="eq-quotes__btn eq-quotes__btn--outline" onClick={() => { setLosePromptOpen(false); setLoseReason(""); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {detailLoading && <div className="eq-quotes__loading">Loading…</div>}
        {detailError && <div className="eq-quotes__error-banner">{detailError}</div>}

        {detail && (
          <div className="eq-quotes__detail-body">
            {/* Expiry warning banner */}
            {detail.expires_at && ["submitted", "client-reviewing", "on-hold", "verbal-win"].includes(detail.status) && (() => {
              const { text, urgent, overdue } = fmtExpiry(detail.expires_at);
              if (!urgent && !overdue) return null;
              return (
                <div style={{
                  padding: "8px 14px", borderRadius: 6, marginBottom: 8, fontSize: 13, fontWeight: 600,
                  background: overdue ? "var(--eq-err-bg, #fdf1f1)" : "var(--eq-amber-bg, #fef9ee)",
                  color: overdue ? "var(--eq-err, #c0392b)" : "var(--eq-amber, #d4820a)",
                  border: `1px solid ${overdue ? "var(--eq-err, #c0392b)" : "var(--eq-amber, #d4820a)"}22`,
                }}>
                  {overdue ? `Quote expired ${text} — update the expiry date or close this quote` : `Quote expires in ${text} — follow up or extend`}
                </div>
              );
            })()}
            {/* Follow-up overdue banner */}
            {detail.follow_up_at && (() => {
              const todayStr = new Date().toISOString().slice(0, 10);
              const overdueFup = detail.follow_up_at < todayStr;
              const todayFup = detail.follow_up_at === todayStr;
              if (!overdueFup && !todayFup) return null;
              return (
                <div style={{
                  padding: "8px 14px", borderRadius: 6, marginBottom: 8, fontSize: 13, fontWeight: 600,
                  background: overdueFup ? "var(--eq-err-bg, #fdf1f1)" : "var(--eq-amber-bg, #fef9ee)",
                  color: overdueFup ? "var(--eq-err, #c0392b)" : "var(--eq-amber, #d4820a)",
                  border: `1px solid ${overdueFup ? "var(--eq-err, #c0392b)" : "var(--eq-amber, #d4820a)"}22`,
                }}>
                  {overdueFup
                    ? `Follow-up was due ${fmtDate(detail.follow_up_at)} — chase the client or update the date`
                    : `Follow-up due today — contact the client`}
                </div>
              );
            })()}
            {/* Info grid */}
            <div className="eq-quotes__detail-card">
              <div className="eq-quotes__info-grid">
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">Customer</span>
                  <span className="eq-quotes__info-val" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {detail.customer_name ?? "—"}
                    {detail.customer_name && (() => {
                      const others = quotes.filter((q) => q.customer_name === detail.customer_name && q.quote_id !== detail.quote_id);
                      if (others.length === 0) return null;
                      return (
                        <button
                          type="button"
                          style={{ background: "none", border: "none", color: "var(--eq-sky, #2986B4)", cursor: "pointer", fontSize: 11, padding: 0 }}
                          onClick={() => { setCustomerFilter(detail.customer_name!); setStatusFilter("all"); void loadQuotes("all", search); }}
                        >
                          +{others.length} other{others.length !== 1 ? "s" : ""}
                        </button>
                      );
                    })()}
                  </span>
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
                {!recipientEditing ? (
                  <>
                    <div className="eq-quotes__info-item">
                      <span className="eq-quotes__info-label">Attention</span>
                      <span className="eq-quotes__info-val">
                        {[detail.attn_first_name, detail.attn_name].filter(Boolean).join(" ") || <span className="eq-quotes__muted">—</span>}
                        <button
                          type="button"
                          className="eq-quotes__btn eq-quotes__btn--outline"
                          style={{ marginLeft: 8, fontSize: 12, padding: "2px 8px" }}
                          onClick={() => { setRecipientEditing(true); setRecipientErr(null); }}
                        >
                          Edit
                        </button>
                      </span>
                    </div>
                    {detail.attn_phone && (
                      <div className="eq-quotes__info-item">
                        <span className="eq-quotes__info-label">Phone</span>
                        <span className="eq-quotes__info-val">
                          <a href={`tel:${detail.attn_phone}`} style={{ textDecoration: "none", color: "inherit" }}>{detail.attn_phone}</a>
                        </span>
                      </div>
                    )}
                    {detail.contact_email && (
                      <div className="eq-quotes__info-item">
                        <span className="eq-quotes__info-label">Email</span>
                        <span className="eq-quotes__info-val">
                          <a href={`mailto:${detail.contact_email}`} style={{ color: "var(--eq-sky, #2986B4)" }}>{detail.contact_email}</a>
                        </span>
                      </div>
                    )}
                    {detail.address && (
                      <div className="eq-quotes__info-item eq-quotes__info-item--full">
                        <span className="eq-quotes__info-label">Address</span>
                        <span className="eq-quotes__info-val">{detail.address}</span>
                      </div>
                    )}
                    {(() => {
                      const siteIds = new Set(detailSiteContacts.map((c) => c.contact_id));
                      const allCts = [
                        ...detailSiteContacts,
                        ...detailContacts.filter((c) => !siteIds.has(c.contact_id)),
                      ];
                      if (allCts.length === 0) return null;
                      return (
                        <div className="eq-quotes__info-item eq-quotes__info-item--full">
                          <span className="eq-quotes__info-label">Site &amp; Customer Contacts</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                            {allCts.map((ct) => {
                              const name = [ct.first_name, ct.last_name].filter(Boolean).join(" ") || "—";
                              const isSite = siteIds.has(ct.contact_id);
                              const isSelected = contactPickerVal === ct.contact_id;
                              return (
                                <button
                                  key={ct.contact_id}
                                  type="button"
                                  style={{
                                    borderRadius: 20, padding: "4px 12px", fontSize: 12,
                                    border: `1px solid ${isSelected ? "var(--eq-sky, #2986B4)" : "var(--eq-border, #ddd)"}`,
                                    background: isSelected ? "var(--eq-ice, #EAF5FB)" : "#fff",
                                    color: "var(--eq-ink, #1A1A2E)", cursor: "pointer",
                                    display: "flex", alignItems: "center", gap: 4,
                                  }}
                                  onClick={() => {
                                    setContactPickerVal(ct.contact_id);
                                    setRecipientEditing(true);
                                    setAttnFirstInput(ct.first_name ?? "");
                                    setAttnLastInput(ct.last_name ?? "");
                                    setAttnPhoneInput(ct.mobile_phone ?? ct.work_phone ?? "");
                                  }}
                                  title={ct.email ?? undefined}
                                >
                                  {name}
                                  {isSite && <span title="Site contact" style={{ fontSize: 10 }}>📍</span>}
                                  {ct.is_default_quote_contact && <span title="Default" style={{ fontSize: 10 }}>★</span>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <div className="eq-quotes__info-item eq-quotes__info-item--full">
                    <span className="eq-quotes__info-label">Recipient</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                      {detail.contact_id && (() => {
                        const linked = detailContacts.find((c) => c.contact_id === detail.contact_id);
                        if (!linked) return null;
                        return (
                          <button
                            type="button"
                            className="eq-quotes__btn eq-quotes__btn--outline"
                            style={{ alignSelf: "flex-start", fontSize: 12 }}
                            onClick={() => {
                              setAttnFirstInput(linked.first_name ?? "");
                              setAttnLastInput(linked.last_name ?? "");
                              setAttnPhoneInput(linked.mobile_phone ?? linked.work_phone ?? "");
                            }}
                          >
                            Use linked contact: {[linked.first_name, linked.last_name].filter(Boolean).join(" ")}
                          </button>
                        );
                      })()}
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          className="eq-quotes__input"
                          placeholder="First name"
                          value={attnFirstInput}
                          onChange={(e) => setAttnFirstInput(e.target.value)}
                        />
                        <input
                          className="eq-quotes__input"
                          placeholder="Last name"
                          value={attnLastInput}
                          onChange={(e) => setAttnLastInput(e.target.value)}
                        />
                      </div>
                      <input
                        className="eq-quotes__input"
                        placeholder="Phone"
                        value={attnPhoneInput}
                        onChange={(e) => setAttnPhoneInput(e.target.value)}
                      />
                      <textarea
                        className="eq-quotes__input"
                        placeholder="Delivery address"
                        rows={3}
                        value={addressInput}
                        onChange={(e) => setAddressInput(e.target.value)}
                        style={{ resize: "vertical" }}
                      />
                      <div className="eq-quotes__job-no-row">
                        <button
                          type="button"
                          className="eq-quotes__btn eq-quotes__btn--primary"
                          disabled={savingRecipient}
                          onClick={() => void handleSaveRecipient()}
                        >
                          {savingRecipient ? "…" : "Save"}
                        </button>
                        <button
                          type="button"
                          className="eq-quotes__btn eq-quotes__btn--outline"
                          disabled={savingRecipient}
                          onClick={() => { setRecipientEditing(false); setRecipientErr(null); }}
                        >
                          Cancel
                        </button>
                      </div>
                      {recipientErr && <span className="eq-quotes__err">{recipientErr}</span>}
                    </div>
                  </div>
                )}
                {detailContacts.length > 0 && (
                  <div className="eq-quotes__info-item eq-quotes__info-item--full">
                    <span className="eq-quotes__info-label">Contact</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: 4 }}>
                      {[{ contact_id: "", first_name: "None", last_name: null, email: null, is_default_quote_contact: false, mobile_phone: null, work_phone: null, contact_position: null } as ContactRow,
                        ...detailContacts].map((c) => {
                        const name = c.contact_id === "" ? "None" : ([c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Unknown");
                        const isSelected = contactPickerVal === c.contact_id;
                        return (
                          <button
                            key={c.contact_id || "none"}
                            type="button"
                            disabled={linkingContact}
                            onClick={() => {
                              setContactPickerVal(c.contact_id);
                              void handleLinkContact(c.contact_id);
                            }}
                            style={{
                              fontSize: "0.82rem", padding: "4px 12px", borderRadius: "20px",
                              border: `1px solid ${isSelected ? "var(--eq-deep, #2986B4)" : "var(--eq-border, #ddd)"}`,
                              background: isSelected ? "var(--eq-ice, #EAF5FB)" : "#fff",
                              color: isSelected ? "var(--eq-ink, #1A1A2E)" : "var(--eq-muted, #666)",
                              cursor: linkingContact ? "wait" : "pointer",
                              fontWeight: isSelected ? 600 : undefined,
                            }}
                          >
                            {name}
                            {c.is_default_quote_contact && <span style={{ marginLeft: 4, color: "var(--eq-sky, #3DA8D8)" }}>★</span>}
                          </button>
                        );
                      })}
                    </div>
                    {linkContactErr && <span className="eq-quotes__err">{linkContactErr}</span>}
                  </div>
                )}
                {!projectEditing ? (
                  <>
                    <div className="eq-quotes__info-item">
                      <span className="eq-quotes__info-label">Project</span>
                      <span className="eq-quotes__info-val">
                        {detail.project_name ?? <span className="eq-quotes__muted">—</span>}
                        <button
                          type="button"
                          className="eq-quotes__btn eq-quotes__btn--outline"
                          style={{ marginLeft: 8, fontSize: 12, padding: "2px 8px" }}
                          onClick={() => { setProjectEditing(true); setProjectErr(null); }}
                        >
                          Edit
                        </button>
                      </span>
                    </div>
                    <div className="eq-quotes__info-item">
                      <span className="eq-quotes__info-label">Estimator</span>
                      <span className="eq-quotes__info-val">
                        {detail.estimator_name ?? <span className="eq-quotes__muted">—</span>}
                        {detail.estimator_initials && (
                          <span className="eq-quotes__initials-badge">{detail.estimator_initials}</span>
                        )}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="eq-quotes__info-item eq-quotes__info-item--full" style={{ gap: 8 }}>
                    <span className="eq-quotes__info-label">Project / Estimator</span>
                    <input
                      className="eq-quotes__input"
                      style={{ maxWidth: 340 }}
                      value={projectInput}
                      onChange={(e) => setProjectInput(e.target.value)}
                      placeholder="Project name"
                    />
                    <div className="eq-quotes__job-no-row" style={{ marginTop: 4 }}>
                      <input
                        className="eq-quotes__input"
                        style={{ maxWidth: 220 }}
                        value={estimatorInput}
                        onChange={(e) => setEstimatorInput(e.target.value)}
                        placeholder="Estimator name"
                      />
                      <input
                        className="eq-quotes__input eq-quotes__input--sm"
                        style={{ maxWidth: 72, textTransform: "uppercase" }}
                        value={estInitialsInput}
                        onChange={(e) => setEstInitialsInput(e.target.value.toUpperCase())}
                        placeholder="Init"
                        maxLength={4}
                      />
                      <button
                        type="button"
                        className="eq-quotes__btn eq-quotes__btn--primary"
                        disabled={savingProject}
                        onClick={() => void handleSaveProject()}
                      >
                        {savingProject ? "…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="eq-quotes__btn eq-quotes__btn--outline"
                        disabled={savingProject}
                        onClick={() => { setProjectEditing(false); setProjectErr(null); }}
                      >
                        Cancel
                      </button>
                    </div>
                    {projectErr && <span className="eq-quotes__err">{projectErr}</span>}
                  </div>
                )}
                <div className="eq-quotes__info-item eq-quotes__info-item--full">
                  <span className="eq-quotes__info-label">Sent</span>
                  <div className="eq-quotes__job-no-row">
                    <input
                      className="eq-quotes__input eq-quotes__input--job-no"
                      type="date"
                      value={sentAtInput}
                      onChange={(e) => setSentAtInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleSaveSentAt(); }}
                    />
                    <button
                      type="button"
                      className="eq-quotes__btn eq-quotes__btn--primary"
                      disabled={savingSentAt || sentAtInput === (detail.sent_at ? detail.sent_at.slice(0, 10) : "")}
                      onClick={() => void handleSaveSentAt()}
                    >
                      {savingSentAt ? "…" : "Save"}
                    </button>
                    {sentAtInput && (
                      <button
                        type="button"
                        className="eq-quotes__btn eq-quotes__btn--outline"
                        disabled={savingSentAt}
                        onClick={() => setSentAtInput("")}
                        title="Clear sent date"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {sentAtErr && <span className="eq-quotes__err">{sentAtErr}</span>}
                </div>
                <div className="eq-quotes__info-item eq-quotes__info-item--full">
                  <span className="eq-quotes__info-label">Expires</span>
                  <div className="eq-quotes__job-no-row">
                    <input
                      className="eq-quotes__input eq-quotes__input--job-no"
                      type="date"
                      value={expiresInput}
                      onChange={(e) => setExpiresInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleSaveExpires(); }}
                    />
                    <button
                      type="button"
                      className="eq-quotes__btn eq-quotes__btn--primary"
                      disabled={savingExpires || expiresInput === (detail.expires_at ? detail.expires_at.slice(0, 10) : "")}
                      onClick={() => void handleSaveExpires()}
                    >
                      {savingExpires ? "…" : "Save"}
                    </button>
                  </div>
                  {expiresErr && <span className="eq-quotes__err">{expiresErr}</span>}
                </div>
                <div className="eq-quotes__info-item eq-quotes__info-item--full">
                  <span className="eq-quotes__info-label">Follow-up date</span>
                  <div className="eq-quotes__job-no-row">
                    <input
                      className="eq-quotes__input eq-quotes__input--job-no"
                      type="date"
                      value={followUpInput}
                      onChange={(e) => setFollowUpInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleSaveFollowUp(); }}
                      title="Set a reminder to follow up on this quote"
                    />
                    <button
                      type="button"
                      className="eq-quotes__btn eq-quotes__btn--primary"
                      disabled={savingFollowUp || followUpInput === (detail.follow_up_at ? detail.follow_up_at.slice(0, 10) : "")}
                      onClick={() => void handleSaveFollowUp()}
                    >
                      {savingFollowUp ? "…" : "Save"}
                    </button>
                    {followUpInput && (
                      <button
                        type="button"
                        className="eq-quotes__btn eq-quotes__btn--outline"
                        disabled={savingFollowUp}
                        onClick={() => { setFollowUpInput(""); void (async () => { await supabase?.rpc("eq_set_follow_up_date", { p_quote_id: detail.quote_id, p_follow_up_at: null, p_initials: initials.trim() || null }); await openDetail(detail.quote_id); void loadQuotes(statusFilter, search); })(); }}
                        title="Clear follow-up date"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {followUpErr && <span className="eq-quotes__err">{followUpErr}</span>}
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
                {!termsEditing ? (
                  <div className="eq-quotes__info-item">
                    <span className="eq-quotes__info-label">Payment Terms</span>
                    <span className="eq-quotes__info-val">
                      {detail.payment_terms ?? <span className="eq-quotes__muted">—</span>}
                      {detail.validity_days != null && (
                        <span className="eq-quotes__muted" style={{ marginLeft: 6, fontSize: 12 }}>
                          ({detail.validity_days}d validity)
                        </span>
                      )}
                      <button
                        type="button"
                        className="eq-quotes__btn eq-quotes__btn--outline"
                        style={{ marginLeft: 8, fontSize: 12, padding: "2px 8px" }}
                        onClick={() => { setTermsEditing(true); setTermsErr(null); }}
                      >
                        Edit
                      </button>
                    </span>
                  </div>
                ) : (
                  <div className="eq-quotes__info-item eq-quotes__info-item--full" style={{ gap: 6 }}>
                    <span className="eq-quotes__info-label">Payment Terms / Validity</span>
                    <div className="eq-quotes__job-no-row">
                      <input
                        className="eq-quotes__input"
                        style={{ maxWidth: 280 }}
                        value={termsInput}
                        onChange={(e) => setTermsInput(e.target.value)}
                        placeholder="e.g. Net 30 days"
                      />
                      <input
                        className="eq-quotes__input eq-quotes__input--sm"
                        style={{ maxWidth: 80 }}
                        type="number"
                        min={1}
                        value={validityInput}
                        onChange={(e) => setValidityInput(e.target.value)}
                        placeholder="Days"
                        title="Validity days"
                      />
                      <button
                        type="button"
                        className="eq-quotes__btn eq-quotes__btn--primary"
                        disabled={savingTerms}
                        onClick={() => void handleSaveTerms()}
                      >
                        {savingTerms ? "…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="eq-quotes__btn eq-quotes__btn--outline"
                        disabled={savingTerms}
                        onClick={() => { setTermsEditing(false); setTermsErr(null); }}
                      >
                        Cancel
                      </button>
                    </div>
                    {termsErr && <span className="eq-quotes__err">{termsErr}</span>}
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
                {detail.client_accepted_at && (
                  <div className="eq-quotes__info-item eq-quotes__info-item--full">
                    <span className="eq-quotes__info-label">Client Accepted</span>
                    <span className="eq-quotes__info-val" style={{ color: "var(--eq-deep, #2986B4)", fontWeight: 600 }}>
                      {detail.client_accepted_by ? `${detail.client_accepted_by} · ` : ""}{fmtDate(detail.client_accepted_at)}
                    </span>
                  </div>
                )}
                {detail.client_declined_at && (
                  <div className="eq-quotes__info-item eq-quotes__info-item--full">
                    <span className="eq-quotes__info-label">Client Declined</span>
                    <span className="eq-quotes__info-val" style={{ color: "var(--eq-err)" }}>
                      {fmtDate(detail.client_declined_at)}
                    </span>
                  </div>
                )}
                <div className="eq-quotes__info-item">
                  <span className="eq-quotes__info-label">Created</span>
                  <span className="eq-quotes__info-val">{fmtDate(detail.created_at)}</span>
                </div>
                {(() => {
                  const dupEntry = audit.find((a) => a.action === "duplicate" && a.changes?.source_quote_number);
                  if (!dupEntry) return null;
                  return (
                    <div className="eq-quotes__info-item eq-quotes__info-item--full">
                      <span className="eq-quotes__info-label">Based on</span>
                      <span className="eq-quotes__info-val eq-quotes__td--mono" style={{ fontSize: 13 }}>
                        {String(dupEntry.changes!.source_quote_number)}
                      </span>
                    </div>
                  );
                })()}
              </div>

              {!scopeEditing ? (
                <>
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
                  {detail.quote_notes && (
                    <div className="eq-quotes__scope">
                      <span className="eq-quotes__info-label">Terms &amp; Notes</span>
                      <p className="eq-quotes__scope-text">{detail.quote_notes}</p>
                    </div>
                  )}
                  <button
                    type="button"
                    className="eq-quotes__btn eq-quotes__btn--outline"
                    style={{ marginTop: 8, fontSize: 12 }}
                    onClick={() => {
                      setScopeInput(detail.scope_of_works ?? "");
                      setClarInput(detail.clarifications ?? "");
                      setQuoteNotesInput(detail.quote_notes ?? "");
                      setScopeEditing(true);
                    }}
                  >
                    Edit scope
                  </button>
                </>
              ) : (
                <div className="eq-quotes__scope">
                  <div style={{ marginBottom: 10 }}>
                    <span className="eq-quotes__info-label">Scope of Works</span>
                    <textarea
                      className="eq-quotes__input"
                      style={{ width: "100%", minHeight: 120, resize: "vertical", fontFamily: "inherit", fontSize: 13, marginTop: 4 }}
                      value={scopeInput}
                      onChange={(e) => setScopeInput(e.target.value)}
                    />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <span className="eq-quotes__info-label">Clarifications</span>
                    <textarea
                      className="eq-quotes__input"
                      style={{ width: "100%", minHeight: 60, resize: "vertical", fontFamily: "inherit", fontSize: 13, marginTop: 4 }}
                      value={clarInput}
                      onChange={(e) => setClarInput(e.target.value)}
                    />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <span className="eq-quotes__info-label">Terms &amp; Notes</span>
                    <textarea
                      className="eq-quotes__input"
                      style={{ width: "100%", minHeight: 60, resize: "vertical", fontFamily: "inherit", fontSize: 13, marginTop: 4 }}
                      value={quoteNotesInput}
                      onChange={(e) => setQuoteNotesInput(e.target.value)}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="eq-quotes__btn eq-quotes__btn--primary"
                      disabled={savingScope}
                      onClick={() => void handleSaveScope()}
                    >
                      {savingScope ? "…" : "Save"}
                    </button>
                    <button
                      type="button"
                      className="eq-quotes__btn eq-quotes__btn--outline"
                      disabled={savingScope}
                      onClick={() => { setScopeEditing(false); setScopeErr(null); }}
                    >
                      Cancel
                    </button>
                  </div>
                  {scopeErr && <span className="eq-quotes__err">{scopeErr}</span>}
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
                        <th className="eq-quotes__th--right" style={{ width: 90 }}>Cost</th>
                        <th className="eq-quotes__th--right" style={{ width: 90 }}>Rate</th>
                        <th className="eq-quotes__th--right" style={{ width: 64 }}>Mkup%</th>
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
                              <td colSpan={8} className="eq-quotes__group-label">
                                {CAT_LABELS[cat] ?? cat}
                              </td>
                            </tr>
                            {items.map((li) => {
                              const mkup = li.cost_rate_cents > 0 && li.unit_rate_cents > 0
                                ? computeMarkupPct(li.cost_rate_cents, li.unit_rate_cents)
                                : null;
                              return (
                              <tr key={li.line_number}>
                                <td className="eq-quotes__td--mono">{li.line_number}</td>
                                <td>{li.description}</td>
                                <td className="eq-quotes__td--right">{qty(li.quantity_thousandths)}</td>
                                <td>{li.unit ?? <span className="eq-quotes__muted">—</span>}</td>
                                <td className="eq-quotes__td--right eq-quotes__muted">
                                  {li.cost_rate_cents > 0 ? aud(li.cost_rate_cents) : <span>—</span>}
                                </td>
                                <td className="eq-quotes__td--right">{aud(li.unit_rate_cents)}</td>
                                <td className="eq-quotes__td--right" style={{ fontSize: 12, color: mkup !== null && mkup < 0 ? "var(--eq-err, #c0392b)" : undefined }}>
                                  {mkup !== null ? `${mkup.toFixed(1)}%` : <span className="eq-quotes__muted">—</span>}
                                </td>
                                <td className="eq-quotes__td--right eq-quotes__td--bold">{aud(li.line_total_cents)}</td>
                              </tr>
                              );
                            })}
                            <tr className="eq-quotes__row--cat-subtotal">
                              <td colSpan={7} className="eq-quotes__td--right">
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
                {(() => {
                  const hints: Record<string, string> = {
                    "draft": "Ready to send? Submit to client.",
                    "submitted": "Waiting for client response — follow up if no reply.",
                    "client-reviewing": "Client has the quote — awaiting their decision.",
                    "on-hold": "On hold — check back in with the client.",
                    "verbal-win": "Won verbally — enter the Workbench Job No. to advance.",
                    "won-awaiting-job-no": "Enter the Workbench Job No. to mark the job as created.",
                    "won-job-created": "Record the PO number when received from client.",
                  };
                  const hint = hints[detail.status];
                  return hint ? (
                    <p style={{ fontSize: 12, color: "var(--eq-muted, #888)", marginBottom: 8 }}>{hint}</p>
                  ) : null;
                })()}
                <div className="eq-quotes__initials-row">
                  <label className="eq-quotes__label">
                    Your initials
                    <input
                      className="eq-quotes__input eq-quotes__input--sm"
                      style={{ textTransform: "uppercase" }}
                      value={initials}
                      onChange={(e) => updateInitials(e.target.value)}
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
                  {advanceStatus === "lost" && (
                    <input
                      className="eq-quotes__input eq-quotes__input--note"
                      list="eq-loss-reasons"
                      placeholder="Loss reason…"
                      value={statusNote}
                      onChange={(e) => setStatusNote(e.target.value)}
                    />
                  )}
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
                          {n.note_type === "status-change" ? "status"
                            : n.note_type === "manual" ? "note"
                            : n.note_type === "system" ? "auto"
                            : n.note_type}
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
            <div style={{ padding: "8px 0", textAlign: "center", fontSize: 11, color: "var(--eq-muted, #aaa)" }}>
              ← → to navigate · Esc to close · N to create new quote
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Computed create totals ────────────────────────────────────────────────

  const createSubtotal = createLineItems.reduce((s, li) => s + calcLineTotal(li), 0);
  const createGst = Math.round(createSubtotal / 10);
  const createTotal = createSubtotal + createGst;
  const createCost = createLineItems.reduce(
    (s, li) => s + lineTotalCentsFromInput(parseFloat(li.qty) || 1, parseFloat(li.cost) || 0),
    0,
  );
  const createMarginPct = createCost > 0 && createSubtotal > 0
    ? Math.round(((createSubtotal - createCost) / createSubtotal) * 100)
    : null;
  const catSubtotals = (() => {
    const map = new Map<string, number>();
    for (const li of createLineItems) {
      const cat = li.category || "other";
      const t = calcLineTotal(li);
      if (t > 0) map.set(cat, (map.get(cat) ?? 0) + t);
    }
    return map.size >= 2 ? map : null;
  })();

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
    // Quote number is required. New quotes must carry the SKS- prefix; existing
    // quotes (some legacy EQ-…) only need to be non-empty when edited.
    const trimmedQuoteNo = createQuoteNumber.trim();
    const quoteNumberValid = trimmedQuoteNo.length > 0;
    const handleCancelCreateEdit = () => {
      const savedId = editingQuoteId;
      resetCreateForm();
      setView("pipeline");
      if (savedId) void openDetail(savedId);
    };
    return (
      <>
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
          {/* Draft restore banner — visible on create only when a saved draft exists */}
          {!isEditMode && showDraftBanner && (() => {
            let draftTime = "";
            try {
              const raw = localStorage.getItem(DRAFT_KEY);
              if (raw) {
                const savedAt = (JSON.parse(raw) as { savedAt?: string }).savedAt;
                if (savedAt) {
                  const d = new Date(savedAt);
                  draftTime = d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
                }
              }
            } catch { /* ignore */ }
            return (
              <div style={{
                marginBottom: 14, padding: "10px 16px",
                background: "#EAF5FB", border: "1px solid #b3d9ee",
                borderRadius: 8, display: "flex", alignItems: "center",
                gap: 12, fontSize: 13,
              }}>
                <span style={{ flex: 1 }}>
                  You have an unsaved draft{draftTime ? ` from ${draftTime}` : ""}. Restore it?
                </span>
                <button
                  type="button"
                  className="eq-quotes__btn eq-quotes__btn--primary"
                  style={{ padding: "5px 14px", fontSize: 13 }}
                  onClick={restoreDraft}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="eq-quotes__btn"
                  style={{ padding: "5px 14px", fontSize: 13 }}
                  onClick={clearDraft}
                >
                  Discard
                </button>
              </div>
            );
          })()}

          {/* PDF import — visible on create only (not edit) */}
          {!isEditMode && (
            <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <label
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", borderRadius: 6, fontSize: 13,
                  border: "1px solid var(--eq-border, #ddd)", background: "#fff",
                  cursor: pdfParsing ? "default" : "pointer",
                  color: pdfParsing ? "var(--eq-muted)" : "var(--eq-ink)",
                  opacity: pdfParsing ? 0.7 : 1,
                }}
                title="Upload a PDF quote to auto-fill the form"
              >
                {pdfParsing ? "⏳ Parsing PDF…" : "⬆ Import from PDF"}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  style={{ display: "none" }}
                  disabled={pdfParsing}
                  onChange={(e) => { void handlePdfImport(e); }}
                />
              </label>
              {pdfParseErr && (
                <span className="eq-quotes__inline-err">{pdfParseErr}</span>
              )}
            </div>
          )}

          {/* Quote details */}
          <div className="eq-quotes__detail-card">
            <h3 className="eq-quotes__section-title">Quote Details</h3>
            <div className="eq-quotes__info-grid">
              <div className="eq-quotes__info-item">
                <span className="eq-quotes__info-label">
                  Quote Number <span style={{ color: "var(--eq-err)", fontWeight: 700 }}>*</span>
                </span>
                <input
                  className="eq-quotes__input eq-quotes__td--mono"
                  style={{ maxWidth: 220 }}
                  value={createQuoteNumber}
                  onChange={(e) => setCreateQuoteNumber(e.target.value)}
                  placeholder="SKS-16951"
                />
                {!quoteNumberValid && (
                  <span className="eq-quotes__inline-err" style={{ fontSize: 11 }}>
                    Quote number is required.
                  </span>
                )}
              </div>
              <div className="eq-quotes__info-item eq-quotes__info-item--full">
                <span className="eq-quotes__info-label">
                  Customer <span style={{ color: "var(--eq-err)", fontWeight: 700 }}>*</span>
                </span>
                {customersLoading ? (
                  <span className="eq-quotes__muted" style={{ fontSize: 14 }}>Loading…</span>
                ) : (
                  <>
                    <datalist id="eq-form-customers">
                      {customers.map((c) => <option key={c.customer_id} value={c.company_name} />)}
                    </datalist>
                    <input
                      className="eq-quotes__input"
                      style={{ maxWidth: 440 }}
                      list="eq-form-customers"
                      placeholder="Type to search customers…"
                      value={createCustomerSearch}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCreateCustomerSearch(val);
                        const match = customers.find((c) => c.company_name === val);
                        if (match) {
                          if (match.customer_id !== createCustomerId) {
                            setCreateCustomerId(match.customer_id);
                            setCreateSiteId("");
                            setCreateSiteSearch("");
                            setSiteContactsForForm([]);
                            void loadSites(match.customer_id);
                            if (supabase) {
                              void supabase.rpc("eq_list_contacts_for_customer", { p_customer_id: match.customer_id }).then(({ data }) => {
                                setCreateContacts((data as ContactRow[]) ?? []);
                              });
                            }
                          }
                        } else {
                          setCreateCustomerId("");
                          setCreateSiteId("");
                          setCreateSiteSearch("");
                          setSites([]);
                          setCreateContacts([]);
                          setSiteContactsForForm([]);
                        }
                      }}
                    />
                  </>
                )}
              </div>
              <div className="eq-quotes__info-item eq-quotes__info-item--full">
                <span className="eq-quotes__info-label">Site</span>
                {sitesLoading ? (
                  <span className="eq-quotes__muted" style={{ fontSize: 14 }}>Loading…</span>
                ) : (
                  <>
                    <datalist id="eq-form-sites">
                      {sites.map((s) => <option key={s.site_id} value={`${s.name}${s.code ? ` [${s.code}]` : ""}`} />)}
                    </datalist>
                    <input
                      className="eq-quotes__input"
                      style={{ maxWidth: 440 }}
                      list="eq-form-sites"
                      placeholder={createCustomerId ? (sites.length === 0 ? "No sites — type to set" : "Type to search sites…") : "Select a customer first"}
                      disabled={!createCustomerId}
                      value={createSiteSearch}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCreateSiteSearch(val);
                        const match = sites.find((s) => `${s.name}${s.code ? ` [${s.code}]` : ""}` === val || s.name === val);
                        if (match) {
                          if (match.site_id !== createSiteId) {
                            setCreateSiteId(match.site_id);
                            void loadSiteContactsForForm(match.site_id);
                          }
                        } else {
                          setCreateSiteId("");
                          setSiteContactsForForm([]);
                        }
                      }}
                    />
                  </>
                )}
              </div>
              {/* Site contact slicer — shown when a customer (and optionally site) is selected */}
              {createCustomerId && (() => {
                const siteIds = new Set(siteContactsForForm.map((c) => c.contact_id));
                const allContacts = [
                  ...siteContactsForForm,
                  ...createContacts.filter((c) => !siteIds.has(c.contact_id)),
                ];
                return (
                  <div className="eq-quotes__info-item eq-quotes__info-item--full">
                    <span className="eq-quotes__info-label" style={{ marginBottom: 6, display: "block" }}>
                      {createSiteId ? "Site & Customer Contacts" : "Customer Contacts"}
                    </span>
                    {allContacts.length === 0 ? (
                      <p style={{ fontSize: 13, color: "var(--eq-muted, #888)", margin: "0 0 8px" }}>
                        No contacts on file for this customer.
                      </p>
                    ) : (
                      <select
                        className="eq-quotes__select"
                        style={{ width: "100%", maxWidth: 360, marginBottom: 8 }}
                        value={selectedContactId ?? ""}
                        onChange={(e) => {
                          const id = e.target.value;
                          if (!id) {
                            setSelectedContactId(null);
                            setCreateAttnFirstName(""); setCreateAttnName(""); setCreateAttnPhone("");
                            return;
                          }
                          const ct = allContacts.find((c) => c.contact_id === id);
                          if (!ct) return;
                          setSelectedContactId(id);
                          setCreateAttnFirstName(ct.first_name ?? "");
                          setCreateAttnName(ct.last_name ?? "");
                          setCreateAttnPhone(ct.mobile_phone ?? ct.work_phone ?? "");
                        }}
                      >
                        <option value="">— Select contact —</option>
                        {siteIds.size > 0 ? (
                          <>
                            <optgroup label="Site contacts">
                              {siteContactsForForm.map((ct) => {
                                const n = [ct.first_name, ct.last_name].filter(Boolean).join(" ") || ct.email || "Unnamed";
                                return <option key={ct.contact_id} value={ct.contact_id}>{n}{ct.is_default_quote_contact ? " ★" : ""}</option>;
                              })}
                            </optgroup>
                            {createContacts.filter((c) => !siteIds.has(c.contact_id)).length > 0 && (
                              <optgroup label="Customer contacts">
                                {createContacts.filter((c) => !siteIds.has(c.contact_id)).map((ct) => {
                                  const n = [ct.first_name, ct.last_name].filter(Boolean).join(" ") || ct.email || "Unnamed";
                                  return <option key={ct.contact_id} value={ct.contact_id}>{n}{ct.is_default_quote_contact ? " ★" : ""}</option>;
                                })}
                              </optgroup>
                            )}
                          </>
                        ) : (
                          allContacts.map((ct) => {
                            const n = [ct.first_name, ct.last_name].filter(Boolean).join(" ") || ct.email || "Unnamed";
                            return <option key={ct.contact_id} value={ct.contact_id}>{n}{ct.is_default_quote_contact ? " ★" : ""}</option>;
                          })
                        )}
                      </select>
                    )}
                    {showAddContact ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", padding: "10px 12px", background: "var(--eq-ice, #EAF5FB)", borderRadius: 8, border: "1px solid var(--eq-border, #ddd)" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span className="eq-quotes__info-label" style={{ marginBottom: 2 }}>First Name *</span>
                          <input className="eq-quotes__input" style={{ minWidth: 120 }} value={newContactFirst} onChange={(e) => setNewContactFirst(e.target.value)} placeholder="First" autoFocus />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span className="eq-quotes__info-label" style={{ marginBottom: 2 }}>Last Name</span>
                          <input className="eq-quotes__input" style={{ minWidth: 120 }} value={newContactLast} onChange={(e) => setNewContactLast(e.target.value)} placeholder="Last" />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span className="eq-quotes__info-label" style={{ marginBottom: 2 }}>Phone</span>
                          <input className="eq-quotes__input" style={{ minWidth: 130 }} value={newContactPhone} onChange={(e) => setNewContactPhone(e.target.value)} placeholder="0400 000 000" />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span className="eq-quotes__info-label" style={{ marginBottom: 2 }}>Email</span>
                          <input className="eq-quotes__input" style={{ minWidth: 180 }} value={newContactEmail} onChange={(e) => setNewContactEmail(e.target.value)} placeholder="email@example.com" />
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", paddingBottom: 1 }}>
                          <button
                            type="button"
                            className="eq-quotes__btn eq-quotes__btn--primary"
                            style={{ height: 32, fontSize: 13 }}
                            disabled={addingContact || !newContactFirst.trim()}
                            onClick={() => void handleAddNewContact()}
                          >
                            {addingContact ? "Adding…" : "Add"}
                          </button>
                          <button
                            type="button"
                            className="eq-quotes__btn eq-quotes__btn--outline"
                            style={{ height: 32, fontSize: 13 }}
                            onClick={() => { setShowAddContact(false); setNewContactFirst(""); setNewContactLast(""); setNewContactPhone(""); setNewContactEmail(""); }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="eq-quotes__btn eq-quotes__btn--outline"
                        style={{ fontSize: 12, padding: "3px 10px", marginTop: allContacts.length > 0 ? 0 : 0 }}
                        onClick={() => setShowAddContact(true)}
                      >
                        + Add new contact
                      </button>
                    )}
                  </div>
                );
              })()}
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
                <datalist id="eq-form-estimators">
                  {estimators.map((est) => <option key={est.estimator_id} value={est.name} />)}
                </datalist>
                <input
                  className="eq-quotes__input"
                  list="eq-form-estimators"
                  value={createEstimatorName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCreateEstimatorName(val);
                    try { localStorage.setItem("eq-quotes-estimator-name", val); } catch { /* ignore */ }
                    const match = estimators.find((est) => est.name === val);
                    if (match?.initials) {
                      const upper = match.initials.toUpperCase();
                      setCreateEstimatorInitials(upper);
                      updateInitials(upper);
                    }
                  }}
                  placeholder="e.g. Royce Milmlow"
                />
              </div>
              <div className="eq-quotes__info-item">
                <span className="eq-quotes__info-label">Initials</span>
                <input
                  className="eq-quotes__input eq-quotes__input--sm"
                  style={{ textTransform: "uppercase" }}
                  value={createEstimatorInitials}
                  onChange={(e) => {
                    const upper = e.target.value.toUpperCase();
                    setCreateEstimatorInitials(upper);
                    updateInitials(upper);
                  }}
                  placeholder="RM"
                  maxLength={4}
                />
              </div>
              <div className="eq-quotes__info-item">
                <span className="eq-quotes__info-label">Payment Terms</span>
                <input
                  className="eq-quotes__input"
                  value={createPaymentTerms}
                  onChange={(e) => {
                    setCreatePaymentTerms(e.target.value);
                    try { localStorage.setItem("eq-quotes-payment-terms", e.target.value); } catch { /* ignore */ }
                  }}
                  placeholder="e.g. 30 days net"
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
              <div className="eq-quotes__info-item eq-quotes__info-item--full">
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span className="eq-quotes__info-label" style={{ marginBottom: 0 }}>Scope of Works</span>
                  <button
                    type="button"
                    className="eq-quotes__btn eq-quotes__btn--outline"
                    style={{ fontSize: 11, padding: "2px 8px", height: 24 }}
                    disabled={draftingScope}
                    onClick={() => void handleDraftScope()}
                    title="Draft a scope from the customer, project, your notes and the line items. You can edit it after."
                  >
                    {draftingScope ? "Drafting…" : "✨ Draft with AI"}
                  </button>
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
                  onChange={(e) => { setCreateScope(e.target.value); if (scopeAiErr) setScopeAiErr(null); }}
                  placeholder="Describe the scope of works…"
                  rows={3}
                />
                {scopeAiErr && <span className="eq-quotes__inline-err">{scopeAiErr}</span>}
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
                          <td colSpan={8} className="eq-quotes__group-label">
                            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              {sec.label}
                              {sec.value === "subcontractor" && (
                                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  {pdfParseErr && (
                                    <span style={{ color: "var(--eq-err, #c0392b)", fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 11 }}>
                                      {pdfParseErr}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    disabled={pdfParsing}
                                    onClick={() => pdfFileInputRef.current?.click()}
                                    style={{
                                      background: "none", border: "none", padding: 0,
                                      color: "var(--eq-sky, #3DA8D8)", fontWeight: 600,
                                      fontSize: 11, textTransform: "none", letterSpacing: 0,
                                      cursor: pdfParsing ? "wait" : "pointer",
                                    }}
                                  >
                                    {pdfParsing ? "Reading…" : "Import from PDF"}
                                  </button>
                                </span>
                              )}
                            </span>
                          </td>
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
            {/* Quick-add preset panel */}
            {!presetsLoading && presets.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setPresetPanelOpen((o) => !o)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 12, color: "var(--eq-muted)", fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.06em", padding: 0,
                  }}
                >
                  <span style={{ fontSize: 14 }}>{presetPanelOpen ? "▾" : "▸"}</span>
                  Quick add from library
                </button>
                {presetPanelOpen && (
                  <div style={{ marginTop: 8, padding: "10px 12px", background: "var(--eq-surface-alt, var(--eq-surface))", borderRadius: 8, border: "1px solid var(--eq-border)" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                      {QUOTE_SECTIONS.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setPresetPanelCat(s.value)}
                          style={{
                            padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                            cursor: "pointer", border: "1px solid var(--eq-border)",
                            background: presetPanelCat === s.value ? "var(--eq-sky, #3DA8D8)" : "var(--eq-surface)",
                            color: presetPanelCat === s.value ? "#fff" : "var(--eq-text)",
                          }}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {presets
                        .filter((p) => (p.category ?? "") === presetPanelCat)
                        .map((p) => (
                          <button
                            key={p.preset_id}
                            type="button"
                            onClick={() => applyPreset(p)}
                            style={{
                              display: "flex", flexDirection: "column", alignItems: "flex-start",
                              padding: "5px 10px", borderRadius: 8, minWidth: 140,
                              border: "1px solid var(--eq-border)",
                              background: "var(--eq-surface)",
                              cursor: "pointer", textAlign: "left",
                              transition: "border-color 0.1s",
                            }}
                          >
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--eq-text)" }}>{p.description}</span>
                            {p.unit_rate_cents > 0 && (
                              <span style={{ fontSize: 11, color: "var(--eq-muted)", marginTop: 1 }}>
                                {aud(p.unit_rate_cents)}{p.unit ? ` / ${p.unit}` : ""}
                              </span>
                            )}
                          </button>
                        ))}
                      {presets.filter((p) => (p.category ?? "") === presetPanelCat).length === 0 && (
                        <span className="eq-quotes__muted" style={{ fontSize: 12 }}>No presets in this section yet.</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

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
                  if (!calcOpen && calcMatrix.length === 0) void loadCalcMatrix();
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

                  {calcMode === "install" && calcMatrix.length > 0 && (() => {
                    const seenProducts = new Set<string>();
                    const uniqueProducts = calcMatrix.filter((r) => { if (seenProducts.has(r.product_id)) return false; seenProducts.add(r.product_id); return true; });
                    return (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--eq-muted)", marginBottom: 6 }}>Price guide (ex GST)</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {uniqueProducts.map((prod) => {
                            const bands = calcMatrix.filter((r) => r.product_id === prod.product_id).sort((a, b) => a.min_qty - b.min_qty);
                            const isActive = calcProductId === prod.product_id;
                            return (
                              <div key={prod.product_id} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 12, fontWeight: 600, minWidth: 120, color: "var(--eq-text)" }}>{prod.name}</span>
                                {bands.map((b) => (
                                  <button
                                    key={b.min_qty}
                                    type="button"
                                    onClick={() => { setCalcProductId(prod.product_id); setCalcPairs(String(b.min_qty)); setCalcResult(null); }}
                                    style={{
                                      padding: "2px 8px", borderRadius: 6, fontSize: 11.5, cursor: "pointer",
                                      border: `1px solid ${isActive && String(b.min_qty) === calcPairs ? "var(--eq-deep, #2986B4)" : "var(--eq-border)"}`,
                                      background: isActive && String(b.min_qty) === calcPairs ? "var(--eq-ice, #EAF5FB)" : "var(--eq-surface)",
                                      color: "var(--eq-text)",
                                    }}
                                  >
                                    <span style={{ color: "var(--eq-muted)" }}>{b.band_label}</span>
                                    <span style={{ fontWeight: 600, marginLeft: 5 }}>${Math.round(b.computed_price).toLocaleString()}</span>
                                  </button>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
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
                            <option key={p.product_id} value={p.product_id}>{p.name}{p.brand ? ` — ${p.brand}` : ""}{p.phase ? ` ${p.phase}` : ""}</option>
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
                {catSubtotals && (
                  <>
                    {[...catSubtotals.entries()].map(([cat, total]) => (
                      <div key={cat} className="eq-quotes__financial-row" style={{ fontSize: 12 }}>
                        <span style={{ color: "var(--eq-muted)", textTransform: "capitalize" }}>{cat}</span>
                        <span style={{ color: "var(--eq-muted)" }}>{aud(total)}</span>
                      </div>
                    ))}
                    <div style={{ height: 1, background: "var(--eq-border)", margin: "4px 0" }} />
                  </>
                )}
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
                {createMarginPct !== null && (
                  <div className="eq-quotes__financial-row" style={{ borderTop: "1px solid var(--eq-border)", marginTop: 4, paddingTop: 4 }}>
                    <span style={{ color: "var(--eq-muted)", fontSize: 12 }}>Est. margin</span>
                    <span style={{
                      fontSize: 12, fontWeight: 600,
                      color: createMarginPct >= 25 ? "var(--eq-green, #27ae60)" : createMarginPct >= 10 ? "var(--eq-amber, #d4820a)" : "var(--eq-err, #c0392b)",
                    }}>
                      {createMarginPct}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Submit row */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0", flexWrap: "wrap" }}>
            <button
              type="button"
              className="eq-quotes__btn eq-quotes__btn--primary"
              style={{ padding: "9px 24px", fontSize: 14 }}
              disabled={creating || !createCustomerId || !quoteNumberValid || createLineItems.filter((li) => li.description.trim()).length === 0}
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

      {/* Hidden file input for subcontractor "Import from PDF" in the line-items table */}
      <input
        ref={pdfFileInputRef}
        type="file"
        accept=".pdf,image/jpeg,image/png"
        style={{ display: "none" }}
        onChange={(e) => void handlePdfFile(e)}
      />

      {/* PDF review modal */}
      {pdfParseResult && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(26,26,46,0.5)",
          zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div style={{
            background: "var(--eq-paper)", borderRadius: 12, width: "100%", maxWidth: 640,
            maxHeight: "80vh", overflow: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16,
            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--eq-ink)" }}>
                Review supplier quote
              </h3>
              {(pdfParseResult.supplier_name || pdfParseResult.quote_ref) && (
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--eq-muted)" }}>
                  {[pdfParseResult.supplier_name, pdfParseResult.quote_ref && `Ref: ${pdfParseResult.quote_ref}`].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <div className="eq-quotes__table-wrap" style={{ maxHeight: 360, overflow: "auto" }}>
              <table className="eq-quotes__table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th style={{ width: 60 }}>Qty</th>
                    <th style={{ width: 56 }}>Unit</th>
                    <th style={{ width: 100, textAlign: "right" }}>Unit price</th>
                  </tr>
                </thead>
                <tbody>
                  {pdfParseResult.items.map((it, i) => (
                    <tr key={i} className="eq-quotes__row">
                      <td>{it.description}</td>
                      <td>{it.qty}</td>
                      <td>{it.unit || <span className="eq-quotes__muted">—</span>}</td>
                      <td style={{ textAlign: "right" }}>
                        {it.unit_price > 0
                          ? (it.unit_price).toLocaleString("en-AU", { style: "currency", currency: "AUD" })
                          : <span className="eq-quotes__muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--eq-muted)" }}>
              {pdfParseResult.items.length} item{pdfParseResult.items.length !== 1 ? "s" : ""} will be added to the Subcontractors section. Cost = supplier price. Set your markup % on each line after importing.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                onClick={() => setPdfParseResult(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--primary"
                onClick={confirmPdfImport}
              >
                Import {pdfParseResult.items.length} item{pdfParseResult.items.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}
      </>
    );
  }

  // ── Render main views ─────────────────────────────────────────────────────

  return (
    <div className="eq-quotes">
      {/* Module header */}
      <div className="eq-quotes__module-header">
        <h2 className="eq-quotes__title">
          <EqLogo size={36} />
          <span className="eq-quotes__title-sep" aria-hidden="true">|</span>
          <span className="eq-quotes__title-label">OPS</span>
        </h2>
        <div className="eq-quotes__header-right">
          <button
            type="button"
            className="eq-quotes__btn eq-quotes__btn--primary eq-quotes__btn--new-quote"
            onClick={() => setView("create")}
          >
            + New Quote
          </button>
          {pdfStartErr && (
            <span style={{ fontSize: 12, color: "var(--eq-err, #c0392b)", alignSelf: "center" }}>
              {pdfStartErr}
            </span>
          )}
          <button
            type="button"
            className="eq-quotes__btn eq-quotes__btn--outline"
            disabled={pdfParsing}
            title="Start a new quote from a subcontractor PDF"
            onClick={() => { setPdfStartErr(null); pdfStartFileInputRef.current?.click(); }}
          >
            {pdfParsing ? "Reading…" : "From PDF"}
          </button>
          <input
            ref={pdfStartFileInputRef}
            type="file"
            accept=".pdf,image/jpeg,image/png"
            style={{ display: "none" }}
            onChange={(e) => void handlePdfFileStart(e)}
          />
          <div className="eq-quotes__view-tabs">
            {(["pipeline", "accordion"] as ModuleView[]).map((v) => (
              <button
                key={v}
                type="button"
                className={`eq-quotes__view-tab${view === v ? " eq-quotes__view-tab--active" : ""}`}
                onClick={() => setView(v)}
              >
                {v === "pipeline" ? "Jobs" : "By Client"}
              </button>
            ))}
          </div>
          <DropdownMenu
            align="right"
            trigger={
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline eq-quotes__btn--icon"
                aria-label="More views"
                title="More"
              >
                <MoreHorizontal size={16} />
              </button>
            }
            items={[
              { key: "import",    label: "Import Coupa", icon: <FileUp size={14} />,    onClick: () => setView("import") },
              { key: "customers", label: "Clients",       icon: <Users size={14} />,     onClick: () => setView("customers") },
              { key: "reports",   label: "Reports",       icon: <BarChart2 size={14} />, onClick: () => setView("reports") },
              { key: "setup",     label: "Setup",         icon: <Settings size={14} />,  onClick: () => setView("setup") },
              { key: "sep",       separator: true },
              { key: "trash",     label: "Archived",      icon: <Archive size={14} />,   onClick: () => setView("trash") },
            ]}
          />
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
            <div className="eq-quotes__empty">No archived quotes.</div>
          ) : (
            <div className="eq-quotes__table-wrap">
              <table className="eq-quotes__table">
                <thead>
                  <tr>
                    <th>Quote #</th>
                    <th>Customer</th>
                    <th>Project</th>
                    <th className="eq-quotes__th--right">Total</th>
                    <th>Archived</th>
                    <th style={{ width: 160 }}></th>
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
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            className="eq-quotes__btn eq-quotes__btn--outline"
                            onClick={() => void handleRestore(q.quote_id)}
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            className="eq-quotes__btn eq-quotes__btn--outline"
                            style={{ color: "var(--eq-err, #c0392b)" }}
                            onClick={() => void handleDelete(q.quote_id, q.quote_number)}
                          >
                            Delete
                          </button>
                        </div>
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
          {/* Action cards — what needs doing right now; click to filter to it */}
          {!pipelineLoading && quotes.length > 0 && (() => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const in14Days = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
            const staleThreshold = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
            const overdueFup = quotes.filter((q) => q.follow_up_at && q.follow_up_at <= todayStr && !CLOSED_STATUSES.has(q.status)).length;
            const expiringSoon = quotes.filter((q) => q.expires_at && q.expires_at.slice(0, 10) <= in14Days && !CLOSED_STATUSES.has(q.status) && !ACTIVE_JOB_STATUSES.has(q.status)).length;
            const needsJobNo = quotes.filter((q) => !q.workbench_job_no && ACTIVE_JOB_STATUSES.has(q.status)).length;
            const staleCount = quotes.filter((q) => !CLOSED_STATUSES.has(q.status) && !ACTIVE_JOB_STATUSES.has(q.status) && !q.follow_up_at && q.created_at.slice(0, 10) < staleThreshold).length;
            const TONES: Record<string, { bg: string; fg: string; bd: string }> = {
              sky:   { bg: "var(--eq-ice, #EAF5FB)",       fg: "var(--eq-deep, #2986B4)",  bd: "#3DA8D833" },
              amber: { bg: "var(--eq-amber-bg, #fef9ee)",  fg: "var(--eq-amber, #d4820a)", bd: "#d4820a33" },
              err:   { bg: "var(--eq-err-bg, #fdf1f1)",    fg: "var(--eq-err, #c0392b)",   bd: "#c0392b33" },
              muted: { bg: "var(--eq-surface-2, #f5f5f5)", fg: "var(--eq-muted, #6b7280)", bd: "var(--eq-border, #e0e0e0)" },
            };
            const cards = [
              { n: needsJobNo,   label: "need a job no.",       tone: "sky",   icon: <Briefcase size={15} />,     on: () => { resetSmartFilters(); setNeedsJobNoOnly(true); setStatusFilter("active-jobs"); } },
              { n: expiringSoon, label: "expiring ≤ 14 days",   tone: "amber", icon: <Clock size={15} />,         on: () => { resetSmartFilters(); setExpiringOnly(true); setStatusFilter("all"); } },
              { n: overdueFup,   label: "follow-ups overdue",   tone: "err",   icon: <CalendarClock size={15} />, on: () => { resetSmartFilters(); setOverdueFupOnly(true); setStatusFilter("all"); } },
              { n: staleCount,   label: "stale — no follow-up", tone: "muted", icon: <AlarmClock size={15} />,    on: () => { resetSmartFilters(); setStaleOnly(true); setStatusFilter("open"); } },
            ].filter((c) => c.n > 0);
            if (cards.length === 0) return null;
            return (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "2px 0 12px" }}>
                {cards.map((c) => {
                  const t = TONES[c.tone];
                  return (
                    <button key={c.label} type="button" onClick={c.on}
                      style={{ display: "flex", alignItems: "center", gap: 10, background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", color: t.fg, textAlign: "left" }}>
                      <span style={{ display: "flex" }}>{c.icon}</span>
                      <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{c.n}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.85 }}>{c.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* Unified toolbar: stages · search · filters · layout · export */}
          <div className="eq-quotes__pipeline-controls" style={{ alignItems: "center" }}>
            <div className="eq-quotes__status-filters" style={{ margin: 0 }}>
              {STAGES.map((f) => {
                const count = quotes.filter((q) => f.match(q.status)).length;
                return (
                  <button
                    key={f.key}
                    type="button"
                    className={`eq-quotes__status-tab${statusFilter === f.key ? " eq-quotes__status-tab--active" : ""}`}
                    onClick={() => setStatusFilter(f.key)}
                  >
                    {f.label}
                    {count > 0 && (
                      <span className="eq-quotes__status-tab-count">{pipelineLoading ? "…" : count}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <input
              ref={searchInputRef}
              className="eq-quotes__search"
              type="search"
              placeholder="Search by quote #, project, customer, site, job no. or PO…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className={`eq-quotes__btn ${activeFilterCount > 0 ? "eq-quotes__btn--primary" : "eq-quotes__btn--outline"}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                onClick={() => setFiltersOpen((v) => !v)}
              >
                <SlidersHorizontal size={14} />
                Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
              </button>
              {filtersOpen && (
                <>
                  <div onClick={() => setFiltersOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 41, background: "var(--eq-surface, #fff)", border: "1px solid var(--eq-border, #e0e0e0)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.10)", padding: 14, width: 360, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--eq-muted, #6b7280)" }}>Filters</span>
                      <button type="button" onClick={() => setFiltersOpen(false)} className="eq-quotes__btn eq-quotes__btn--ghost eq-quotes__btn--icon" aria-label="Close filters"><X size={14} /></button>
                    </div>
            {(() => {
              const isoDate = (d: Date) => d.toISOString().slice(0, 10);
              const today = new Date();
              const presets: Array<{ label: string; from: string; to: string }> = [
                { label: "This month", from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDate(today) },
                { label: "3 months", from: isoDate(new Date(today.getFullYear(), today.getMonth() - 3, 1)), to: isoDate(today) },
                { label: "This year", from: isoDate(new Date(today.getFullYear(), 0, 1)), to: isoDate(today) },
              ];
              return presets.map((p) => {
                const active = dateFrom === p.from && dateTo === p.to;
                return (
                  <button
                    key={p.label}
                    type="button"
                    className={`eq-quotes__btn ${active ? "eq-quotes__btn--primary" : "eq-quotes__btn--outline"}`}
                    style={{ fontSize: 12 }}
                    onClick={() => { if (active) { setDateFrom(""); setDateTo(""); } else { setDateFrom(p.from); setDateTo(p.to); } }}
                  >
                    {p.label}
                  </button>
                );
              });
            })()}
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
            {customerOptions.length > 1 && (
              <select
                className="eq-quotes__select"
                style={{ fontSize: 13, padding: "4px 6px" }}
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
              >
                <option value="">All clients</option>
                {customerOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            {siteOptions.length > 1 && (
              <select
                className="eq-quotes__select"
                style={{ fontSize: 13, padding: "4px 6px" }}
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
              >
                <option value="">All sites</option>
                {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <button
              type="button"
              className={`eq-quotes__btn ${expiringOnly ? "eq-quotes__btn--primary" : "eq-quotes__btn--outline"}`}
              onClick={() => setExpiringOnly((v) => !v)}
              title="Show quotes expiring within 14 days"
            >
              Expiring soon
            </button>
            <button
              type="button"
              className={`eq-quotes__btn ${unsentOnly ? "eq-quotes__btn--primary" : "eq-quotes__btn--outline"}`}
              onClick={() => setUnsentOnly((v) => !v)}
              title="Show submitted quotes with no sent date stamped"
            >
              Unsent
            </button>
            <button
              type="button"
              className={`eq-quotes__btn ${needsJobNoOnly ? "eq-quotes__btn--primary" : "eq-quotes__btn--outline"}`}
              onClick={() => setNeedsJobNoOnly((v) => !v)}
              title="Show active/won quotes that don't yet have a Workbench job number"
            >
              Needs Job No.
            </button>
            <button
              type="button"
              className={`eq-quotes__btn ${overdueFupOnly ? "eq-quotes__btn--primary" : "eq-quotes__btn--outline"}`}
              onClick={() => setOverdueFupOnly((v) => !v)}
              title="Show quotes whose follow-up date has passed"
            >
              Follow-up due
            </button>
            {(search || dateFrom || dateTo || estFilter || customerFilter || siteFilter || expiringOnly || unsentOnly || needsJobNoOnly || overdueFupOnly || staleOnly) && (
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                onClick={() => {
                  if (search) handleSearch("");
                  setDateFrom(""); setDateTo(""); setEstFilter(""); setCustomerFilter(""); setSiteFilter("");
                  setExpiringOnly(false); setUnsentOnly(false); setNeedsJobNoOnly(false); setOverdueFupOnly(false); setStaleOnly(false);
                }}
              >
                Clear filters
              </button>
            )}
                  </div>
                </>
              )}
            </div>
            {/* Layout toggle: table vs board */}
            <div style={{ display: "inline-flex", border: "1px solid var(--eq-border, #e0e0e0)", borderRadius: 8, overflow: "hidden" }}>
              <button
                type="button"
                title="Table view"
                aria-label="Table view"
                onClick={() => { setPipelineLayout("table"); try { localStorage.setItem("eq-quotes-layout", "table"); } catch { /* ignore */ } }}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 9px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: pipelineLayout === "table" ? "var(--eq-ice, #EAF5FB)" : "transparent", color: pipelineLayout === "table" ? "var(--eq-deep, #2986B4)" : "var(--eq-muted, #6b7280)" }}
              >
                <List size={14} /> Table
              </button>
              <button
                type="button"
                title="Board view"
                aria-label="Board view"
                onClick={() => { setPipelineLayout("board"); try { localStorage.setItem("eq-quotes-layout", "board"); } catch { /* ignore */ } }}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 9px", border: "none", borderLeft: "1px solid var(--eq-border, #e0e0e0)", cursor: "pointer", fontSize: 12, fontWeight: 600, background: pipelineLayout === "board" ? "var(--eq-ice, #EAF5FB)" : "transparent", color: pipelineLayout === "board" ? "var(--eq-deep, #2986B4)" : "var(--eq-muted, #6b7280)" }}
              >
                <LayoutGrid size={14} /> Board
              </button>
            </div>
            {/* Columns picker */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                onClick={() => setColsMenuOpen((v) => !v)}
                title="Show or hide columns"
              >
                <Columns3 size={14} /> Columns
              </button>
              {colsMenuOpen && (
                <>
                  <div onClick={() => setColsMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, background: "var(--eq-surface, #fff)", border: "1px solid var(--eq-border, #e0e0e0)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.10)", padding: 10, width: 200 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--eq-muted, #6b7280)", marginBottom: 6 }}>Columns</div>
                    {pipelineColumns
                      .filter((c) => !LOCKED_COLS.has(c.key) && c.header)
                      .map((c) => (
                        <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: 13, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={!hiddenCols.has(c.key)}
                            onChange={() => toggleCol(c.key)}
                          />
                          {c.header}
                        </label>
                      ))}
                  </div>
                </>
              )}
            </div>
            {!pipelineLoading && displayedQuotes.length > 0 && (
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                title="Export current view to CSV"
                onClick={() => {
                  const header = ["Quote #", "Customer", "Site", "Project", "Estimator", "Status", "Job No.", "PO Number", "Total inc GST", "Margin %", "Sent", "Expires", "Follow-up", "Created"];
                  const today = new Date().toISOString().slice(0, 10);
                  downloadCsv([header, ...displayedQuotes.map((q) => [
                    q.quote_number, q.customer_name ?? "", q.site_code ?? "", q.project_name ?? "",
                    q.estimator_initials ?? "", STATUS_LABELS[q.status] ?? q.status, q.workbench_job_no ?? "",
                    q.po_number ?? "",
                    (q.total_cents / 100).toFixed(2),
                    q.margin_pct !== null ? Number(q.margin_pct).toFixed(1) : "",
                    fmtDate(q.sent_at),
                    fmtDate(q.expires_at),
                    q.follow_up_at ? fmtDate(q.follow_up_at) : "",
                    fmtDate(q.created_at),
                  ])], `eq-pipeline-${today}.csv`);
                }}
              >
                Export CSV
              </button>
            )}
            {!pipelineLoading && quotes.length > 0 && (
              <div className="eq-quotes__totals">
                <span className="eq-quotes__total-item">
                  <span className="eq-quotes__total-label">{displayedQuotes.length} quote{displayedQuotes.length !== 1 ? "s" : ""}</span>
                  <span className="eq-quotes__total-val">{aud(visibleTotal)}</span>
                </span>
                {atRiskTotal > 0 && atRiskTotal !== visibleTotal && (
                  <span className="eq-quotes__total-item" title="Sum of submitted, reviewing, on-hold and verbal-win quotes">
                    <span className="eq-quotes__total-label">In play</span>
                    <span className="eq-quotes__total-val" style={{ color: "var(--eq-amber, #d4820a)" }}>{aud(atRiskTotal)}</span>
                  </span>
                )}
                {wonTotal > 0 && wonTotal !== visibleTotal && (
                  <span className="eq-quotes__total-item">
                    <span className="eq-quotes__total-label">Won</span>
                    <span className="eq-quotes__total-val eq-quotes__total-val--green">{aud(wonTotal)}</span>
                  </span>
                )}
                {winRateDisplayed !== null && (
                  <span className="eq-quotes__total-item" title="Win rate across decided quotes in this view (min. 3 decided)">
                    <span className="eq-quotes__total-label">Win rate</span>
                    <span className="eq-quotes__total-val" style={{ color: winRateDisplayed >= 50 ? "var(--eq-green, #27ae60)" : "var(--eq-amber, #d4820a)" }}>{winRateDisplayed}%</span>
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
                onChange={(e) => updateInitials(e.target.value)}
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
              <span style={{ fontSize: 12, color: "var(--eq-muted, #6b7280)", margin: "0 4px" }}>|</span>
              <input
                type="date"
                className="eq-quotes__input eq-quotes__input--sm"
                style={{ width: 130, fontSize: 13, padding: "4px 6px" }}
                value={bulkFupDate}
                onChange={(e) => setBulkFupDate(e.target.value)}
                title="Set follow-up date for all selected"
              />
              <button
                type="button"
                className="eq-quotes__btn eq-quotes__btn--outline"
                disabled={!bulkFupDate || bulkFupBusy}
                onClick={() => void handleBulkFollowUp()}
                title="Apply follow-up date to all selected quotes"
              >
                {bulkFupBusy ? "Saving…" : "Set follow-up"}
              </button>
              <button type="button" className="eq-quotes__btn eq-quotes__btn--outline" onClick={() => setSelectedIds(new Set())}>
                Clear
              </button>
            </div>
          )}

          {/* Table — canonical eq-ui Table (sortable + per-column filters + select) */}
          {pipelineError ? (
            <div className="eq-quotes__error-banner">{pipelineError}</div>
          ) : pipelineLayout === "board" ? (
            pipelineLoading ? (
              <div className="eq-quotes__loading">Loading…</div>
            ) : (
              <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8, alignItems: "flex-start" }}>
                {BOARD_COLUMNS.map((st) => {
                  const colQuotes = displayedQuotes.filter((q) => q.status === st);
                  const colTotal = colQuotes.reduce((s, q) => s + q.total_cents, 0);
                  const isOver = dragOverStatus === st;
                  return (
                    <div
                      key={st}
                      onDragOver={(e) => { e.preventDefault(); if (dragOverStatus !== st) setDragOverStatus(st); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData("text/plain");
                        setDragOverStatus(null);
                        const q = displayedQuotes.find((x) => x.quote_id === id);
                        if (q && q.status !== st) void savePipelineStatus(q, st);
                      }}
                      style={{ flex: "0 0 240px", width: 240, background: isOver ? "var(--eq-ice, #EAF5FB)" : "var(--eq-surface-2, #f7f9fb)", border: `1px solid ${isOver ? "var(--eq-sky, #3DA8D8)" : "var(--eq-border, #e8e8e8)"}`, borderRadius: 10, padding: 8, minHeight: 120 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 4px 8px" }}>
                        <span className={statusClass(st)} style={{ fontSize: 11 }}>{STATUS_LABELS[st] ?? st}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--eq-muted, #6b7280)" }}>{colQuotes.length}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {colQuotes.map((q) => (
                          <div
                            key={q.quote_id}
                            draggable
                            onDragStart={(e) => { e.dataTransfer.setData("text/plain", q.quote_id); e.dataTransfer.effectAllowed = "move"; }}
                            onDragEnd={() => setDragOverStatus(null)}
                            onClick={() => void openDetail(q.quote_id)}
                            style={{ background: "var(--eq-surface, #fff)", border: "1px solid var(--eq-border, #e8e8e8)", borderRadius: 8, padding: "8px 10px", cursor: "grab", display: "flex", flexDirection: "column", gap: 4 }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                              <span style={{ fontFamily: "ui-monospace, 'Cascadia Code', monospace", fontSize: 12, fontWeight: 600 }}>{q.quote_number}</span>
                              {q.estimator_initials && <span className="eq-quotes__initials-badge">{q.estimator_initials}</span>}
                            </div>
                            <span style={{ fontSize: 12, color: "var(--eq-ink, #1A1A2E)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.customer_name ?? "—"}</span>
                            {q.project_name && <span style={{ fontSize: 11, color: "var(--eq-muted, #6b7280)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.project_name}</span>}
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <span style={{ fontSize: 12, fontWeight: 700 }}>{aud(q.total_cents)}</span>
                              {ACTIVE_JOB_STATUSES.has(q.status) && !q.workbench_job_no && (
                                <span className="eq-quotes__badge eq-quotes__badge--amber eq-quotes__badge--xs">Needs no.</span>
                              )}
                            </div>
                          </div>
                        ))}
                        {colQuotes.length === 0 && (
                          <div style={{ fontSize: 11, color: "var(--eq-muted, #9aa0a6)", textAlign: "center", padding: "12px 0" }}>—</div>
                        )}
                      </div>
                      {colTotal > 0 && (
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--eq-muted, #6b7280)", textAlign: "right", padding: "8px 4px 2px" }}>{aud(colTotal)}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <Table
              className="eq-quotes__pipeline-table"
              rows={displayedQuotes}
              columns={visiblePipelineColumns}
              getRowId={(q) => q.quote_id}
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
              {/* Active-only toggle + search */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`eq-quotes__btn${accordionActiveOnly ? " eq-quotes__btn--primary" : " eq-quotes__btn--outline"}`}
                  onClick={() => setAccordionActiveOnly((v) => !v)}
                >
                  {accordionActiveOnly ? "Active + Sent" : "All statuses"}
                </button>
                <input
                  className="eq-quotes__search"
                  style={{ maxWidth: 260 }}
                  type="search"
                  placeholder="Search client or group…"
                  value={accordionSearch}
                  onChange={(e) => setAccordionSearch(e.target.value)}
                />
              </div>
              {/* Named client groups */}
              {Object.entries(groupMap).map(([groupId, group]) => {
                const memberNames = new Set(group.members.map((m) => m.customer_name));
                const groupQuotes = effectiveAccordionQuotes.filter((q) =>
                  q.customer_name && memberNames.has(q.customer_name),
                );
                if (accordionActiveOnly && groupQuotes.length === 0) return null;
                const searchLower = accordionSearch.toLowerCase().trim();
                if (searchLower && !group.name.toLowerCase().includes(searchLower) &&
                  ![...memberNames].some((n) => n.toLowerCase().includes(searchLower))) return null;
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
                                        <th>Job No.</th>
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
                                          <td className="eq-quotes__td--mono">
                                            {q.workbench_job_no ?? <span className="eq-quotes__muted">—</span>}
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
                const searchLower2 = accordionSearch.toLowerCase().trim();
                const ungrouped = Object.entries(quotesByCustomer).filter(
                  ([name]) => !groupedNames.has(name) &&
                    (!searchLower2 || name.toLowerCase().includes(searchLower2)),
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
                                    <th>Job No.</th>
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
                                      <td className="eq-quotes__td--mono">
                                        {q.workbench_job_no ?? <span className="eq-quotes__muted">—</span>}
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
