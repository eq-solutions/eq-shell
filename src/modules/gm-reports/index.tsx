import { useState, useRef, useEffect, useCallback } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { HubLayout } from '../../components/HubLayout';
import { Gate } from '../../permissions/Gate';
import { EqTable, type ColDef } from '../../components/EqTable';
import { defaultSidebarRecords } from '../../lib/sidebarConfig';
import './gm-reports.css';

const SIDEBAR_RECORDS = defaultSidebarRecords();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Period {
  id:                    string;
  period_code:           string;
  uploaded_at:           string;
  is_archived:           boolean;
  total_contract:        number;
  net_cash_position:     number;
  gp_at_completion:      number;
  overall_gp_pct:        number;
  cash_neg_count:        number;
  forecast_loss_count:   number;
  outstanding_pos:       number;
  briefing_generated_at: string | null;
}

interface Job {
  id:               string;
  job_manager:      string;
  job_code:         string;
  job_description:  string;
  wip_code:         string | null;
  contract_valuation: number;
  jtd_invoicing:    number;
  jtd_cost_val:     number;
  gross_profit:     number | null;
  gp_pct:           number | null;
  outstanding_pos:  number;
  cash_gap:         number;
  is_cash_negative: boolean;
  is_forecast_loss: boolean;
  is_overhead:      boolean;
}

interface Briefing {
  top_concern:    string;
  critical_jobs:  { job_code: string; job_description: string; job_manager: string; contract_value: number; cash_gap: number; gp_forecast: number; action: string }[];
  watch_jobs:     { job_code: string; job_description: string; job_manager: string; cash_gap: number; gp_forecast: number; action: string }[];
  pm_summary:     { name: string; job_count: number; cash_position: number; gp_forecast: number; status: 'red' | 'amber' | 'green'; note: string }[];
  portfolio_note: string;
}

interface ChatMessage { role: 'user' | 'assistant'; content: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number | null | undefined, prefix = '$'): string {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '+';
  if (abs >= 1_000_000) return `${sign}${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}${prefix}${Math.round(abs / 1_000)}k`;
  return `${sign}${prefix}${Math.round(abs).toLocaleString()}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${(n * 100).toFixed(1)}%`;
}


// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'red' | 'amber' | 'green' | 'blue' }) {
  const accentMap: Record<string, string> = {
    red:   'var(--eq-error, #C0392B)',
    amber: 'var(--eq-warning, #B7770D)',
    green: 'var(--eq-success, #1E7E4A)',
    blue:  'var(--eq-sky, #3DA8D8)',
  };
  const color = accent ? accentMap[accent] : 'var(--eq-ink, #1A1A2E)';
  return (
    <div className="gm-kpi-card" style={{ borderTop: `3px solid ${color}` }}>
      <div className="gm-kpi-card__label">{label}</div>
      <div className="gm-kpi-card__value" style={{ color }}>{value}</div>
      {sub && <div className="gm-kpi-card__sub">{sub}</div>}
    </div>
  );
}

const BADGE_LABELS: Record<string, string> = {
  loss: 'Forecast loss',
  watch: 'Invoice needed',
  ok: 'On track',
};
function Badge({ type }: { type: 'loss' | 'watch' | 'ok' }) {
  return (
    <span className={`gm-badge gm-badge--${type}`}>{BADGE_LABELS[type]}</span>
  );
}

// ---------------------------------------------------------------------------
// Shared section label
// ---------------------------------------------------------------------------

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="gm-section-label">
      {text}<span className="gm-section-label__rule" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job table column definitions (module-level — no recreation on render)
// ---------------------------------------------------------------------------

const JOB_COLS: ColDef<Job>[] = [
  {
    key: 'job',
    header: 'Job',
    sortValue: j => j.job_code,
    render: j => (
      <div>
        <div style={{ fontWeight: 600 }}>{j.job_code} — {j.job_description}</div>
        <div style={{ fontSize: 11, color: '#6B7A99', marginTop: 1 }}>
          {j.job_manager} · {fmt(j.contract_valuation, '$').replace(/^[+-]/, '')} contract
          {j.outstanding_pos > 0 ? ` · ${fmt(j.outstanding_pos, '$').replace(/^[+-]/, '')} POs` : ''}
        </div>
      </div>
    ),
  },
  {
    key: 'wip', header: 'WIP', align: 'right', width: 60,
    sortValue: j => j.wip_code ?? '',
    render: j => <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6B7A99' }}>{j.wip_code ?? '—'}</span>,
  },
  {
    key: 'cash_gap', header: 'Cash Gap', align: 'right', width: 90,
    // positive cash_gap = deficit; sort desc → worst deficit first
    sortValue: j => j.cash_gap,
    render: j => (
      <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: j.is_cash_negative ? 600 : 400, color: j.is_cash_negative ? '#C0392B' : '#1E7E4A' }}>
        {fmt(-j.cash_gap)}
      </span>
    ),
  },
  {
    key: 'gp', header: 'GP', align: 'right', width: 80,
    sortValue: j => j.gross_profit ?? 0,
    render: j => (
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: (j.gross_profit ?? 0) < 0 ? '#C0392B' : '#1E7E4A' }}>
        {fmt(j.gross_profit)}
      </span>
    ),
  },
  {
    key: 'status', header: 'Status', align: 'right', width: 110,
    // Severity: 2=loss, 1=cash-neg, 0=ok → desc puts worst first
    sortValue: j => j.is_forecast_loss ? 2 : j.is_cash_negative ? 1 : 0,
    render: j => <Badge type={j.is_forecast_loss ? 'loss' : j.is_cash_negative ? 'watch' : 'ok'} />,
  },
];

// ---------------------------------------------------------------------------
// Chat panel
// ---------------------------------------------------------------------------

function ChatPanel({ periodId, briefing }: { periodId: string; briefing: Briefing | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (briefing) {
      setMessages([{
        role: 'assistant',
        content: briefing.top_concern + '\n\nWhat would you like to dig into?',
      }]);
    }
  }, [briefing]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function send(text: string) {
    if (!text.trim() || sending) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/.netlify/functions/gm-chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_id: periodId, messages: next }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { ok: boolean; message?: string };
      setMessages(m => [...m, { role: 'assistant', content: data.message ?? 'Something went wrong.' }]);
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', content: `Could not reach the server. ${err instanceof Error ? err.message : ''}`.trim() }]);
    } finally {
      setSending(false);
    }
  }

  const chips = briefing ? [
    `What should I say to ${briefing.critical_jobs[0]?.job_manager ?? 'the PM'} about ${briefing.critical_jobs[0]?.job_code ?? 'the critical job'}?`,
    'Which jobs need invoices pushed this week?',
    'Give me a one-paragraph board summary',
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div className="gm-chat-header">
        <div className="gm-chat-header__title">
          <span className="gm-chat-header__dot" aria-hidden="true" />
          Ask Claude
        </div>
        <div className="gm-chat-header__sub">AI analyst for this report</div>
      </div>

      {/* Messages + chips inline so there's no dead space */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!briefing && messages.length === 0 && (
          <div style={{ fontSize: 13, color: '#6B7A99', textAlign: 'center', padding: '24px 8px', lineHeight: 1.6 }}>
            Generate the AI briefing above to start the conversation.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '90%',
            background: m.role === 'user' ? 'var(--eq-ink, #1A1A2E)' : '#F7FAFC',
            color: m.role === 'user' ? '#fff' : 'var(--eq-ink, #1A1A2E)',
            border: m.role === 'assistant' ? '1px solid #E2EAF0' : 'none',
            borderRadius: 12,
            borderBottomLeftRadius: m.role === 'assistant' ? 3 : 12,
            borderBottomRightRadius: m.role === 'user' ? 3 : 12,
            padding: '9px 13px',
            fontSize: 13,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
          }}>
            {m.content}
          </div>
        ))}
        {/* Chips appear inline right after the first message — no empty gap */}
        {chips.length > 0 && messages.length <= 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
            {chips.map((c, i) => (
              <button key={i} onClick={() => send(c)} style={{ background: '#fff', border: '1px solid #E2EAF0', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--eq-ink, #1A1A2E)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', lineHeight: 1.4 }}>
                {c}
              </button>
            ))}
          </div>
        )}
        {sending && (
          <div style={{ alignSelf: 'flex-start', background: '#F7FAFC', border: '1px solid #E2EAF0', borderRadius: 12, borderBottomLeftRadius: 3, padding: '12px 14px', display: 'flex', gap: 4 }}>
            {[0, 0.2, 0.4].map((d, i) => (
              <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#6B7A99', display: 'inline-block', animation: `gm-bounce 1.2s ${d}s infinite` }} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid #E2EAF0', display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1, border: '1px solid #E2EAF0', borderRadius: 20, padding: '8px 13px', fontSize: 13, fontFamily: 'inherit', color: 'var(--eq-ink, #1A1A2E)', background: '#F7FAFC', outline: 'none' }}
          placeholder={briefing ? 'Ask anything about these jobs…' : 'Generate briefing first…'}
          value={input}
          disabled={!briefing || sending}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(input); }}
        />
        <button
          onClick={() => send(input)}
          disabled={!briefing || sending || !input.trim()}
          style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--eq-ink, #1A1A2E)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: (!briefing || sending || !input.trim()) ? 0.4 : 1 }}
        >
          <svg viewBox="0 0 24 24" width={15} height={15} fill="#fff"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
        </button>
      </div>
      <div className="gm-chat-footer">Powered by Claude · Based on this period's data</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Period detail view
// ---------------------------------------------------------------------------

function PeriodDetail({ period, onBack }: { period: Period; onBack: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [generatingBriefing, setGeneratingBriefing] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);
  const [selectedPMs, setSelectedPMs] = useState<string[]>([]);
  const [selectedWip, setSelectedWip] = useState<string | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoadingJobs(true);
      setJobsError(null);
      try {
        const res = await fetch(`/.netlify/functions/gm-reports?id=${period.id}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data = await res.json() as { ok: boolean; period: Period & { briefing?: Briefing }; jobs: Job[] };
        setJobs(data.jobs ?? []);
        if (data.period?.briefing) setBriefing(data.period.briefing as Briefing);
      } catch {
        setJobsError("Couldn't load this period's jobs — check your connection and try again.");
      } finally {
        setLoadingJobs(false);
      }
    })();
  }, [period.id]);

  const generateBriefing = useCallback(async () => {
    setGeneratingBriefing(true);
    setBriefingError(null);
    try {
      const res = await fetch('/.netlify/functions/generate-gm-briefing', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_id: period.id }),
      });
      const data = await res.json() as { ok: boolean; briefing?: Briefing; error?: string; detail?: string };
      if (!res.ok || !data.briefing) {
        setBriefingError(data.detail ?? data.error ?? `Server error ${res.status}`);
        return;
      }
      setBriefing(data.briefing);
    } catch (e) {
      setBriefingError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setGeneratingBriefing(false);
    }
  }, [period.id]);

  // Derive filter options from jobs data
  const allWips = [...new Set(jobs.map(j => j.wip_code).filter((w): w is string => !!w))].sort();

  // Apply filters — PMs is multi-select, WIP is single
  const filtered = jobs.filter(j => {
    if (selectedPMs.length > 0 && !selectedPMs.includes(j.job_manager)) return false;
    if (selectedWip && j.wip_code !== selectedWip) return false;
    return true;
  });

  const isFiltered = !!(selectedPMs.length > 0 || selectedWip);
  const nonOverhead = filtered.filter(j => !j.is_overhead);
  const critical = filtered.filter(j => j.is_forecast_loss && !j.is_overhead);
  const watch    = filtered.filter(j => j.is_cash_negative && !j.is_forecast_loss && !j.is_overhead && j.cash_gap > 20_000);

  // When a filter is active, compute KPIs from the filtered (non-overhead) jobs
  const fKpis = isFiltered ? {
    total_contract:   nonOverhead.reduce((s, j) => s + (j.contract_valuation ?? 0), 0),
    net_cash:         nonOverhead.reduce((s, j) => s - (j.cash_gap ?? 0), 0),
    gp:               nonOverhead.reduce((s, j) => s + (j.gross_profit ?? 0), 0),
    gp_pct:           (() => {
      const cv = nonOverhead.reduce((s, j) => s + (j.contract_valuation ?? 0), 0);
      const gp = nonOverhead.reduce((s, j) => s + (j.gross_profit ?? 0), 0);
      return cv > 0 ? gp / cv : 0;
    })(),
    cash_neg_count:   nonOverhead.filter(j => j.is_cash_negative).length,
    loss_count:       nonOverhead.filter(j => j.is_forecast_loss).length,
    outstanding_pos:  nonOverhead.reduce((s, j) => s + (j.outstanding_pos ?? 0), 0),
  } : null;

  // Chip style helpers
  const chipBase = 'gm-chip';
  const chipActive = 'gm-chip gm-chip--active';

  return (
    // Flex column: sub-header (fixed) + body row (fills rest)
    // 52px = module page header in GmReportsModule
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100svh - 52px)' }}>

      {/* Sub-header */}
      <div style={{ height: 48, flexShrink: 0, background: '#F7FAFC', borderBottom: '1px solid #E2EAF0', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--eq-sky, #3DA8D8)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}>
          ← Reports
        </button>
        <span style={{ color: '#C8D4DF' }}>|</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--eq-ink, #1A1A2E)' }}>Period {period.period_code}</span>
        <span style={{ fontSize: 12, color: '#6B7A99' }}>
          {new Date(period.uploaded_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {briefingError && (
            <span style={{ fontSize: 11, color: '#C0392B', background: '#FDECEA', padding: '4px 10px', borderRadius: 20, maxWidth: 260, display: 'inline-flex', alignItems: 'center', gap: 4 }} title={briefingError}>
              <AlertTriangle size={12} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{briefingError}</span>
            </span>
          )}
          {!briefing && (
            <button onClick={generateBriefing} disabled={generatingBriefing}
              style={{ background: 'var(--eq-sky, #3DA8D8)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: generatingBriefing ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
              {generatingBriefing && <span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'gm-spin 0.7s linear infinite', flexShrink: 0 }} />}
              {generatingBriefing ? 'Generating…' : briefingError ? 'Retry' : 'Generate AI briefing'}
            </button>
          )}
          {briefing && <span style={{ fontSize: 11, color: '#1E7E4A', background: '#EAF5EE', padding: '4px 10px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={12} aria-hidden="true" />Briefing ready</span>}
        </div>
      </div>

      {/* Filter bar — WIP only; PM is now handled via the right-rail scorecard */}
      {(allWips.length > 1 || isFiltered) && (
        <div style={{ flexShrink: 0, borderBottom: '1px solid #E2EAF0', background: '#fff', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12, overflowX: 'auto' }}>
          {allWips.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#6B7A99' }}>WIP</span>
              <button className={!selectedWip ? chipActive : chipBase} onClick={() => setSelectedWip(null)}>All</button>
              {allWips.map(w => (
                <button key={w} className={selectedWip === w ? chipActive : chipBase} onClick={() => setSelectedWip(selectedWip === w ? null : w)}>{w}</button>
              ))}
            </div>
          )}
          {/* PM active filter summary — driven by scorecard clicks */}
          {selectedPMs.length > 0 && (
            <>
              <div style={{ width: 1, height: 20, background: '#E2EAF0', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--eq-sky, #3DA8D8)', background: 'var(--eq-ice, #EAF5FB)', padding: '3px 10px', borderRadius: 20, fontWeight: 500, flexShrink: 0 }}>
                {selectedPMs.length === 1 ? selectedPMs[0] : `${selectedPMs.length} PMs selected`}
              </span>
            </>
          )}
          {isFiltered && (
            <button style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 11, color: '#6B7A99', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
              onClick={() => { setSelectedPMs([]); setSelectedWip(null); }}>
              Clear filters ×
            </button>
          )}
        </div>
      )}

      {/* Body: left scrolls, right chat is fixed */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* Left column — scrolls */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', minWidth: 0 }}>
          {briefingError && (
            <div className="gm-error-banner">
              <AlertTriangle size={18} aria-hidden="true" className="gm-error-banner__icon" />
              <div>
                <div className="gm-error-banner__title">AI briefing failed</div>
                <div className="gm-error-banner__detail" style={{ fontFamily: 'monospace' }}>{briefingError}</div>
              </div>
            </div>
          )}

          {jobsError && (
            <div className="gm-error-banner">
              <AlertTriangle size={18} aria-hidden="true" className="gm-error-banner__icon" />
              <div style={{ fontSize: 13, color: '#7B1414' }}>{jobsError}</div>
            </div>
          )}

          {/* KPIs — update to filtered values when a filter is active */}
          {isFiltered && (
            <div style={{ fontSize: 11, color: 'var(--eq-sky, #3DA8D8)', background: 'var(--eq-ice, #EAF5FB)', borderRadius: 6, padding: '5px 12px', marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              ⚡ Showing figures for {[selectedPMs.length === 1 ? selectedPMs[0] : selectedPMs.length > 1 ? `${selectedPMs.length} PMs` : null, selectedWip ? `WIP: ${selectedWip}` : null].filter(Boolean).join(' · ')}
            </div>
          )}
          <div className="gm-kpi-grid">
            <KpiCard label="Total contract value" value={fmt(fKpis?.total_contract ?? period.total_contract).replace(/^[+-]/, '')} sub={isFiltered ? `${nonOverhead.length} jobs` : 'Active portfolio'} />
            <KpiCard label="Net cash position"    value={fmt(fKpis?.net_cash ?? period.net_cash_position)} sub="Invoiced vs spent" accent={(fKpis?.net_cash ?? period.net_cash_position) >= 0 ? 'green' : 'red'} />
            <KpiCard label="Overall GP%"          value={fmtPct(fKpis?.gp_pct ?? period.overall_gp_pct)} sub={`${fmt(fKpis?.gp ?? period.gp_at_completion)} at completion`} accent="blue" />
            <KpiCard label="Jobs in cash deficit" value={String(fKpis?.cash_neg_count ?? period.cash_neg_count)} sub="Spent more than claimed" accent={(fKpis?.cash_neg_count ?? period.cash_neg_count) > 0 ? 'amber' : undefined} />
            <KpiCard label="Forecast losses"      value={String(fKpis?.loss_count ?? period.forecast_loss_count)} sub="GP at completion < $0" accent={(fKpis?.loss_count ?? period.forecast_loss_count) > 0 ? 'red' : 'green'} />
            <KpiCard label="Outstanding POs"      value={fmt(fKpis?.outstanding_pos ?? period.outstanding_pos).replace(/^[+-]/, '')} sub="Committed, not yet cost" accent="blue" />
          </div>

          {/* AI top concern */}
          {briefing?.top_concern && (
            <div className="gm-concern-banner">
              <strong>AI:</strong> {briefing.top_concern}
            </div>
          )}

          {/* Critical jobs */}
          {critical.length > 0 && (
            <>
              <SectionLabel text="Critical — needs a conversation" />
              <EqTable data={critical} columns={JOB_COLS} rowKey={j => j.id}
                rowStyle={() => ({ background: '#FDECEA' })}
                defaultSort={{ key: 'cash_gap', dir: 'desc' }}
                style={{ marginBottom: 16 }} />
            </>
          )}

          {/* Watch jobs */}
          {watch.length > 0 && (
            <>
              <SectionLabel text="Watch — large cash gap, GP positive" />
              <EqTable data={watch} columns={JOB_COLS} rowKey={j => j.id}
                rowStyle={() => ({ background: '#FEF6E4' })}
                defaultSort={{ key: 'cash_gap', dir: 'desc' }}
                style={{ marginBottom: 16 }} />
            </>
          )}

          {/* All jobs for selected PMs — sortable, defaults to severity (losses first) */}
          {selectedPMs.length > 0 && nonOverhead.length > 0 && (
            <>
              <SectionLabel text={`All jobs — ${selectedPMs.length === 1 ? selectedPMs[0] : `${selectedPMs.length} PMs`}`} />
              <EqTable data={nonOverhead} columns={JOB_COLS} rowKey={j => j.id}
                rowStyle={j => ({ background: j.is_forecast_loss ? '#FDECEA' : j.is_cash_negative ? '#FEF6E4' : '#fff' })}
                defaultSort={{ key: 'status', dir: 'desc' }}
                style={{ marginBottom: 16 }} />
            </>
          )}

          {selectedPMs.length === 0 && !selectedWip && critical.length === 0 && watch.length === 0 && !loadingJobs && (
            <div style={{ textAlign: 'center', color: '#6B7A99', padding: '24px 0', fontSize: 13 }}>No critical or watch jobs this period.</div>
          )}

          {/* Portfolio note */}
          {briefing?.portfolio_note && (
            <div className="gm-note-banner">
              <strong style={{ color: 'var(--eq-ink, #1A1A2E)' }}>Note:</strong> {briefing.portfolio_note}
            </div>
          )}

          {loadingJobs && <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><span className="eq-skeleton eq-skeleton--text" style={{ width: 120 }} /></div>}
        </div>

        {/* Right column — PM filter (top, from jobs data) + chat (fills rest) */}
        <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #E2EAF0', background: '#fff', overflow: 'hidden' }}>

          {/* PM filter — built from jobs, always visible once loaded.
              Augmented with briefing status colours when available. */}
          {jobs.length > 0 && (() => {
            const pmNames = [...new Set(jobs.filter(j => !j.is_overhead).map(j => j.job_manager))].sort();
            const briefingMap = new Map(briefing?.pm_summary?.map(pm => [pm.name, pm]) ?? []);
            return (
              <div style={{ flexShrink: 0, borderBottom: '1px solid #E2EAF0', overflowY: 'auto', maxHeight: 280 }}>
                {/* Sticky header */}
                <div style={{ position: 'sticky', top: 0, zIndex: 1, background: '#F7FAFC', borderBottom: '1px solid #EEF2F7', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#6B7A99' }}>Project Managers</span>
                    <span style={{ fontSize: 10, color: '#C8D4DF' }}>multi-select</span>
                  </div>
                  {selectedPMs.length > 0 && (
                    <button onClick={() => setSelectedPMs([])} style={{ fontSize: 10, color: 'var(--eq-sky, #3DA8D8)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                      Clear ×
                    </button>
                  )}
                </div>
                {/* PM rows — click to toggle, multi-select */}
                {pmNames.map(name => {
                  const isActive   = selectedPMs.includes(name);
                  const bpm        = briefingMap.get(name);
                  const pmJobs     = jobs.filter(j => !j.is_overhead && j.job_manager === name);
                  const cash       = -pmJobs.reduce((s, j) => s + (j.cash_gap ?? 0), 0);
                  const gp         = pmJobs.reduce((s, j) => s + (j.gross_profit ?? 0), 0);
                  const losses     = pmJobs.filter(j => j.is_forecast_loss).length;
                  const initials   = name.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
                  // Status from briefing if available, else derive from jobs
                  const status     = bpm?.status ?? (losses > 0 ? 'red' : cash < 0 ? 'amber' : 'green');
                  const statusDot  = status === 'red' ? '#C0392B' : status === 'amber' ? '#E6A817' : '#1E7E4A';
                  const statusBg   = status === 'red' ? '#FDECEA' : status === 'amber' ? '#FEF6E4' : '#EAF5EE';
                  return (
                    <div key={name}
                      onClick={() => setSelectedPMs(prev => isActive ? prev.filter(p => p !== name) : [...prev, name])}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid #EEF2F7', background: isActive ? 'var(--eq-ice, #EAF5FB)' : 'transparent', transition: 'background 0.1s' }}>
                      {/* Avatar — filled blue with ✓ when active */}
                      <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700,
                        background: isActive ? 'var(--eq-sky, #3DA8D8)' : statusBg,
                        color: isActive ? '#fff' : statusDot,
                        border: `2px solid ${isActive ? 'var(--eq-sky, #3DA8D8)' : 'transparent'}`,
                      }}>
                        {isActive ? <Check size={14} aria-hidden="true" /> : initials}
                      </div>
                      {/* Name + job count */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: isActive ? 700 : 500, color: 'var(--eq-ink, #1A1A2E)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                        <div style={{ fontSize: 10, color: '#9AA5BC', marginTop: 1 }}>{pmJobs.length} jobs{losses > 0 ? ` · ${losses} loss${losses > 1 ? 'es' : ''}` : ''}</div>
                      </div>
                      {/* Cash position */}
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: cash >= 0 ? '#1E7E4A' : '#C0392B', fontFamily: 'monospace' }}>{fmt(cash)}</div>
                        <div style={{ fontSize: 10, color: gp >= 0 ? '#1E7E4A' : '#C0392B', fontFamily: 'monospace' }}>GP {fmt(gp)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Chat fills remaining height */}
          <ChatPanel periodId={period.id} briefing={briefing} />
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Period list + upload
// ---------------------------------------------------------------------------

function PeriodList({ onSelect }: { onSelect: (p: Period) => void }) {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (archived: boolean) => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = archived ? '?archived=true' : '';
      const res = await fetch(`/.netlify/functions/gm-reports${qs}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { ok: boolean; periods?: Period[] };
      setPeriods(data.periods ?? []);
    } catch {
      setLoadError("Couldn't load reports — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(showArchived); }, [load, showArchived]);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/.netlify/functions/upload-gm-report', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const data = await res.json() as { ok?: boolean; error?: string; detail?: string };
      if (!data.ok) {
        setUploadError(data.detail ?? data.error ?? 'Upload failed');
      } else {
        await load(showArchived);
      }
    } catch {
      setUploadError('Upload failed — check your connection');
    } finally {
      setUploading(false);
    }
  }

  async function handleArchive(id: string, archive: boolean) {
    setActionLoading(id);
    setActionError(null);
    try {
      const res = await fetch(`/.netlify/functions/manage-gm-report?id=${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: archive }),
      });
      if (res.ok) setPeriods(ps => ps.filter(p => p.id !== id));
      else setActionError(archive ? "Couldn't archive that report." : "Couldn't restore that report.");
    } catch {
      setActionError('Something went wrong — check your connection and try again.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(id: string) {
    setActionLoading(id);
    setActionError(null);
    try {
      const res = await fetch(`/.netlify/functions/manage-gm-report?id=${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setPeriods(ps => ps.filter(p => p.id !== id));
        setConfirmDelete(null);
      } else {
        setActionError("Couldn't delete that report.");
      }
    } catch {
      setActionError('Something went wrong — check your connection and try again.');
    } finally {
      setActionLoading(null);
    }
  }

  const actionBtn: React.CSSProperties = {
    background: 'none', border: '1px solid #E2EAF0', borderRadius: 6,
    padding: '4px 10px', fontSize: 11, color: '#6B7A99', cursor: 'pointer',
    fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all 0.1s',
  };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px' }}>

      {/* Upload zone */}
      <div
        className="gm-upload-zone"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }} />
        <div className="gm-upload-zone__icon">📊</div>
        <div className="gm-upload-zone__title">
          {uploading ? 'Uploading…' : 'Drop Workbench report here'}
        </div>
        <div className="gm-upload-zone__hint">
          Project Manager Live Update Report (.xlsx) · or click to browse
        </div>
        {uploadError && <div className="gm-upload-zone__error">{uploadError}</div>}
      </div>

      {/* List header */}
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1.2px', color: '#6B7A99', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        {showArchived ? 'Archived periods' : 'Uploaded periods'}
        <span style={{ flex: 1, height: 1, background: '#E2EAF0', display: 'block' }} />
        <button
          onClick={() => setShowArchived(v => !v)}
          style={{ ...actionBtn, color: showArchived ? 'var(--eq-sky, #3DA8D8)' : '#6B7A99', borderColor: showArchived ? 'var(--eq-sky, #3DA8D8)' : '#E2EAF0' }}
        >
          {showArchived ? '← Active' : 'Show archived'}
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', color: '#6B7A99', padding: 24 }}>Loading…</div>}

      {!loading && loadError && (
        <div style={{ background: '#FDECEA', border: '1px solid #F5C6CB', borderRadius: 8, padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, color: '#7B1414' }} />
          <div style={{ flex: 1, fontSize: 13, color: '#7B1414' }}>{loadError}</div>
          <button onClick={() => void load(showArchived)} style={{ ...actionBtn, color: '#7B1414', borderColor: '#F5C6CB' }}>Retry</button>
        </div>
      )}

      {actionError && (
        <div style={{ background: '#FDECEA', border: '1px solid #F5C6CB', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#7B1414' }}>{actionError}</div>
      )}

      {!loading && !loadError && periods.length === 0 && (
        <div style={{ textAlign: 'center', color: '#6B7A99', padding: 24, fontSize: 13 }}>
          {showArchived ? 'No archived reports.' : 'No reports uploaded yet. Drop a Workbench export above to get started.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {periods.map(p => {
          const cashColor  = p.net_cash_position >= 0 ? '#1E7E4A' : '#C0392B';
          const lossAccent = p.forecast_loss_count > 5 ? '#C0392B' : p.forecast_loss_count > 0 ? '#B7770D' : '#1E7E4A';
          const isDeleting = confirmDelete === p.id;
          const isBusy     = actionLoading === p.id;

          return (
            <div key={p.id} className="gm-period-row">

              {/* Main clickable area — opens period detail */}
              <button
                onClick={() => !showArchived && onSelect(p)}
                disabled={showArchived}
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, background: 'none', border: 'none', cursor: showArchived ? 'default' : 'pointer', textAlign: 'left', fontFamily: 'inherit', padding: 0, minWidth: 0 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--eq-ink, #1A1A2E)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    Period {p.period_code}
                    {p.is_archived && <span style={{ fontSize: 9, fontWeight: 700, color: '#9AA5BC', background: '#F2F4F7', padding: '2px 6px', borderRadius: 4, letterSpacing: '0.5px' }}>ARCHIVED</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#6B7A99', marginTop: 2 }}>
                    Uploaded {new Date(p.uploaded_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {p.briefing_generated_at ? ' · AI briefing ready' : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: cashColor }}>{fmt(p.net_cash_position)}</div>
                  <div style={{ fontSize: 9, color: '#6B7A99', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Net cash</div>
                </div>
                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: lossAccent }}>{p.forecast_loss_count}</div>
                  <div style={{ fontSize: 9, color: '#6B7A99', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Losses</div>
                </div>
                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--eq-sky, #3DA8D8)' }}>{fmtPct(p.overall_gp_pct)}</div>
                  <div style={{ fontSize: 9, color: '#6B7A99', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GP%</div>
                </div>
                {!showArchived && <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="#C8D4DF" strokeWidth={2} style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6"/></svg>}
              </button>

              {/* Separator */}
              <div className="gm-period-row__divider" />

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {/* Replace (active only) — re-upload same period code → upsert handles it */}
                {!showArchived && (
                  <>
                    <input type="file" accept=".xlsx,.xls" id={`ru-${p.id}`} style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }} />
                    <label htmlFor={`ru-${p.id}`} style={{ ...actionBtn, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      ↻ Replace
                    </label>
                  </>
                )}

                {/* Archive / Restore */}
                <button disabled={isBusy} onClick={() => handleArchive(p.id, !p.is_archived)}
                  style={{ ...actionBtn, opacity: isBusy ? 0.5 : 1 }}>
                  {p.is_archived ? '↩ Restore' : '🗄 Archive'}
                </button>

                {/* Delete — two-step inline confirm */}
                {isDeleting ? (
                  <>
                    <button disabled={isBusy} onClick={() => handleDelete(p.id)}
                      style={{ ...actionBtn, background: '#C0392B', color: '#fff', borderColor: '#C0392B', opacity: isBusy ? 0.5 : 1 }}>
                      {isBusy ? 'Deleting…' : 'Confirm delete'}
                    </button>
                    <button onClick={() => setConfirmDelete(null)} style={actionBtn}>Cancel</button>
                  </>
                ) : (
                  <button onClick={() => { setConfirmDelete(p.id); }} style={actionBtn}>
                    🗑 Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module root
// ---------------------------------------------------------------------------

export default function GmReportsModule() {
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);

  return (
    <Gate perm="reports.view">
      <HubLayout fullWidth sidebarRecords={SIDEBAR_RECORDS}>
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Page header */}
          <div className="gm-module-header">
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="#3DA8D8" strokeWidth={2} aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
            <span className="gm-module-header__title">GM Reports</span>
            <span className="gm-module-header__sub">Cash flow &amp; profitability</span>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {selectedPeriod ? (
              <PeriodDetail period={selectedPeriod} onBack={() => setSelectedPeriod(null)} />
            ) : (
              <div style={{ height: '100%', overflowY: 'auto' }}>
                <PeriodList onSelect={setSelectedPeriod} />
              </div>
            )}
          </div>
        </div>
      </HubLayout>
    </Gate>
  );
}
