<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Security invariants — do not violate

These rules are non-negotiable. If a change appears to require breaking one, stop and flag it in chat before proceeding.

## Server actions
- **Every mutating server action must start with `requireUser()`** (or equivalent local guard that resolves user + tenant + role). No exceptions for "internal" or "admin-only" actions — authorisation is always enforced server-side.
- **Role checks live after `requireUser()` and before the Supabase mutation.** Use `canWrite(role)` / `isAdmin(role)` from `lib/utils/roles`, never ad-hoc string comparisons.
- **Validate all input with Zod** before it touches the database. Use Zod v4 syntax (`.error.issues[0]`, `error:` option).
- **Audit-log every mutation.** The pattern is: `requireUser()` → role check → Zod parse → Supabase mutation → `audit_logs` insert → `revalidatePath()`.
- **Never trust client-provided `tenant_id`.** Derive it from `requireUser()` or from a parent record the user already has access to.
- **Replay-safe mutations use `withIdempotency()`.** Any action that may be retried — offline queue replay, AI-suggested actions, client retry logic — accepts an optional `mutationId: string` argument and wraps its body in `withIdempotency(mutationId, async () => { ... })` from `lib/actions/idempotency`. The audit-log insert inside the wrapped body must pass the same `mutationId` so the unique index on `(tenant_id, mutation_id)` backstops races. When `mutationId` is omitted the wrapper is a pass-through — legacy call sites are unchanged.

## Database & RLS
- **Every table has RLS enabled** and at least one tenant-scoped policy. New tables without RLS must not be merged.
- **No `USING (true)` or `WITH CHECK (true)` on authenticated-only tables.** The only acceptable uses of permissive `true` are: (a) service-role triggers writing notifications, (b) tables intentionally exposed to the `anon` role (briefs, estimate_events, estimates — public intake forms). Any new `true` policy needs explicit justification in the migration comment.
- **Wrap `auth.uid()` and `get_user_tenant_ids()` in `(select …)`** inside RLS expressions. This lets the planner evaluate them once per query instead of once per row (see migration 0027).
- **Avoid overlapping permissive policies for the same action.** If "writers can manage" overlaps with "tenant members can read", split the writer policy into explicit INSERT/UPDATE/DELETE.
- **Soft delete via `is_active = false`**, never hard delete. The only exceptions already in the codebase are `mfa_recovery_codes` (consumed codes) and removed job plan items.

## Secrets & configuration
- **No credentials in the repo.** `.env.local` is the only place for real keys, and it is gitignored. `.env.example` contains placeholders only.
- **Never log or print the Supabase `service_role` key, session tokens, or MFA codes.** Avoid even transient exposure in error messages.
- **Client components use the anon key** via `createClient()` from `lib/supabase/client`. Server actions use the server client from `lib/supabase/server`. The service_role key never touches a client component.
- **Do not commit `.next/` or `.next-old/` build artefacts.** They can embed the anon key in bundled source — harmless but noisy and triggers secret scanners.

## HTTP & transport
- **Security headers are set in `public/_headers`** (Netlify). Do not weaken HSTS, frame-ancestors, or the CSP without a migration-style entry explaining why.
- **CSP changes must be tested in Report-Only mode for at least 24h** before flipping to enforce. Watch Netlify deploy logs for `csp-report` entries.

## Auth changes
- **Any change to the auth flow, MFA, session handling, or password reset requires a chat heads-up first.** These paths are high-blast-radius and should never land without explicit approval from Royce.

## Before merging
- `tsc --noEmit` at 0 errors.
- `npm audit --audit-level=high` at 0 findings (or an explicit waiver in the PR description).
- Run Supabase advisors (`get_advisors` security + performance) after any migration; zero new ERROR-level findings.

