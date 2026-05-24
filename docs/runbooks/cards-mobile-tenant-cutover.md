# Cards mobile → tenant data plane cutover

**Status:** Shell side is ready. Cards mobile is the next consumer to migrate.

> **Supersedes** the first draft of this runbook (in the merged PR #26) which
> assumed Cards mobile called `eq_intake_commit_batch`. It doesn't — Cards has
> its own dedicated RPC family (`eq_cards_*`). This document covers the real
> migration.

## What Cards mobile currently does

The Flutter app in `C:\Projects\eq-cards` reads/writes licences via four
SECURITY DEFINER RPCs on **shared eq-canonical**:

| RPC | Caller | What it does |
|---|---|---|
| `eq_cards_current_staff()` | `licence_repository.dart` (indirectly via profile screens) | Returns the tradie's own `app_data.staff` row |
| `eq_cards_list_my_licences()` | `LicenceRepository.getAllForCurrentUser()` | Returns the tradie's licences |
| `eq_cards_upsert_my_licence(payload)` | `LicenceRepository.upsert(licence)` | Insert or update a licence (handles photo paths) |
| `eq_cards_soft_delete_my_licence(id)` | `LicenceRepository.softDelete(id)` | Sets `active = false` |

All four read `tenant_id` and `user_id` from `auth.jwt() app_metadata`. Cards
mobile mints that JWT via `/.netlify/functions/mint-supabase-jwt`.

Photo uploads use `supabase.storage.from('licence-photos')` against shared
eq-canonical's Storage. Path format: `<tenant_id>/<staff_id>/<licence_id>/{front|back}.jpg`.

## What Shell side now offers (2026-05-24)

- **Tenant-DB RPCs** (`supabase/tenant-migrations/0006_cards_rpcs.sql`):
  Same four RPCs copied verbatim onto `eq-canonical-internal` and
  `sks-canonical`. They take `p_tenant_id` and `p_user_id` as explicit
  parameters because service-role callers don't carry a JWT.

- **Netlify function** `netlify/functions/cards-api.ts`: JWT-authed
  multiplexer. Multiplexes by `?op=…`:

  | Verb + path | Op |
  |---|---|
  | `GET /cards-api?op=current_staff` | → `eq_cards_current_staff(t, u)` |
  | `GET /cards-api?op=list_my_licences` | → `eq_cards_list_my_licences(t, u)` |
  | `POST /cards-api?op=upsert_my_licence` body `{ payload }` | → `eq_cards_upsert_my_licence(t, u, payload)` |
  | `POST /cards-api?op=soft_delete_my_licence` body `{ licence_id }` | → `eq_cards_soft_delete_my_licence(t, u, id)` |

  Auth: `Authorization: Bearer <supabase_jwt>`. Same JWT Cards already mints.

## What Cards mobile needs to change

**One file**: `lib/features/licences/data/licence_repository.dart`.

### Constructor — point at the cards-api base URL

```dart
class LicenceRepository {
  LicenceRepository(this._client, {String? apiBase})
      : _apiBase = apiBase ?? 'https://core.eq.solutions';
  final SupabaseClient _client;
  final String _apiBase;

  // _bucket stays — image storage migration is a separate, later step.
  static const _bucket = 'licence-photos';
  static const _signedUrlSeconds = 3600;
```

### `getAllForCurrentUser` — list licences

```dart
Future<List<Licence>> getAllForCurrentUser() async {
  final session = _client.auth.currentSession;
  if (session == null) throw const NotAuthenticatedFailure();
  try {
    final res = await http.get(
      Uri.parse('$_apiBase/.netlify/functions/cards-api?op=list_my_licences'),
      headers: {'Authorization': 'Bearer ${session.accessToken}'},
    );
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200 || body['ok'] != true) {
      throw _fromBody(body, res.statusCode);
    }
    final list = (body['licences'] as List)
        .cast<Map<String, dynamic>>()
        .map(Licence.fromJson)
        .toList();
    return Future.wait(list.map(_withSignedUrls));
  } catch (e) {
    throw mapSupabaseError(e);
  }
}
```

### `upsert` — same payload shape, new transport

```dart
Future<Licence> upsert(Licence licence) async {
  final session = _client.auth.currentSession;
  if (session == null) throw const NotAuthenticatedFailure();
  try {
    final res = await http.post(
      Uri.parse('$_apiBase/.netlify/functions/cards-api?op=upsert_my_licence'),
      headers: {
        'Authorization': 'Bearer ${session.accessToken}',
        'Content-Type':  'application/json',
      },
      body: jsonEncode({'payload': licenceToUpsertPayload(licence)}),
    );
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200 || body['ok'] != true) {
      throw _fromBody(body, res.statusCode);
    }
    return _withSignedUrls(Licence.fromJson(body['licence'] as Map<String, dynamic>));
  } catch (e) {
    throw mapSupabaseError(e);
  }
}
```

### `softDelete` — same shape

```dart
Future<void> softDelete(String id) async {
  final session = _client.auth.currentSession;
  if (session == null) throw const NotAuthenticatedFailure();
  try {
    final res = await http.post(
      Uri.parse('$_apiBase/.netlify/functions/cards-api?op=soft_delete_my_licence'),
      headers: {
        'Authorization': 'Bearer ${session.accessToken}',
        'Content-Type':  'application/json',
      },
      body: jsonEncode({'licence_id': id}),
    );
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200 || body['ok'] != true) {
      throw _fromBody(body, res.statusCode);
    }
  } catch (e) {
    throw mapSupabaseError(e);
  }
}

Failure _fromBody(Map<String, dynamic> body, int status) {
  final code   = body['error']  as String? ?? 'unknown';
  final detail = body['detail'] as String?;
  if (code == 'licence_not_found') return const NotFoundFailure();
  if (status == 401)                return const NotAuthenticatedFailure();
  return ServerFailure(detail ?? code);
}
```

`eq_cards_current_staff` lives in `profile_repository.dart` (or similar) —
same pattern: swap `_client.rpc(...)` for `http.get` against `?op=current_staff`,
expect `{ ok: true, staff: <row> | null }`.

### What does NOT change

- `_withSignedUrls()` keeps using `_client.storage.from('licence-photos')` —
  image storage migration is a separate, later step (Shell doesn't display
  these images today, so the divergence is harmless for now).
- `licenceToUpsertPayload()` — pure function, payload shape unchanged.
- `Licence.fromJson` — return shape is identical to old RPC.
- Auth flow — same Supabase JWT, just sent in `Authorization` header to a
  different URL.

## Smoke checklist (post-Cards-mobile deploy)

1. **Cards mobile cold start**: Open the app, sign in. Wallet should
   populate. (Reads through `cards-api?op=list_my_licences` → tenant DB.)
2. **Edit a licence**: Change a field, save. Should persist. (Writes through
   `cards-api?op=upsert_my_licence` → tenant DB.)
3. **Verify on tenant DB directly**:
   ```sql
   -- For SKS (tenant_id 7dee117c-...)
   SELECT licence_id, licence_type, licence_number, updated_at
   FROM app_data.licences
   WHERE updated_at > now() - interval '5 minutes';
   ```
   Should see the row in `sks-canonical`, NOT shared eq-canonical.
4. **Shell admin cross-check**: Open `/sks/cards` in the Shell. The
   licence should appear in the pending list immediately (no manual
   sync needed). This validates the cards bridge + cards-api both read
   from the same tenant DB.

## Rollback

If anything misbehaves post-deploy:
- Cards mobile: revert the `licence_repository.dart` diff, redeploy. The
  old `supabase.rpc('eq_cards_*')` path against shared eq-canonical is
  still functional (we never dropped those RPCs on shared).
- New tenant-DB licences written via cards-api won't auto-appear in
  shared if Cards mobile reverts — manual sync (`sync-tenant-data.mjs
  --slug=<slug>`) covers the gap.

## Storage migration (deferred)

Cards mobile uploads to bucket `licence-photos` on shared eq-canonical.
Shell doesn't display licence photos today, so this divergence is purely
cosmetic for now. When/if we build a Shell admin "review with photo" view,
options are:
- Sync the bucket from shared to tenant
- Have Cards mobile upload directly to tenant storage (requires per-tenant
  storage credentials in the app — separate auth design)

Defer until a Shell-side image consumer lands.

## References

- Architecture: [docs/ARCHITECTURE-V2.md](../ARCHITECTURE-V2.md) §Phase 2.B.6
- Shell function: [netlify/functions/cards-api.ts](../../netlify/functions/cards-api.ts)
- Tenant migration: [supabase/tenant-migrations/0006_cards_rpcs.sql](../../supabase/tenant-migrations/0006_cards_rpcs.sql)
- JWT verify helper: [netlify/functions/_shared/supabase-jwt.ts](../../netlify/functions/_shared/supabase-jwt.ts)
- Cards Flutter repo (local): `C:\Projects\eq-cards`
- Cards Flutter file to edit: `lib/features/licences/data/licence_repository.dart`
- Manual sync script (rollback safety net): [scripts/sync-tenant-data.mjs](../../scripts/sync-tenant-data.mjs)
