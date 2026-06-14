import React, { useState, useEffect, useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

interface Quote {
  quote_id: string;
  quote_number: string;
  status: string;
  project_name: string | null;
  estimator_name: string | null;
  estimator_initials: string | null;
  subtotal_cents: number;
  total_cents: number;
  margin_pct: number | null;
  sent_at: string | null;
  expires_at: string | null;
  created_at: string;
  customer_name: string | null;
  site_name: string | null;
  site_code: string | null;
  workbench_job_no: string | null;
}

// ---------------------------------------------------------------------------
// Status grouping
// ---------------------------------------------------------------------------

const WON_STATUSES = new Set([
  "verbal-win", "won-awaiting-job-no", "won-job-created",
  "po-matched", "active", "complete", "ready-to-invoice",
]);
const LOST_STATUSES = new Set(["lost", "cancelled", "expired", "superseded"]);
const PIPELINE_STATUSES = new Set([
  "draft", "submitted", "client-reviewing", "on-hold",
]);

const STATUS_LABELS: Record<string, string> = {
  "draft":                "Draft",
  "submitted":            "Submitted",
  "client-reviewing":     "Client Reviewing",
  "on-hold":              "On Hold",
  "verbal-win":           "Verbal Win",
  "won-awaiting-job-no":  "Won – Awaiting Job No.",
  "won-job-created":      "Won – Job Created",
  "po-matched":           "PO Matched",
  "active":               "Active",
  "complete":             "Complete",
  "ready-to-invoice":     "Ready to Invoice",
  "lost":                 "Lost",
  "cancelled":            "Cancelled",
  "expired":              "Expired",
  "superseded":           "Superseded",
};

const PIPELINE_ORDER = [
  "draft", "submitted", "client-reviewing", "on-hold",
  "verbal-win", "won-awaiting-job-no", "won-job-created", "po-matched",
  "active", "complete", "ready-to-invoice",
  "lost", "cancelled", "expired", "superseded",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtMoney(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function ageBucket(days: number): string {
  if (days < 7)  return "< 7 days";
  if (days < 30) return "7–30 days";
  if (days < 90) return "31–90 days";
  return "> 90 days";
}

const AGE_ORDER = ["< 7 days", "7–30 days", "31–90 days", "> 90 days"];

function csvEscape(v: string | null | number): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(rows: (string | number | null)[][], filename: string): void {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  supabase: SupabaseClient | null;
}

export function QuotesReports({ supabase }: Props) {
  const [quotes, setQuotes]   = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [tab, setTab]         = useState<"pipeline" | "aging" | "register" | "estimators" | "trend">("pipeline");

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("eq_list_quotes");
    if (err) { setError(err.message); setLoading(false); return; }
    setQuotes((data ?? []) as Quote[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  // ── Pipeline summary ──────────────────────────────────────────────────────

  const pipelineRows = React.useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const q of quotes) {
      const cur = map.get(q.status) ?? { count: 0, total: 0 };
      map.set(q.status, { count: cur.count + 1, total: cur.total + q.total_cents });
    }
    return PIPELINE_ORDER.filter((s) => map.has(s)).map((s) => ({
      status: s,
      label:  STATUS_LABELS[s] ?? s,
      count:  map.get(s)!.count,
      total:  map.get(s)!.total,
      group:  WON_STATUSES.has(s) ? "won" : LOST_STATUSES.has(s) ? "lost" : "pipeline",
    }));
  }, [quotes]);

  const winRateData = React.useMemo(() => {
    const won  = quotes.filter((q) => WON_STATUSES.has(q.status)).length;
    const lost = quotes.filter((q) => LOST_STATUSES.has(q.status)).length;
    const decided = won + lost;
    return { won, lost, rate: decided > 0 ? Math.round((won / decided) * 100) : null };
  }, [quotes]);

  const pipelineValue = React.useMemo(
    () => quotes.filter((q) => PIPELINE_STATUSES.has(q.status)).reduce((s, q) => s + q.total_cents, 0),
    [quotes],
  );

  // ── Aging table ───────────────────────────────────────────────────────────

  const agingRows = React.useMemo(() => {
    // Only active pipeline (not won/lost)
    const live = quotes.filter((q) => PIPELINE_STATUSES.has(q.status));
    const buckets = new Map<string, { count: number; total: number }>();
    for (const q of live) {
      const bucket = ageBucket(daysSince(q.created_at));
      const cur = buckets.get(bucket) ?? { count: 0, total: 0 };
      buckets.set(bucket, { count: cur.count + 1, total: cur.total + q.total_cents });
    }
    return AGE_ORDER.filter((b) => buckets.has(b)).map((b) => ({
      bucket: b,
      count:  buckets.get(b)!.count,
      total:  buckets.get(b)!.total,
      pct:    live.length > 0 ? Math.round((buckets.get(b)!.count / live.length) * 100) : 0,
    }));
  }, [quotes]);

  // ── Register CSV ──────────────────────────────────────────────────────────

  const handleExportCsv = useCallback(() => {
    const header = ["Quote No.", "Status", "Project", "Customer", "Site", "Estimator",
                    "Total (ex GST)", "Total (inc GST)", "Margin %", "Sent", "Created", "WB Job No."];
    const rows = quotes.map((q) => [
      q.quote_number,
      STATUS_LABELS[q.status] ?? q.status,
      q.project_name,
      q.customer_name,
      q.site_name ?? q.site_code,
      q.estimator_name,
      q.subtotal_cents / 100,
      q.total_cents / 100,
      q.margin_pct !== null ? (q.margin_pct / 100).toFixed(1) + "%" : "",
      q.sent_at ? new Date(q.sent_at).toLocaleDateString("en-AU") : "",
      new Date(q.created_at).toLocaleDateString("en-AU"),
      q.workbench_job_no,
    ]);
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv([header, ...rows], `sks-quotes-register-${today}.csv`);
  }, [quotes]);

  // ── Estimator breakdown ───────────────────────────────────────────────────

  const estimatorRows = React.useMemo(() => {
    const map = new Map<string, { name: string | null; won: number; lost: number; pipeline: number; total: number }>();
    for (const q of quotes) {
      const key = q.estimator_initials ?? "(unassigned)";
      const cur = map.get(key) ?? { name: q.estimator_name, won: 0, lost: 0, pipeline: 0, total: 0 };
      if (WON_STATUSES.has(q.status))      cur.won++;
      else if (LOST_STATUSES.has(q.status)) cur.lost++;
      else                                   cur.pipeline++;
      cur.total += q.total_cents;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([initials, d]) => ({
        initials,
        name: d.name,
        won: d.won,
        lost: d.lost,
        pipeline: d.pipeline,
        total: d.total,
        decided: d.won + d.lost,
        winRate: d.won + d.lost > 0 ? Math.round((d.won / (d.won + d.lost)) * 100) : null,
      }))
      .sort((a, b) => b.total - a.total);
  }, [quotes]);

  // ── Monthly trend ─────────────────────────────────────────────────────────

  const monthlyRows = React.useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const q of quotes) {
      if (!q.sent_at) continue;
      const d = new Date(q.sent_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const cur = map.get(key) ?? { count: 0, total: 0 };
      map.set(key, { count: cur.count + 1, total: cur.total + q.total_cents });
    }
    // Last 18 months in descending order, only show months with data
    const months = [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 18);
    return months.map(([key, d]) => {
      const [yr, mo] = key.split("-");
      const label = new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString("en-AU", { month: "short", year: "numeric" });
      return { key, label, count: d.count, total: d.total };
    });
  }, [quotes]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="eq-quotes__empty">Loading reports…</div>;
  if (error)   return <div className="eq-quotes__empty" style={{ color: "var(--eq-err,#c0392b)" }}>Error: {error}</div>;

  return (
    <div className="eq-quotes__reports">
      {/* Sub-tabs */}
      <div className="eq-quotes__reports-tabs">
        {(["pipeline", "aging", "estimators", "trend", "register"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`eq-quotes__view-tab${tab === t ? " eq-quotes__view-tab--active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "pipeline" ? "Pipeline" : t === "aging" ? "Aging" : t === "estimators" ? "By Estimator" : t === "trend" ? "Monthly" : "Register / Export"}
          </button>
        ))}
      </div>

      {/* ── Pipeline Summary ── */}
      {tab === "pipeline" && (
        <div className="eq-quotes__reports-section">
          <div className="eq-quotes__reports-kpis">
            <div className="eq-quotes__reports-kpi">
              <span className="eq-quotes__reports-kpi-value">{quotes.length}</span>
              <span className="eq-quotes__reports-kpi-label">Total live quotes</span>
            </div>
            <div className="eq-quotes__reports-kpi">
              <span className="eq-quotes__reports-kpi-value">{fmtMoney(pipelineValue)}</span>
              <span className="eq-quotes__reports-kpi-label">Active pipeline value</span>
            </div>
            <div className="eq-quotes__reports-kpi">
              <span className="eq-quotes__reports-kpi-value">
                {winRateData.rate !== null ? `${winRateData.rate}%` : "—"}
              </span>
              <span className="eq-quotes__reports-kpi-label">
                Win rate ({winRateData.won}W / {winRateData.lost}L)
              </span>
            </div>
          </div>

          <table className="eq-quotes__reports-table">
            <thead>
              <tr>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Quotes</th>
                <th style={{ textAlign: "right" }}>Total value (inc GST)</th>
              </tr>
            </thead>
            <tbody>
              {pipelineRows.map((r) => (
                <tr key={r.status} className={`eq-quotes__reports-row--${r.group}`}>
                  <td>{r.label}</td>
                  <td style={{ textAlign: "right" }}>{r.count}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Total</strong></td>
                <td style={{ textAlign: "right" }}><strong>{quotes.length}</strong></td>
                <td style={{ textAlign: "right" }}>
                  <strong>{fmtMoney(quotes.reduce((s, q) => s + q.total_cents, 0))}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── Aging ── */}
      {tab === "aging" && (
        <div className="eq-quotes__reports-section">
          <p className="eq-quotes__reports-hint">
            Active pipeline only (Draft, Submitted, Client Reviewing, On Hold). Age from creation date.
          </p>
          {agingRows.length === 0 ? (
            <div className="eq-quotes__empty">No active pipeline quotes.</div>
          ) : (
            <table className="eq-quotes__reports-table">
              <thead>
                <tr>
                  <th>Age</th>
                  <th style={{ textAlign: "right" }}>Quotes</th>
                  <th style={{ textAlign: "right" }}>Value (inc GST)</th>
                  <th style={{ textAlign: "right" }}>% of pipeline</th>
                </tr>
              </thead>
              <tbody>
                {agingRows.map((r) => (
                  <tr key={r.bucket} className={r.bucket === "> 90 days" ? "eq-quotes__reports-row--stale" : ""}>
                    <td>{r.bucket}</td>
                    <td style={{ textAlign: "right" }}>{r.count}</td>
                    <td style={{ textAlign: "right" }}>{fmtMoney(r.total)}</td>
                    <td style={{ textAlign: "right" }}>{r.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Quotes expiring soon */}
          {(() => {
            const expiring = quotes.filter((q) => {
              if (!q.expires_at || !PIPELINE_STATUSES.has(q.status)) return false;
              const days = Math.floor((new Date(q.expires_at).getTime() - Date.now()) / 86_400_000);
              return days >= 0 && days <= 14;
            }).sort((a, b) => new Date(a.expires_at!).getTime() - new Date(b.expires_at!).getTime());
            if (expiring.length === 0) return null;
            return (
              <>
                <h4 className="eq-quotes__reports-subhead">Expiring within 14 days</h4>
                <table className="eq-quotes__reports-table">
                  <thead><tr><th>Quote</th><th>Project</th><th>Customer</th><th style={{ textAlign: "right" }}>Expires</th></tr></thead>
                  <tbody>
                    {expiring.map((q) => (
                      <tr key={q.quote_id} className="eq-quotes__reports-row--warn">
                        <td>{q.quote_number}</td>
                        <td>{q.project_name ?? "—"}</td>
                        <td>{q.customer_name ?? "—"}</td>
                        <td style={{ textAlign: "right" }}>{new Date(q.expires_at!).toLocaleDateString("en-AU")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            );
          })()}
        </div>
      )}

      {/* ── By Estimator ── */}
      {tab === "estimators" && (
        <div className="eq-quotes__reports-section">
          <p className="eq-quotes__reports-hint">Win rate and pipeline value per estimator across all quote statuses.</p>
          <table className="eq-quotes__reports-table">
            <thead>
              <tr>
                <th>Estimator</th>
                <th style={{ textAlign: "right" }}>Won</th>
                <th style={{ textAlign: "right" }}>Lost</th>
                <th style={{ textAlign: "right" }}>Pipeline</th>
                <th style={{ textAlign: "right" }}>Win rate</th>
                <th style={{ textAlign: "right" }}>Total value</th>
              </tr>
            </thead>
            <tbody>
              {estimatorRows.map((r) => (
                <tr key={r.initials}>
                  <td>
                    {r.initials !== "(unassigned)" && (
                      <span className="eq-quotes__initials-badge" style={{ marginRight: "0.5rem" }}>{r.initials}</span>
                    )}
                    {r.name ?? r.initials}
                  </td>
                  <td style={{ textAlign: "right" }}>{r.won}</td>
                  <td style={{ textAlign: "right" }}>{r.lost}</td>
                  <td style={{ textAlign: "right" }}>{r.pipeline}</td>
                  <td style={{ textAlign: "right" }}>
                    {r.winRate !== null ? `${r.winRate}%` : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
            {estimatorRows.length === 0 && (
              <tbody><tr><td colSpan={6} style={{ textAlign: "center", color: "var(--eq-muted,#6b7280)" }}>No data.</td></tr></tbody>
            )}
          </table>
        </div>
      )}

      {/* ── Monthly Trend ── */}
      {tab === "trend" && (
        <div className="eq-quotes__reports-section">
          <p className="eq-quotes__reports-hint">Quotes sent per calendar month (by sent date). Last 18 months with activity.</p>
          <table className="eq-quotes__reports-table">
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: "right" }}>Quotes sent</th>
                <th style={{ textAlign: "right" }}>Total value (inc GST)</th>
              </tr>
            </thead>
            <tbody>
              {monthlyRows.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td style={{ textAlign: "right" }}>{r.count}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
            {monthlyRows.length === 0 && (
              <tbody><tr><td colSpan={3} style={{ textAlign: "center", color: "var(--eq-muted,#6b7280)" }}>No sent quotes yet.</td></tr></tbody>
            )}
          </table>
        </div>
      )}

      {/* ── Register / Export ── */}
      {tab === "register" && (
        <div className="eq-quotes__reports-section">
          <div className="eq-quotes__reports-export-bar">
            <span className="eq-quotes__reports-hint">{quotes.length} live quotes</span>
            <button
              type="button"
              className="eq-quotes__btn eq-quotes__btn--outline"
              onClick={handleExportCsv}
            >
              Download CSV
            </button>
          </div>
          <table className="eq-quotes__reports-table">
            <thead>
              <tr>
                <th>Quote No.</th>
                <th>Status</th>
                <th>Project</th>
                <th>Customer</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Margin</th>
                <th>Estimator</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.quote_id}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.85em" }}>{q.quote_number}</td>
                  <td>{STATUS_LABELS[q.status] ?? q.status}</td>
                  <td>{q.project_name ?? "—"}</td>
                  <td>{q.customer_name ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(q.total_cents)}</td>
                  <td style={{ textAlign: "right" }}>
                    {q.margin_pct !== null ? (q.margin_pct / 100).toFixed(1) + "%" : "—"}
                  </td>
                  <td>{q.estimator_initials ?? "—"}</td>
                  <td>{new Date(q.created_at).toLocaleDateString("en-AU")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
