# PostHog canonical distinct_id — decision record

**Date:** 2026-06-05
**Context:** PostHog (EU, project 162632 "eq-production") logged the same human under
multiple `distinct_id`s because each EQ app passed a different value to
`posthog.identify()`. Symptom: "Refused to merge an already identified user"
warning (88 events/30d, rising) + inflated user counts (19 `tenant:handle` ids
vs 419 `uuid` ids over 30d — the same people counted more than once).

## What was actually true (verified in code, not docs)

The three apps sit on **three different identity backends**, so there is no
shared UUID:

| App | identify() arg (before) | What that id is | Has canonical UUID? | Has email? |
|---|---|---|---|---|
| Shell | `user.id` | `shell_control.users.id` (eq-canonical) | yes (it *is* canonical) | yes |
| Service | `user.id` | **GoTrue `auth.users.id` in Service's own Supabase** — a different namespace | no | yes |
| Field | `slug:handle` (e.g. `sks:royce.milmlow`) | constructed from `currentManagerName` | no | only via Shell handoff (see below) |

So Service's `user.id` is **not** the canonical UUID — the "uuid" bucket in
PostHog was itself two namespaces (Shell-uuid + Service-uuid) already
double-counting. The naive "use the canonical UUID everywhere" plan is
**unachievable**: Service cannot produce the canonical UUID, and Field has no
per-user UUID in most paths.

## Decision

**Canonical `distinct_id` = the user's email, lowercased.** It is the only key
all three apps can emit for the same human.

- **Shell** — already has `user.email`; pass it as the identity. One line.
- **Service** — already has `user.email` in `(app)/layout.tsx`; pass it. One line.
- **Field** — propagate the email Field's server **already receives** on the
  Shell handoff, then identify with it:
  - Token-mode tenants (SKS, ~38k events): `token-exchange` mints a Supabase JWT
    carrying `app_metadata.email`; `verify-pin.js` already decodes it (it was
    discarded). Now returned to the client.
  - Cookie-mode tenants: `verifyShellCookie` already returns `{user_id, email}`.
  - Legacy HMAC `mint-iframe-token` path: no email — but FieldIframe no longer
    uses it (PR #140 swapped iframes to `token-exchange`). Left as-is; falls
    back to `tenant:handle` harmlessly.
  - Standalone PIN gate: a shared per-tenant code, not a per-person identity —
    correctly falls back to `tenant:handle`.

  **No change to the signed HMAC token shape / `token.ts` → no auth-boundary
  change.** This covers 100% of live production handoffs.

## History migration

Switching Field's `distinct_id` from `tenant:handle` to email does **not**
retro-merge its historical events. On the first post-change identify in Field
(per device, guarded by a `localStorage` flag) we call
`posthog.alias(<email>, <old tenant:handle>)` to bridge the ~38k historical
Field events to the unified person.

Caveat: PostHog limits merging two *already-identified* ids. For returning Field
users whose browser already has `tenant:handle` identified, the alias is
best-effort; new/anonymous sessions bridge cleanly. Worst case for already-
identified returning users is equivalent to a clean cut (history stays under the
old id) — no regression, and it removes the recurring "refused to merge" warning
going forward.

## Out of scope / not changed

- `token.ts` / `ShellTokenPayload` / `mint-iframe-token.ts` — untouched (no
  auth-boundary change).
- Sentry/Clarity: the same identity string flows through `identifyUser` /
  Field's `_identify`, so they gain the same cross-app stitching for free; no
  separate change.
