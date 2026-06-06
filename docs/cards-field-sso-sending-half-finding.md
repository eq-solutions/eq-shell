# Cards-worker → EQ Field SSO (sending half) — finding & hand-off

> **Status: BLOCKED upstream — do NOT patch the mint yet.**
> **Date:** 2026-06-06 · **Author:** claude (recon session) · **Verified against live** eq-canonical (`jvknxcmbtrfnxfrwfimn`) + eq-shell mint code on `main` (HEAD `265fb4a`, #175).

## Goal (the seam)
A Cards-onboarded SKS worker, authenticated via Shell, opens EQ Field and lands on **their** profile with no second login — resolved deterministically by `canonical_user_id` (= `public.workers.id` = Field `people.canonical_id` post-resync), with `phone` as fallback.

The **Field (receiving) side is built, deployed, verified** (sks-nsw-labour v3.10.59): `verify-pin.js` consumes the `#sh=<token>` handoff and resolves person by `canonical_id` → phone(last-9) → name. The remaining work is the **eq-shell mint (sending half)**.

## Verdict: the mint cannot be built yet — the blocker is upstream identity provisioning

### Live evidence (eq-canonical `jvknxcmbtrfnxfrwfimn`, 2026-06-06)
| Check | Result | Meaning |
|---|---|---|
| `workers` total / with `user_id` | **36 / 1** (35 without) | 35 workers have no auth identity |
| `auth.users` / `shell_control.users` | **7 / 5** | Identity surface is operators/admins, not the crew |
| workers ↔ `shell_control.users` linked | **1** | Only the lone seeded worker links |
| `workers.user_id` FK constraint | **none** (bare column) | The link the whole SSO chain depends on is unenforced |
| `worker_invites`: total / **claimed** / open / expired | **56 / 0 / 55 / 1** | #175 bridge has *issued* invites; **zero claimed** |

### Root-cause chain
1. `netlify/functions/mint-iframe-token.ts` (aud='field') resolves identity **only** from the `users` table via `session.user_id` — there is no `workers.id`/`phone` in scope.
2. To hold a Shell session, a worker needs an `auth.users` + `shell_control.users` row with `workers.user_id` pointing to it.
3. The #175 `worker_invites` bridge is merged to `main` and has issued 56 invites — but **0 are claimed**, so no worker has crossed from *profile row* → *authenticated identity*.
4. ∴ 35/36 workers cannot get a Shell session → the mint has nothing to resolve → a mint patch now would be inert for the crew and untestable against a real `workers.id`.

**The blocker is the invite-claim step, not the token mint.**

## Hand-off to the owning workstream
**Owners:** #175 (invite migrated staff bridge, merged) + `claude/sks-go-live-runbook`. Before any mint change has effect, deliver:
- A **claim flow** turning a `worker_invites` row into `auth.users` + `shell_control.users`, and **setting `workers.user_id`** to that identity.
- **Add the missing FK** `workers.user_id → shell_control.users.id` to enforce the link (currently a bare column — found unenforced 2026-06-06).
- At least **one real worker claimed end-to-end** as the test fixture.
- Confirm the invariant `workers.id` === Field `people.canonical_id` (post phone-resync) holds for that worker.

**Exit signal to resume the mint work:** `select count(user_id) from public.workers` climbs past 1.

## The mint change — PRE-SPECIFIED, do NOT apply until the exit signal
Additive and safe (Field ignores these fields when absent — `JSON.parse` drops unknown keys; Field reads `canonical_id`/`phone` only when present):
1. `netlify/functions/_shared/token.ts` → `ShellTokenPayload`: add `canonical_user_id?: string; phone?: string;`
2. `netlify/functions/mint-iframe-token.ts` (aud='field', after resolving `user`): look up `workers` by `user_id = user.id`; select `id, phone`; pass `canonical_user_id: workers.id` + `phone` into `signShellToken`.
3. `netlify/functions/mint-cards-iframe-token.ts`: same addition on its worker-session path.
4. Keep existing fields (`kind:'shell-token'`, `name`, `role`, `eq_role`, `is_platform_admin`, `tenant_slug`, `exp ~60s`). `'sks'` already in `ALLOWED_FIELD_TENANT_SLUGS`. `signShellToken` signs with `EQ_SECRET_SALT` (byte-identical to the SKS site — Gate 0 green).
5. **Verify:** a real signed token returns `valid:true` from the live Field `verify-pin` with id/phone echoed; no regression to the operator (`shell_control.users`) Field handoff.

## Constraints honoured
- No code touched (recon only, per READ-FIRST). No deploy.
- EQ ↔ SKS are separate entities — the sks-nsw-labour (receiving) side was not touched; its work is done.
- The mint patch, when ready, must coordinate with the active auth-path branches (`claude/sks-go-live-runbook`, `claude/sks-field-eq-build`, the b4/d06 auth work) — do not clobber.
