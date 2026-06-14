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
  const [tab, setTab]         = useState<"pipeline" | "aging" | "register" | "estimators" | "trend" | "winloss">("pipeline");
  const [lossRows, setLossRows]   = useState<{
    quote_id: string; quote_number: string; status: string;
    project_name: string | null; estimator_initials: string | null;
    loss_reason: string | null; total_cents: number; customer_name: string | null;
    created_at: string;
  }[]>([]);
  const [lossLoading, setLossLoading] = useState(false);

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

  const loadLossReasons = useCallback(async () => {
    if (!supabase) return;
    setLossLoading(true);
    const { data, error: err } = await supabase.rpc("eq_list_loss_reasons");
    setLossLoading(false);
    if (err) { console.error("[QuotesReports] eq_list_loss_reasons:", err.message); return; }
    setLossRows(((data ?? []) as Record<string, unknown>[]).map((r) => ({
      quote_id:          String(r.quote_id),
      quote_number:      String(r.quote_number ?? ""),
      status:            String(r.status ?? ""),
      project_name:      r.project_name ? String(r.project_name) : null,
      estimator_initials: r.estimator_initials ? String(r.estimator_initials) : null,
      loss_reason:       r.loss_reason ? String(r.loss_reason) : null,
      total_cents:       Number(r.total_cents ?? 0),
      customer_name:     r.customer_name ? String(r.customer_name) : null,
      created_at:        String(r.created_at),
    })));
  }, [supabase]);

  useEffect(() => {
    if (tab === "winloss") void loadLossReasons();
  }, [tab, loadLossReasons]);

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
        {(["pipeline", "aging", "estimators", "trend", "winloss", "register"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`eq-quotes__view-tab${tab === t ? " eq-quotes__view-tab--active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "pipeline" ? "Pipeline" : t === "aging" ? "Aging" : t === "estimators" ? "By Estimator" : t === "trend" ? "Monthly" : t === "winloss" ? "Win / Loss" : "Register / Export"}
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
          <div className="eq-quotes__reports-export-bar">
            <span className="eq-quotes__reports-hint">Active pipeline only — age from creation date.</span>
            {agingRows.length > 0 && (
              <button type="button" className="eq-quotes__btn eq-quotes__btn--outline"
                onClick={() => downloadCsv(
                  [["Age bucket", "Quotes", "Value inc GST", "% of pipeline"],
                   ...agingRows.map((r) => [r.bucket, r.count, (r.total / 100).toFixed(2), r.pct])],
                  "sks-quotes-aging.csv"
                )}>Download CSV</button>
            )}
          </div>
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
          <div className="eq-quotes__reports-export-bar">
            <span className="eq-quotes__reports-hint">Win rate and pipeline per estimator — all statuses.</span>
            {estimatorRows.length > 0 && (
              <button type="button" className="eq-quotes__btn eq-quotes__btn--outline"
                onClick={() => downloadCsv(
                  [["Estimator", "Won", "Lost", "Pipeline", "Win rate %", "Total value"],
                   ...estimatorRows.map((r) => [r.name ?? r.initials, r.won, r.lost, r.pipeline, r.winRate !== null ? r.winRate : "", (r.total / 100).toFixed(2)])],
                  "sks-quotes-by-estimator.csv"
                )}>Download CSV</button>
            )}
          </div>
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
          <div className="eq-quotes__reports-export-bar">
            <span className="eq-quotes__reports-hint">Quotes sent per month (by sent date) — last 18 months.</span>
            {monthlyRows.length > 0 && (
              <button type="button" className="eq-quotes__btn eq-quotes__btn--outline"
                onClick={() => downloadCsv(
                  [["Month", "Quotes sent", "Total value inc GST"],
                   ...monthlyRows.map((r) => [r.label, r.count, (r.total / 100).toFixed(2)])],
                  "sks-quotes-monthly-trend.csv"
                )}>Download CSV</button>
            )}
          </div>
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

      {/* ── Win / Loss Reasons ── */}
      {tab === "winloss" && (
        <div className="eq-quotes__reports-section">
          {lossLoading && <p className="eq-quotes__reports-hint">Loading…</p>}
          {!lossLoading && lossRows.length === 0 && (
            <p className="eq-quotes__reports-hint">No lost, cancelled, or expired quotes.</p>
          )}
          {!lossLoading && lossRows.length > 0 && (
            <>
              <p className="eq-quotes__reports-hint">
                {lossRows.length} closed-out quote{lossRows.length !== 1 ? "s" : ""} — lost, cancelled, expired, or superseded.
              </p>
              {/* Reason breakdown */}
              {(() => {
                const reasons = new Map<string, { count: number; total: number }>();
                for (const r of lossRows) {
                  const key = r.loss_reason ?? "(no reason given)";
                  const cur = reasons.get(key) ?? { count: 0, total: 0 };
                  reasons.set(key, { count: cur.count + 1, total: cur.total + r.total_cents });
                }
                const sorted = [...reasons.entries()].sort((a, b) => b[1].count - a[1].count);
                return (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
                    {sorted.map(([reason, d]) => (
                      <span key={reason} style={{
                        background: "var(--eq-ice,#EAF5FB)",
                        border: "1px solid var(--eq-border,#e5e7eb)",
                        borderRadius: "4px",
                        padding: "4px 10px",
                        fontSize: "0.82rem",
                      }}>
                        {reason} <strong>{d.count}</strong>
                        <span style={{ marginLeft: "0.4rem", color: "var(--eq-muted,#6b7280)" }}>{fmtMoney(d.total)}</span>
                      </span>
                    ))}
                  </div>
                );
              })()}
              <div className="eq-quotes__reports-export-bar" style={{ marginBottom: "0.5rem" }}>
                <span />
                <button type="button" className="eq-quotes__btn eq-quotes__btn--outline"
                  onClick={() => downloadCsv(
                    [["Quote No.", "Status", "Customer", "Project", "Loss reason", "Value inc GST", "Estimator", "Date"],
                     ...lossRows.map((r) => [r.quote_number, r.status, r.customer_name ?? "", r.project_name ?? "", r.loss_reason ?? "", (r.total_cents / 100).toFixed(2), r.estimator_initials ?? "", new Date(r.created_at).toLocaleDateString("en-AU")])],
                    "sks-quotes-win-loss.csv"
                  )}>Download CSV</button>
              </div>
              <table className="eq-quotes__reports-table">
                <thead>
                  <tr>
                    <th>Quote No.</th>
                    <th>Status</th>
                    <th>Customer</th>
                    <th>Project</th>
                    <th>Reason</th>
                    <th style={{ textAlign: "right" }}>Value</th>
                    <th>Est.</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {lossRows.map((r) => (
                    <tr key={r.quote_id}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.85em" }}>{r.quote_number}</td>
                      <td>{STATUS_LABELS[r.status] ?? r.status}</td>
                      <td>{r.customer_name ?? "—"}</td>
                      <td>{r.project_name ?? "—"}</td>
                      <td style={{ color: r.loss_reason ? undefined : "var(--eq-muted,#6b7280)" }}>
                        {r.loss_reason ?? "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtMoney(r.total_cents)}</td>
                      <td>
                        {r.estimator_initials
                          ? <span className="eq-quotes__initials-badge">{r.estimator_initials}</span>
                          : "—"
                        }
                      </td>
                      <td>{new Date(r.created_at).toLocaleDateString("en-AU")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
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
