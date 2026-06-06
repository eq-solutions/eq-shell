# Field auth unification — how Field reaches its data plane (the α/β fork)

**Status:** decision needed before the JWT-mint half of F1 WS1 is built.
**Context:** D-6 locked "unify Field auth now" — Field stops using its own PIN
codes + anon key and authenticates via the Shell identity. *How* it then reaches
its per-tenant data plane splits into two architectures. This doc frames them so
the choice is deliberate, not implied by whatever I happen to build first.

## The constraint that forces the choice

`signSupabaseJwt` (netlify/functions/_shared/supabase-jwt.ts) signs with
`SUPABASE_JWT_SECRET` — **the control plane's (jvkn) JWT secret.** The per-tenant
data planes are *separate Supabase projects* with their *own* JWT secrets:

| Tenant | Data plane | JWT secret Shell holds today? |
|---|---|---|
| core (eq) | `zaapmfdkgedqupfjtchl` | ❌ no |
| sks | `ehowgjardagevnrluult` | ❌ no |

So a JWT Shell mints today is accepted by jvkn (control plane) but **rejected by
ehowg/zaap** — wrong signing key. That's the fork.

---

## Option α — Field talks directly to its data plane (browser → Supabase, RLS-gated)

Field keeps being a thick client that calls Supabase REST/RPC directly, but with a
Shell-minted JWT instead of its own auth.

- **Shell must hold each data plane's JWT secret** to mint a token that plane
  accepts. New `mint-field-jwt` endpoint signs per-tenant with the right secret.
- **Storage:** add encrypted columns to `shell_control.tenant_routing`
  (`data_plane_jwt_secret_ciphertext/iv/tag`), reusing the existing
  `encryption.ts` AES-256-GCM + `TENANT_ROUTING_MASTER_KEY` machinery (same
  pattern already used for the service-role key). Royce populates them once per
  tenant (the secrets come from each project's Settings → API → JWT Secret).
- **RLS does the gating** in each data plane (`app_metadata.tenant_id`), exactly
  like the control plane does today.

**Pros:** smallest change to Field's data layer (it already speaks Supabase
directly); reads/writes don't round-trip through Shell functions; RLS is the
single enforcement point.
**Cons:** widens Shell's secret surface (now holds every data plane's JWT secret,
not just the control plane's); a master-key compromise now also forges data-plane
tokens; each new tenant needs its JWT secret provisioned before Field works.

---

## Option β — Field routes through Shell functions (service-role, server-side) · RECOMMENDED

Field's data calls go to Shell/Netlify functions authenticated by the Shell
identity (session cookie or the existing control-plane JWT). Those functions use
`getTenantDataClientById(session.tenant_id)` (service role) to reach the data
plane — **the exact pattern `cards-api` already uses.**

- **No data-plane JWT secret in Shell.** Shell already holds the (encrypted)
  service-role key per tenant in `tenant_routing`; nothing new to store.
- **Tenant scoping is enforced in-function** (resolve off `session.tenant_id`,
  never client input), with data-plane RLS as defence-in-depth.
- Consistent with the standing two-plane rule: *"tenant data is server-only;
  the browser gets a short-lived control-plane JWT."*

**Pros:** no new secret surface; reuses proven cards-api routing; one rotation
path; new tenants work the moment `tenant_routing` is provisioned (already true).
**Cons:** Field's `supabase.js` must be refactored from direct-Supabase calls to
calling Shell endpoints — a larger change inside the Field app (but F1 is already
refactoring Field's data layer, so the marginal cost is lower than it looks).
Needs a small Field-data function surface (or a generic `field-data` proxy).

---

## Recommendation

**β.** It keeps Shell's secret surface exactly as it is today, matches the
architecture's "tenant data is server-only" rule, and reuses the cards-api routing
that's already in production. α's only real advantage — less change to Field's
data layer — is partly moot because F1 is rewriting that layer anyway. The cost of
β (a Field-data function surface) is bounded and sits behind the same identity we
already trust.

## What ships regardless of the choice

`field-tenant-config.ts` (this PR) returns `{ tenant_id, tenant_slug, tier,
features }` — Field needs its tier to gate UI in **both** options. The auth half:

- **If β:** build the Field-data function surface (or generic proxy); no new
  secrets; no `mint-field-jwt`.
- **If α:** build `mint-field-jwt` + the `tenant_routing` encrypted JWT-secret
  columns + Royce provisions each plane's secret.

## Decision

- [ ] **β — route through Shell functions** (recommended)
- [ ] **α — browser-direct with per-plane minted JWTs**

Record the choice here, then F1 WS1's auth half is unambiguous.
