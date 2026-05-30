# AUTH-SPIKE-README — Supabase Auth + Passkey PoC

**Status:** Spike only. Not deployed. Not merged. Review before any action.
**Branch:** `claude/c3-auth-spike` — isolated from `main`, additive only.
**Route:** `/auth-spike` — navigating here manually shows the demo. Normal login is byte-unchanged.

---

## What this PoC demonstrates

The spike lives entirely in `src/spike/`. It is isolated from the live auth path.

| File | What it does |
|---|---|
| `src/spike/auth/supabaseAuthClient.ts` | Supabase Auth client init reading from `VITE_SPIKE_*` env vars (not the live `VITE_SUPABASE_*` vars). Singleton, scoped storage key. |
| `src/spike/auth/usePasskeyAuth.ts` | React hook: WebAuthn device detection, magic-link send, passkey enrollment (`sb.auth.mfa.enroll({ factorType: 'webauthn' })`), passkey sign-in (`sb.auth.signInWithPasskey()`), JWT claim extraction, `@eq-solutions/roles` `can()` permission check. |
| `src/spike/auth/PasskeySpikeDemo.tsx` | UI component: steps through magic-link → passkey enrollment → sign-in → claim display + permission matrix. EQ-branded. |
| `src/spike/AuthSpikePage.tsx` | Route page. No imports from live auth files. |

The live auth files — `src/session.ts`, `src/supabase.ts`, `src/lib/supabaseJwt.ts`, `netlify/functions/shell-login.ts`, `netlify/functions/verify-shell-session.ts`, and all other `netlify/functions/*` — are **byte-unchanged** by this spike. The only live-file change is two lines in `App.tsx`: a `lazy()` import and one `<Route path="/auth-spike">` entry, both clearly marked with `// SPIKE:` comments.

### What is proven (client-side)

1. Supabase Auth JS client initialisation isolated from the live client.
2. Magic-link OTP as the baseline first-login credential.
3. WebAuthn device detection pre-flight (avoids enrolling on unsupported browsers).
4. Passkey enrollment flow wired to Supabase's beta `mfa.enroll({ factorType: 'webauthn' })` API.
5. Passkey sign-in wired to Supabase's beta `signInWithPasskey()` API.
6. JWT `app_metadata` claim extraction (`eq_role`, `tenant_id`, `is_platform_admin`).
7. `@eq-solutions/roles` `can()` called with the extracted role + platform admin flag — all 15 permission keys rendered live.
8. `autocomplete="webauthn"` on the email input to enable browser Conditional UI (native autofill passkey suggestion).

### What is NOT proven (requires Supabase-side setup)

Everything in the next section. The client-side code is wired; the server side needs Royce to apply it.

---

## Supabase-side setup — Royce to apply

Do not apply any of this without explicit sign-off. This is design documentation, not a runbook.

### A. Auth project

Target: `eq-canonical-internal` (the existing control-plane project).

Dashboard path: `https://supabase.com/dashboard/project/<project-ref>/auth/providers`

1. Confirm Email provider is enabled (required for magic-link OTP).
2. Disable "Confirm email" for the spike test (so magic links work without a real email flow in dev). Re-enable for production.

### B. WebAuthn / Passkey settings

Dashboard path: `Authentication → WebAuthn (Beta)`

```
Relying Party display name:  EQ
Relying Party ID:            eq.solutions
Allowed origins:
  - https://core.eq.solutions
  - https://localhost:8888     (for local netlify dev testing)
```

**Risk:** Supabase WebAuthn is in beta as of 2026-05-28. API surface may change before GA. Pin `@supabase/supabase-js` version — do not use a caret range — before Phase 1 begins.

### C. `public.tenant_members` table

Must exist before the Custom Access Token Hook is enabled. If the table is not populated, the hook returns null claims and RLS rejects every query.

```sql
-- Run in eq-canonical-internal SQL editor.
CREATE TABLE IF NOT EXISTS public.tenant_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id       text NOT NULL,
  eq_role         text NOT NULL CHECK (eq_role IN ('manager','supervisor','employee','apprentice','labour_hire')),
  is_platform_admin boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_user_id, tenant_id)
);

-- RLS: only the service role and the hook function can read/write.
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by Netlify functions).
CREATE POLICY "service role full access"
ON public.tenant_members
USING (true)
WITH CHECK (true);
-- (This policy is for the service-role key. The hook runs as SECURITY DEFINER
--  so it bypasses RLS anyway — but explicit policy keeps the intent readable.)
```

Verify before enabling the hook:
```sql
-- Count check: every auth user should have at least one tenant_members row.
SELECT
  count(u.id)                                AS total_users,
  count(m.auth_user_id)                      AS members_matched,
  count(u.id) - count(m.auth_user_id)        AS missing
FROM auth.users u
LEFT JOIN public.tenant_members m ON m.auth_user_id = u.id;
-- missing = 0 before enabling the hook.
```

### D. Custom Access Token Hook (SQL)

Dashboard path: `Authentication → Hooks → Custom Access Token Hook`

The hook injects `eq_role`, `tenant_id`, and `is_platform_admin` into every JWT's `app_metadata`. It runs on every token issuance and every refresh.

**Critical safety guard:** The `EXCEPTION WHEN OTHERS THEN RETURN event` block makes the hook fail-open — if it throws for any reason, the token is issued without custom claims rather than blocking login entirely. Disable the hook via the dashboard toggle as the rollback, not by modifying this function.

```sql
CREATE OR REPLACE FUNCTION public.eq_custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r_role         text;
  r_tenant       text;
  r_admin        boolean;
  claims         JSONB;
  user_id        text;
BEGIN
  user_id := event -> 'claims' ->> 'sub';

  SELECT
    eq_role,
    tenant_id,
    is_platform_admin
  INTO r_role, r_tenant, r_admin
  FROM public.tenant_members
  WHERE auth_user_id = user_id::uuid
  LIMIT 1;

  -- If no row found (brand-new invite flow), return null claims so login
  -- completes and the UI can redirect to onboarding.
  IF r_role IS NULL THEN
    claims := jsonb_set(event -> 'claims', '{app_metadata,eq_role}', 'null'::jsonb);
    claims := jsonb_set(claims, '{app_metadata,tenant_id}', 'null'::jsonb);
    claims := jsonb_set(claims, '{app_metadata,is_platform_admin}', 'false'::jsonb);
    RETURN jsonb_set(event, '{claims}', claims);
  END IF;

  claims := jsonb_set(event -> 'claims', '{app_metadata,eq_role}', to_jsonb(r_role));
  claims := jsonb_set(claims, '{app_metadata,tenant_id}', to_jsonb(r_tenant));
  claims := jsonb_set(claims, '{app_metadata,is_platform_admin}', to_jsonb(r_admin));

  RETURN jsonb_set(event, '{claims}', claims);

EXCEPTION WHEN OTHERS THEN
  -- Fail-open: return the event unmodified so login still completes.
  -- Claims will be absent from the JWT; RLS will reject data queries,
  -- but at least the user is not locked out. Monitor pg_stat_activity
  -- and Supabase logs for recurring exceptions.
  RETURN event;
END;
$$;

-- Grant the hook function permission to read tenant_members.
GRANT EXECUTE ON FUNCTION public.eq_custom_access_token_hook TO supabase_auth_admin;
```

After writing the function, register it in the dashboard:
`Authentication → Hooks → Custom Access Token Hook → Select function → eq_custom_access_token_hook`

**Rollback:** Toggle the hook off in the dashboard. Tokens revert to standard Supabase claims. No code change needed.

### E. RLS policy patterns

These are examples for review — not applied anywhere yet. Apply to the relevant tables when Phase 3 cutover begins for each app.

**Tenant read gate (any role with a valid tenant_id):**
```sql
CREATE POLICY "tenant members can read"
ON <table> FOR SELECT
USING (
  tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
  AND auth.jwt() -> 'app_metadata' ->> 'eq_role' IS NOT NULL
);
```

**Manager/supervisor write gate:**
```sql
CREATE POLICY "managers and supervisors can write"
ON <table> FOR INSERT
WITH CHECK (
  tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
  AND (auth.jwt() -> 'app_metadata' ->> 'eq_role') IN ('manager', 'supervisor')
);
```

**Platform admin bypass:**
```sql
CREATE POLICY "platform admin reads all tenants"
ON <table> FOR SELECT
USING (
  (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
);
```

**JWT staleness note:** RLS reads the JWT as presented. Role changes in `tenant_members` do not take effect until the user's access token refreshes (default 1 hour). For urgent revocations, invalidate the user's sessions via the Supabase admin API (`DELETE /auth/v1/admin/users/{id}/sessions`).

---

## Local testing

1. Copy `.env.example` to `.env.local`.
2. Add:
   ```
   VITE_SPIKE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SPIKE_SUPABASE_ANON_KEY=<anon-key>
   ```
   These are deliberately different from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` to prevent cross-wiring.
3. Run `netlify dev` (not `pnpm dev` — cookie + redirect handling requires the functions emulator).
4. Navigate to `http://localhost:8888/auth-spike`.
5. The live login at `http://localhost:8888/` is completely unaffected.

---

## Recommended cutover order (Shell → Service → Field)

From the spike design (`auth-spike-2026-05-30.md` section 5, Phase 3):

| Order | App | Rationale |
|---|---|---|
| 1 | **eq-shell** | Already uses Supabase JWT for canonical data queries. The HMAC surface is only the outbound iframe handoff, not inbound user login. Making Shell the source of truth first simplifies everything downstream. |
| 2 | **eq-solves-service** | Does not own login — receives a token from Shell. Once Shell emits a Supabase JWT, Service just needs its middleware updated to verify the scoped token instead of the HMAC token. One edge function + one middleware change. |
| 3 | **eq-solves-field** | Highest risk: owns its own login screen (4-digit PIN), multi-tenant, currently maps 5 roles to 2. Has live SKS users. Goes last when the pattern is proven across Shell and Service, and when the Field merge (stream 2) is stable. |

Each cutover requires explicit deploy approval. No phase starts without Royce sign-off.

---

## Honest gaps and risks of this approach

| Gap / Risk | Detail |
|---|---|
| **Supabase passkey API is beta** | `signInWithPasskey()` and `mfa.enroll({ factorType: 'webauthn' })` are beta as of 2026-05-28. The SDK currently requires `any` casts for these calls because the type definitions are not yet published. API shape may change without semver bump. Mitigation: pin the exact version; monitor the Supabase changelog before Phase 1 begins. |
| **Hook runs on every token issue** | A bug that escapes the `EXCEPTION WHEN OTHERS` guard breaks all logins across all tenants. The guard is defense-in-depth, not a guarantee. Test the hook thoroughly in staging with integration tests before enabling in production. |
| **`tenant_members` backfill** | The hook returns null claims if a user has no row in `tenant_members`. That user can log in but cannot do anything (RLS blocks all data queries). Backfill must be verified before enabling the hook. |
| **`any` casts in usePasskeyAuth.ts** | Two `eslint-disable @typescript-eslint/no-explicit-any` lines cover the beta API calls. These are flagged explicitly in the code. When Supabase publishes proper types for the passkey API, remove the casts and let TypeScript verify the interface. |
| **Magic-link fallback lowers security floor** | The account is as secure as the email inbox. This is acceptable for an internal workforce app (industry standard for B2B tools). Full passkey-only (no fallback) would lock field workers out on device loss — not viable. |
| **No recovery code implementation** | The spike design (section 3.3) specifies 8 one-time recovery codes generated on the client via `crypto.getRandomValues`, stored as bcrypt hashes in a `recovery_codes` table. This is NOT built in the spike — it is scoped to Phase 1 proper. |
| **Single-tenant assumption** | The spike demo reads the first `tenant_members` row for the user. A user with multiple memberships (multi-tenant) needs the Shell to resolve which tenant is active and surface a tenant picker post-login, the same way the current `requires_tenant_selection` flow works. |
| **No token exchange in this spike** | The cross-app token exchange (Shell JWT → short-lived Field/Service JWT) is described in the design (section 4.2) but not built here. It requires a Netlify Edge Function and is Phase 2/3 work. |