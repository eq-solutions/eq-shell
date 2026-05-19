/// <reference types="vite/client" />

/**
 * Demo-specific environment variables. Only VITE_*-prefixed values are
 * exposed to the browser by Vite.
 *
 * VITE_ANTHROPIC_API_KEY — if set, the demo uses the real AnthropicProvider
 *   instead of MockAi. Read `eq-intake-demo/README.md` before setting this in
 *   a hosted environment: any VITE_ value lands in the browser bundle.
 *
 * VITE_ANTHROPIC_BASE_URL — optional override pointing at a CORS-friendly
 *   proxy. Browser direct calls to api.anthropic.com are blocked by CORS;
 *   point this at a small local proxy if you want the real path to work.
 */
interface ImportMetaEnv {
  readonly VITE_ANTHROPIC_API_KEY?: string;
  readonly VITE_ANTHROPIC_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
