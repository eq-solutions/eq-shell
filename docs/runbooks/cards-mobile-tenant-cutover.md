# Cards mobile → tenant data plane cutover

**Status:** Runbook for the Cards Flutter app. Shell-side is ready (orchestrator
endpoint `/.netlify/functions/intake-commit` live on `core.eq.solutions` as of
PR #25, 2026-05-24). Cards mobile is the next consumer to migrate.

**Why:** Cards mobile currently writes licences to **shared eq-canonical**
(`jvknxcmbtrfnxfrwfimn`). The Shell now reads licences from the **per-tenant
data plane** (`eq-canonical-internal` / `sks-canonical`). Until Cards mobile
points at the tenant data plane, every Cards upload requires a manual
`sync-tenant-data.mjs --slug=<slug>` to become visible in Shell.

## Current state

| Surface | Reads from | Writes to |
|---|---|---|
| Cards mobile (Flutter) | shared eq-canonical | **shared eq-canonical** ← needs to change |
| Shell — cards-pending-staff | tenant DB | n/a |
| Shell — cards-approve-staff | tenant DB (read) + Field Supabase (write) | n/a |
| Shell — Cards admin UI | via shell functions ↑ | n/a |
| Licence-photos bucket (images) | shared `licence-photos` | shared `licence-photos` |

Images are NOT consumed by Shell today, so the image side of the divergence is
cosmetic for now. **This runbook covers DATA only.**

## What changes in Cards mobile

### Old call (today, Flutter)

```dart
// Cards mobile uses Supabase Flutter SDK, authenticated via Supabase JWT.
final result = await supabase.rpc('eq_intake_commit_batch', {
  'p_intake_id':       intakeId,            // uuid generated client-side
  'p_tenant_id':       session.tenantId,    // user's tenant
  'p_table':           'licences',
  'p_rows':            licencesAsJsonArray,
  'p_confirm_replace': false,
  'p_intake_mode':     'strict',
});
```

This goes straight to shared eq-canonical's PostgREST and lands in
`shared.app_data.licences`.

### New call (after cutover)

```dart
// HTTPS POST to the Shell orchestrator. Auth changes from Supabase JWT
// (Bearer token in Authorization header) to the eq_shell_session cookie
// — Cards mobile needs to either share the Shell session or use a
// service bearer key.
final response = await http.post(
  Uri.parse('https://core.eq.solutions/.netlify/functions/intake-commit'),
  headers: {
    'Cookie':       'eq_shell_session=$shellSessionCookie',
    'Content-Type': 'application/json',
  },
  body: jsonEncode({
    'intake_id':        intakeId,               // uuid generated client-side
    'table':            'licences',
    'rows':             licencesAsJsonArray,
    'source_sig':       'cards-mobile/$bundleId/$version',  // for audit trail
    'schema_version':   '1.0.0',
    'import_mode':      'append',               // 'append' | 'upsert' | 'replace'
    'confirm_replace':  false,                   // only checked for replace mode
  }),
);

if (response.statusCode != 200) {
  // Error envelope: { ok: false, error: '<code>', detail?: '<human>' }
  throw IntakeError.fromResponse(response);
}

final body = jsonDecode(response.body);
// Same shape as the old RPC:
//   { ok: true, module: 'cards', committed_count: int, committed_ids: [uuid] }
```

## Auth — the tricky bit

Cards mobile currently authenticates against shared eq-canonical with a Supabase
JWT (issued by `mint-supabase-jwt`). The new orchestrator requires an
`eq_shell_session` cookie (the Shell's HMAC session cookie set by `shell-login`).

Three paths to consider:

### Option A: Cards mobile becomes a real Shell session holder
Cards mobile calls `/.netlify/functions/shell-login` with the user's email + PIN,
stores the resulting `eq_shell_session` cookie, sends it as `Cookie:` header on
every intake-commit. Same auth model as the browser.

**Pros:** Cleanest. Identical to browser auth, audit trail consistent.
**Cons:** Cards mobile needs cookie storage + needs to handle 401 (re-login).

### Option B: Per-app bearer key (like canonical-api)
Add a `CANONICAL_API_KEY_CARDS_MOBILE` env var and an alternative auth path on
`intake-commit` that accepts `Authorization: Bearer <key>` + an explicit
`X-User-Id` and `X-Tenant-Slug` header. Cards mobile keeps a long-lived secret.

**Pros:** No session management. Easy for mobile.
**Cons:** Long-lived secret on every Cards device is a recoverable but real
risk. Per-device key rotation is harder than per-session.

### Option C: Keep mint-supabase-jwt + extend intake-commit to accept the JWT
Cards mobile keeps using `mint-supabase-jwt` to get a Supabase JWT. The
orchestrator function reads the JWT from the Authorization header, validates it
with `SUPABASE_JWT_SECRET`, extracts tenant_id from `app_metadata`. No session
cookie needed.

**Pros:** Zero change to Cards mobile auth flow.
**Cons:** Adds a second auth path to maintain in `intake-commit`. JWT
verification logic needs careful tenant_id extraction.

**Recommended: Option C.** Lowest Cards-side change (just swap the RPC for an
HTTPS POST, keep JWT auth). Adds one auth path in the orchestrator that
existing Shell functions already do (see `_shared/supabase-jwt.ts`).

## Implementation order

1. **(Shell side) Add Supabase JWT auth path to intake-commit.** Accept
   `Authorization: Bearer <jwt>` as an alternative to session cookie. Decode +
   validate against `SUPABASE_JWT_SECRET`, extract `tenant_id` from
   `app_metadata.tenant_id`. Allow either auth method — session OR JWT.

2. **(Cards mobile) Swap the RPC for an HTTPS POST.** Code change is local to
   wherever Cards mobile calls `eq_intake_commit_batch`. Auth headers stay
   the same.

3. **(Smoke)** Add a licence via Cards mobile. Verify in `sks-canonical`:
   ```sql
   SELECT count(*) FROM app_data.licences
   WHERE updated_at > now() - interval '5 minutes';
   ```
   Should return ≥ 1. Then verify in Shell admin (`/sks/cards`) — the new
   licence should show up without a manual sync.

4. **(Shell side, later) Delete the old RPC bodies on shared eq-canonical**
   only after all 5 modules (cards, service, quotes, core, field) have
   migrated. Until then keep the dispatcher functional for any legacy callers.

## Storage migration — separate concern

Cards mobile uploads images to bucket `licence-photos` on shared eq-canonical.
Path format: `<tenant_id>/<staff_id>/<licence_id>/{front|back}.jpg`.

**Today:** the Shell never displays these images, so the divergence doesn't
matter functionally. Cards mobile reads its own uploads from shared.

**Future:** If Shell adds a "review licence with photo" view, either:
- Sync the bucket (one-off + periodic) from shared to tenant
- Have Cards mobile upload directly to tenant storage (requires tenant URL +
  storage key — separate from the data orchestrator)

Defer until a Shell-side image consumer lands.

## Rollback

If the new path fails post-cutover, Cards mobile flips back to the old
`eq_intake_commit_batch` RPC. The dispatcher on shared eq-canonical still
routes to the cards RPC. No data loss — writes either land on shared (old
path) or tenant (new path); the manual sync command catches up either way.

## References

- Architecture: [docs/ARCHITECTURE-V2.md](../ARCHITECTURE-V2.md) §Phase 2.B.6
- Orchestrator function: [netlify/functions/intake-commit.ts](../../netlify/functions/intake-commit.ts)
- Tenant migration: [supabase/tenant-migrations/0005_intake_cards_rpc.sql](../../supabase/tenant-migrations/0005_intake_cards_rpc.sql)
- Manual sync script: [scripts/sync-tenant-data.mjs](../../scripts/sync-tenant-data.mjs)
- PR introducing this path: [eq-shell#25](https://github.com/eq-solutions/eq-shell/pull/25)
