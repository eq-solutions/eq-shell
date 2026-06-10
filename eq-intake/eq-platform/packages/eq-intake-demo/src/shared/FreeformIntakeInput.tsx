/**
 * FreeformIntakeInput — a natural language textarea for describing data.
 *
 * Sits below the drop zone in Import mode. The user can type a free-text
 * description of what they want to import (e.g. "Add 5 new customers from
 * Adelaide"). If an AI client is wired in via the `ai` prop, the input is
 * sent for processing; otherwise it shows a "no AI configured" notice.
 *
 * Design rules: no inline styles, no hardcoded hex. CSS in styles.css under
 * the .eq-freeform namespace.
 */

import { useState, type JSX } from "react";
import type { AIProvider } from "@eq/ai";

// Re-export for consumers that want the same type without importing @eq/ai directly
export type { AIProvider as AiClient };

export interface FreeformIntakeInputProps {
  /** Optional AI provider. When absent the component renders in preview-only
   * mode with a notice explaining AI isn't configured. */
  ai?: AIProvider | null;
  /** Placeholder text for the textarea. */
  placeholder?: string;
  /** Called when the AI returns a response. Host can use this to pre-fill
   * the drop zone with structured data derived from the prompt. */
  onResult?: (result: string) => void;
}

export function FreeformIntakeInput({
  ai,
  placeholder = "Describe what you'd like to import — e.g. 'Add 5 new customers from Adelaide with site addresses'",
  onResult,
}: FreeformIntakeInputProps): JSX.Element {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!ai || !text.trim()) return;
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      // Use the AI map() method to extract structured fields from freeform text.
      // Pass the text as a single synthetic "source column" so the mapper can
      // attempt to resolve canonical fields from the natural language description.
      const mapped = await ai.map({
        targetSchema: { properties: {} },
        sourceColumns: [text.trim()],
        sampleRows: [],
      });
      const summary = mapped.mappings.map(m => `${m.sourceColumn} → ${m.canonicalField}`).join(", ") || text.trim();
      setResult(summary);
      onResult?.(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eq-freeform-intake">
      <p className="eq-freeform-intake__label">
        Or describe what you want to import
      </p>

      <div className="eq-freeform">
        <textarea
          className="eq-freeform-intake__textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          rows={3}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
        />
        <button
          type="button"
          className="eq-intake-btn-primary"
          onClick={() => void handleSubmit()}
          disabled={!ai || busy || !text.trim()}
        >
          {busy ? "Processing…" : "Process"}
        </button>
      </div>

      {!ai && (
        <p className="eq-freeform-intake__notice">
          AI isn't configured — ask whoever set this up to connect an AI client
          to enable natural language input.
        </p>
      )}

      {error && (
        <div role="alert" className="eq-intake-alert">
          {error}
        </div>
      )}

      {result && (
        <div className="eq-freeform-intake__result">
          <p className="eq-freeform-intake__result-label">AI response</p>
          <pre className="eq-freeform-intake__result-body">{result}</pre>
        </div>
      )}
    </div>
  );
}
