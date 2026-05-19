/**
 * AI-provider picker.
 *
 * Returns either the real AnthropicProvider (when VITE_ANTHROPIC_API_KEY is
 * set) or the offline MockAi. Never logs the key value. The label is shown
 * in a small banner so the bookkeeper can tell at a glance which path is
 * live without opening the console.
 *
 * CORS note: browser direct calls to api.anthropic.com are blocked unless
 * Anthropic explicitly allows it for the calling origin. Set
 * VITE_ANTHROPIC_BASE_URL to a local proxy if you actually want the real
 * path to work end-to-end. See eq-intake-demo/README.md.
 */

import { AnthropicProvider, type AIProvider } from "@eq/ai";
import { makeMockAi } from "./mock-ai.js";

export interface PickedAi {
  ai: AIProvider;
  /** Short label suitable for a status pill — never includes the key. */
  label: string;
  /** Logged once at startup. */
  logLine: string;
  /** True iff this is the real-Anthropic path. */
  isReal: boolean;
}

export function pickAi(): PickedAi {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  const baseUrl = import.meta.env.VITE_ANTHROPIC_BASE_URL;
  if (apiKey && apiKey.trim().length > 0) {
    return {
      ai: new AnthropicProvider({
        apiKey,
        ...(baseUrl ? { baseUrl } : {}),
      }),
      label: "real Anthropic",
      logLine: baseUrl
        ? "using real Anthropic (via custom baseUrl proxy)"
        : "using real Anthropic",
      isReal: true,
    };
  }
  return {
    ai: makeMockAi(),
    label: "mock",
    logLine:
      "using mock (set VITE_ANTHROPIC_API_KEY to enable real Anthropic)",
    isReal: false,
  };
}
