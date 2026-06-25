/**
 * AskCanonical — natural language query over canonical data
 *
 * Sends a plain-English question to the eq-ai-assist Edge Function on
 * sks-canonical. Claude Haiku parses the intent (which entity + which
 * filters) and returns matching rows fetched client-side via the existing
 * eq_tidy_read_entity RPC.
 *
 * No raw SQL is generated or executed. No schema is exposed to the model.
 * The Edge Function requires the ANTHROPIC_API_KEY secret to be set.
 */

import { useState, type JSX } from "react";
import { askCanonical } from "@eq/intake";
import type { AskResult } from "@eq/intake";
import type { SupabaseLikeClient } from "../canonical/commit-canonical.js";

export interface AskCanonicalProps {
  supabase?: SupabaseLikeClient | null;
  /** Navigate into a specific entity's drill-down. */
  onEntityClick?: (entity: string) => void;
}

const EXAMPLE_QUESTIONS = [
  "Which staff have no trade?",
  "Customers in NSW without an ABN",
  "Sites with no customer linked",
  "Assets with no serial number",
];

export function AskCanonical({ supabase, onEntityClick }: AskCanonicalProps): JSX.Element {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!supabase) {
    return (
      <div className="eq-ask-notice">Connect EQ to use Ask.</div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Calls the eq-ai-assist Edge Function via supabase.functions.invoke
  const callEdgeFn = (action: string, payload: Record<string, unknown>) =>
    sb.functions.invoke('eq-ai-assist', { body: { action, ...payload } }) as Promise<{
      data: unknown;
      error: { message: string } | null;
    }>;

  // Fetches all active rows for an entity via eq_tidy_read_entity RPC
  const fetchEntity = async (entity: string): Promise<Record<string, unknown>[]> => {
    const r = await sb.rpc('eq_tidy_read_entity', { p_table: entity });
    return (r.data as Record<string, unknown>[] | null) ?? [];
  };

  const handleAsk = async (q?: string) => {
    const text = (q ?? question).trim();
    if (!text) return;
    if (q) setQuestion(q);
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const r = await askCanonical(text, callEdgeFn, fetchEntity);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const displayCols = result?.intent.display_columns ?? [];

  return (
    <div className="eq-ask">
      <div className="eq-ask-bar">
        <input
          type="text"
          className="eq-ask-input"
          placeholder="Ask a question about your data…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAsk(); }}
          disabled={loading}
          aria-label="Data question"
        />
        <button
          type="button"
          className="eq-intake-btn-primary eq-ask-btn"
          onClick={() => handleAsk()}
          disabled={loading || !question.trim()}
        >
          {loading ? "…" : "Ask"}
        </button>
      </div>

      {/* Example prompts — shown until first result */}
      {!result && !loading && !error && (
        <div className="eq-ask-examples">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              className="eq-ask-example"
              onClick={() => handleAsk(q)}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="eq-intake-alert">{error}</div>
      )}

      {result && (
        <div className="eq-ask-results">
          <div className="eq-ask-results-header">
            <span className="eq-ask-description">{result.intent.description}</span>
            <span className="eq-ask-count">
              {result.total} record{result.total === 1 ? "" : "s"}
            </span>
            {onEntityClick && (
              <button
                type="button"
                className="eq-intake-btn-ghost eq-ask-open-btn"
                onClick={() => onEntityClick(result.intent.entity)}
              >
                Open {result.intent.entity} →
              </button>
            )}
          </div>

          {result.rows.length > 0 ? (
            <>
              <div className="eq-intake-preview__table-wrap">
                <table className="eq-intake-preview__table eq-ask-table">
                  <thead>
                    <tr>
                      {displayCols.map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 50).map((row, i) => (
                      <tr key={i}>
                        {displayCols.map((col) => (
                          <td key={col} title={String(row[col] ?? "")}>
                            {String(row[col] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.total > 50 && (
                <p className="eq-ask-overflow">
                  Showing 50 of {result.total.toLocaleString()} — open the entity drill-down to see all.
                </p>
              )}
            </>
          ) : (
            <p className="eq-ask-empty">No records matched this question.</p>
          )}

          <button
            type="button"
            className="eq-intake-btn-ghost eq-ask-clear"
            onClick={() => { setResult(null); setQuestion(""); }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
