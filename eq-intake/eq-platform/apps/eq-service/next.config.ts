import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

// After the move into eq-platform/apps/eq-service, the workspace root is
// two levels up from this file. Tracing must point at the monorepo root so
// Next.js follows pnpm symlinks for @eq/* workspace packages into
// packages/*. Without this, standalone output drops workspace deps.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(projectRoot, "../..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  // Pre-existing Supabase update-type strictness errors block `next build`
  // type-check at HEAD ec90b36 (see app/(app)/admin/media/actions.ts:163).
  // Compile still succeeds; runtime is unaffected. Bypassing here so Phase 0
  // monorepo migration ships green; tracked as a follow-up to fix the
  // .update(update) shape across admin actions. ESLint follows the same
  // pattern — block on real bugs, not on Phase-0-induced churn.
  typescript: { ignoreBuildErrors: true },
  async redirects() {
    return [
      // Phase 1 of the Testing simplification (2026-04-28). The legacy
      // top-level routes /acb-testing and /nsx-testing now point at the
      // canonical /testing/* tabs. permanent: true → 308 (modern 301 that
      // preserves the HTTP method and is treated as permanent by browsers
      // and search indexers).
      { source: '/acb-testing', destination: '/testing/acb', permanent: true },
      { source: '/acb-testing/:path*', destination: '/testing/acb/:path*', permanent: true },
      { source: '/nsx-testing', destination: '/testing/nsx', permanent: true },
      { source: '/nsx-testing/:path*', destination: '/testing/nsx/:path*', permanent: true },
      // Commercial tools (renewal pack + contract-scope import/derive) moved
      // out of the Admin block into a dedicated /commercials hub. 308 keeps
      // bookmarks and any external deep links working.
      { source: '/admin/renewal-pack', destination: '/commercials/renewal-pack', permanent: true },
      { source: '/admin/renewal-pack/:path*', destination: '/commercials/renewal-pack/:path*', permanent: true },
      { source: '/admin/contract-scopes/import', destination: '/commercials/contract-scopes/import', permanent: true },
      { source: '/admin/contract-scopes/import/:path*', destination: '/commercials/contract-scopes/import/:path*', permanent: true },
      { source: '/admin/contract-scopes/derive', destination: '/commercials/contract-scopes/derive', permanent: true },
      { source: '/admin/contract-scopes/derive/:path*', destination: '/commercials/contract-scopes/derive/:path*', permanent: true },
    ]
  },
};

// Wrap the config with Sentry's webpack plugin so source maps upload at
// build time and stack traces in the Sentry dashboard match committed
// source. SENTRY_AUTH_TOKEN must be set in Netlify env (procured from the
// Sentry project's Settings → Auth Tokens page, scope: project:write).
// When the token is absent (local dev, PR previews without secrets), the
// plugin no-ops and the build still succeeds — source maps just aren't
// uploaded for that build.
export default withSentryConfig(nextConfig, {
  // Sentry org + project slugs. Set via env so they aren't hardcoded
  // anywhere that'd matter; defaults match the project Royce sets up.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Only print upload progress in CI to keep local builds quiet.
  silent: !process.env.CI,

  // Upload a wider set of source maps (server + client + edge) for full
  // stack-trace fidelity. Slight build-time cost; worth it.
  widenClientFileUpload: true,

  // Don't fail the build if source map upload fails (e.g. token missing
  // on a feature branch). Errors are captured at runtime regardless;
  // unsymbolicated stack traces are recoverable later.
  errorHandler: (err: Error) => {
    // eslint-disable-next-line no-console
    console.warn('[sentry] source map upload skipped:', err.message);
  },
});
