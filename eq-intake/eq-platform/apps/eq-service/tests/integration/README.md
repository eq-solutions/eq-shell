# Integration tests

These tests run against a **real local Supabase** instance. They seed two
tenants with admin users, then assert that RLS policies actually keep them
isolated. The unit tests in `tests/lib/**/*.test.ts` use mocks and run in
CI; these live in a separate suite because they need Docker + a database.

## What's tested today

| File | Type | What it asserts |
|---|---|---|
| [rls/customers-isolation.test.ts](rls/customers-isolation.test.ts) | RLS | User in Tenant A cannot read or write Tenant B's customers — by id, by list, or by injecting a foreign tenant_id on insert |
| [rls/maintenance-checks-isolation.test.ts](rls/maintenance-checks-isolation.test.ts) | RLS | User in Tenant A cannot read, list, insert, or update Tenant B's maintenance_checks — covers all four mutation/read shapes |
| [rls/technician-update-gating.test.ts](rls/technician-update-gating.test.ts) | RLS | Technician role can only UPDATE checks where `assigned_to = auth.uid()` — assigned tech wins, other tech bounces silently, admin wins as control |
| [rls/admin-only-delete.test.ts](rls/admin-only-delete.test.ts) | RLS | Only super_admin / admin can DELETE a maintenance_check — supervisor's DELETE is hidden by USING and matches zero rows |
| [rls/audit-logs-isolation.test.ts](rls/audit-logs-isolation.test.ts) | RLS | User in Tenant A cannot read or forge audit_logs in Tenant B — guards the immutable audit trail from leak and injection |

## Pivot note — PR 3b scope adjusted

The original scoping doc listed 7 follow-up tests (B–H below), all of
which assert behaviour inside **server actions** (e.g. `completeCheckAction`
sets `completed_by`, `setRoleAction` is admin-only, `inviteUserAction` is
idempotent). The current harness invokes Supabase via `supabase-js`, not
Next.js server actions — so those tests can't be expressed here without
extending the harness to boot a Next.js context, build FormData, and call
the action function directly. That's a separate piece of work.

PR 3b instead ships four **RLS-policy** tests that exercise the same
threat model from below — at the database boundary the server actions
ultimately depend on. Concretely:

- README's **F** (technician cannot complete someone else's check) is
  covered at the RLS layer by `technician-update-gating.test.ts` — the
  server action defends in depth, but the DB-level gate is the last
  line. If the action's role check ever regresses, RLS catches it.
- READ leak protection on the loadbearing tables (customers,
  maintenance_checks, audit_logs) is now end-to-end-verified, where
  previously only customers was.

Still in the backlog (need harness work to invoke server actions):

- [ ] **B.** `completed_by` set to current user on `updateCheckItemAction`
      (the action that actually writes `completed_by`; not
      `completeCheckAction`, which only flips status)
- [ ] **C.** `requireUser()` returns deterministic tenant for multi-tenant user
- [ ] **D.** Role-based gate on `setRoleAction` (admin-only)
- [ ] **E.** `issueMaintenanceReportAction` idempotency via `mutationId`
- [ ] **G.** `read_only` role rejected by `updateReportSettingsAction`
- [ ] **H.** Re-sent `inviteUserAction` doesn't duplicate auth users

The harness extension to support those tests can land as a separate PR
when the marginal value of server-action coverage starts outweighing
the build cost.

## Running locally

You need Docker, Node 20+, and the `supabase` CLI.

```bash
# 1. Start a local Supabase (if you don't already have it running)
supabase start

# 2. Make sure .env.local has these three vars from `supabase status`:
#    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#    NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...
#    SUPABASE_SERVICE_ROLE_KEY=eyJh...

# 3. Run integration tests
npm run test:integration
```

The setup file refuses to run against any URL that doesn't look local
(`127.0.0.1`, `localhost`, `host.docker.internal`, `supabase_kong`). This
is a hardcoded safety gate — integration tests mutate the DB, so they
must never point at production.

## Helpers — `helpers/db.ts`

- `seedTenantWithAdmin(suffix)` — creates a tenant + admin user + membership
  via the service_role client. Returns IDs and the user's password so tests
  can sign in.
- `signedInClient(email, password)` — signs in via the anon key and returns
  the authenticated client. `auth.uid()` in any subsequent PostgREST call
  resolves to this user. **This is what RLS tests must use** — service_role
  bypasses RLS and would make every test pass.
- `adminClient()` — service_role client. Use for seeding and cleanup only.
- `cleanupTenant(seed)` — deletes the auth user + tenant row. FK cascades
  handle the rest. Best-effort: failures are swallowed.

## Writing a new test

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { seedTenantWithAdmin, signedInClient, cleanupTenant } from '../helpers/db'

describe('My feature — what is asserted', () => {
  let tenant: Awaited<ReturnType<typeof seedTenantWithAdmin>>

  beforeAll(async () => { tenant = await seedTenantWithAdmin('myfeat') })
  afterAll(async () => { if (tenant) await cleanupTenant(tenant) })

  it('does the thing', async () => {
    const client = await signedInClient(tenant.user.email, tenant.user.password)
    // ... your assertion via `client.from(...)` etc.
  })
})
```

Use **fresh UUIDs every run** (already done by the helpers — seed IDs are
randomly generated). Don't rely on hardcoded fixture data; a previous
test's cleanup may have failed and the same ID could collide.

## CI

Wired into [.github/workflows/integration.yml](../../.github/workflows/integration.yml)
as a required check on every PR and push to main. The workflow:

1. Installs the Supabase CLI via `supabase/setup-cli@v1`
2. Runs `supabase start` (boots Postgres + GoTrue + PostgREST + Realtime
   in Docker, applies every migration in `supabase/migrations/`)
3. Remaps `supabase status -o env` output to the env-var names the harness
   expects (`NEXT_PUBLIC_SUPABASE_URL` etc.)
4. Runs `npm run test:integration`
5. Stops the stack

Cost is ~2-3 min per run (warm Docker cache). Unit-test workflow
[`check.yml`](../../.github/workflows/check.yml) is unaffected — it still
runs `tsc --noEmit` + `next build` + `npx vitest run` on the same triggers.

When this check fails on a PR, fix the regression locally first:

```bash
supabase start                 # if not already running
npm run test:integration       # reproduces the CI failure
```
