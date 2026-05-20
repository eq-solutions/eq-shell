# Phase 1.F — Unified Identity & Permissions

**Status:** Plan drafted 2026-05-20, not started.
**Companion doc:** [IDENTITY-MODEL.md](./IDENTITY-MODEL.md) — the authoritative spec this plan implements.
**Predecessor:** Phase 1.E (Supabase consolidation onto `eq-canonical`).
**Blocks:** Phase 2 (Tender Pipeline import) and all future module work. `claude/phase-2-import-screen` stays paused until 1.F lands.

---

## Goal

Stand up the unified identity layer specified in [IDENTITY-MODEL.md](./IDENTITY-MODEL.md). After Phase 1.F:

- `eq-canonical.users` carries a 5-tier `eq_role` enum + `is_platform_admin` boolean.
- The shell session payload + signed cookie carry both fields.
- `SessionContext` exposes them via `useSession()`.
- A new `useCan()` hook + `<Gate>` component read a static, in-code permission matrix.
- An admin can invite a user with a chosen role + module entitlements, the user lands via an emailed "set your PIN" link, and signs in with role pre-pinned.
- An admin can edit a user's role + entitlements later.
- EQ Field iframe handoff (`mint-iframe-token`) carries the new role information through to Field; Field's existing 2-tier system becomes a derived view.
- Intake reads the new session shape natively.

After Phase 1.F:

- Phase 2 (Tender Pipeline import) resumes — its first PR plugs into `useCan()` from day one.
- Every future module follows the convention in [IDENTITY-MODEL.md §10](./IDENTITY-MODEL.md#10-hard-rules--checklist-for-any-new-module).

## Out of scope

Explicitly **not** in Phase 1.F:

- Per-user Supabase JWTs / RLS work. Today's service-role-key pattern continues. The role gets injected into the JWT only when RLS work begins (Phase 2+).
- Multi-tenant user membership (one user → multiple tenants). [IDENTITY-MODEL.md §11.2](./IDENTITY-MODEL.md#11-open-questions-to-settle-before-implementation) — decide before implementation but the answer is almost certainly "no, one tenant per user" for v1.
- Password / MFA replacement of PIN. PIN stays for v1; revisit in [§11.1](./IDENTITY-MODEL.md#11-open-questions-to-settle-before-implementation).
- Self-service password / PIN reset flow (admin-driven only in v1).
- Audit log of permission decisions.

## Pre-flight decisions (block start)

Before any code lands, settle the four open questions in [IDENTITY-MODEL.md §11](./IDENTITY-MODEL.md#11-open-questions-to-settle-before-implementation). The plan below assumes:

- PIN auth stays (bcrypt-hashed, same as today).
- One user belongs to one tenant.
- 5 tiers are the right number for v1.
- "Set your PIN" landing page only asks for PIN; display name comes from the invite payload, editable by admin later.

If any of those assumptions change, the relevant step below changes accordingly.

---

## Sequence

Each numbered group is a self-contained PR. They merge in order. No step skips the spec.

### 1. Migration — eq-canonical schema

**One PR. One Supabase migration.**

```sql
-- 2026_05_XX_phase_1f_unified_identity.sql

-- 1a. The enum.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'eq_role') then
    create type public.eq_role as enum (
      'manager', 'supervisor', 'employee', 'apprentice', 'labour_hire'
    );
  end if;
end $$;

-- 1b. Move users.role from text to enum.
-- Reseed the single existing 'admin' row to 'manager' before the type swap.
update public.users
  set role = 'manager'
  where role = 'admin';

alter table public.users
  alter column role type public.eq_role using role::public.eq_role,
  alter column role set default 'employee',
  alter column role set not null;

-- 1c. Platform admin boolean.
alter table public.users
  add column if not exists is_platform_admin boolean not null default false;

update public.users
  set is_platform_admin = true
  where email = 'dev@eq.solutions';

-- 1d. Invite scaffolding.
create table if not exists public.user_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  role public.eq_role not null,
  entitlements text[] not null default '{}',  -- list of module slugs to enable
  invited_by uuid references public.users(id),
  invite_token_hash text not null,            -- bcrypt-hashed one-time token
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_invites_tenant_email on public.user_invites (tenant_id, email);
create index if not exists user_invites_token on public.user_invites (invite_token_hash);
```

**Verify:** `select role, is_platform_admin from public.users where email = 'dev@eq.solutions'` returns `('manager', true)`. `\d+ public.users` shows `role` as `eq_role` not `text`.

**Rollback path:** keep the migration reversible until the bridge in step 4 is shipped — if Field's handoff breaks against the new role, we need to be able to revert the type swap.

### 2. Session payload + cookie

Files touched:
- [`netlify/functions/shell-login.ts`](../netlify/functions/shell-login.ts)
- [`netlify/functions/verify-shell-session.ts`](../netlify/functions/verify-shell-session.ts)
- `netlify/functions/_shared/token.ts` (signSessionToken signature)
- `netlify/functions/_shared/supabase.ts` (`CanonicalUser` type)

Changes:
- `CanonicalUser.role` typed as `EqRole`; add `is_platform_admin: boolean`.
- `signSessionToken` payload extended to `{ user_id, tenant_id, role, is_platform_admin, exp }`.
- `verify-shell-session` returns `role` + `is_platform_admin` in the response body (currently they're returned implicitly via the user object, but we want explicit top-level fields too so the React shell can grab them without re-flattening).
- `shell-login` returns the same shape post-login.

**Verify:** sign in as `dev@eq.solutions`, inspect the decoded cookie payload — `role: 'manager', is_platform_admin: true` present.

**No client changes in this PR.** The shell ignores the new fields until step 3.

### 3. SessionContext + useCan + Gate

Files touched:
- [`src/session.ts`](../src/session.ts)
- New: `src/permissions.ts`
- New: `src/permissions/Gate.tsx`
- New: `src/permissions/matrix.ts` (composes per-module exports)

Changes:
- `User` type gets `role: EqRole` + `is_platform_admin: boolean` (rename `role: string` to the literal union).
- New `EqRole` type, `PermKey` type (string literal union derived from the master matrix).
- `useCan(perm: PermKey): boolean` hook — reads role + platform_admin from `SessionContext`, returns boolean. Short-circuits to true when `is_platform_admin`.
- `<Gate perm="...">` component — renders children when `useCan()` is true, optional `fallback` prop.
- `src/permissions/matrix.ts` exports `MATRIX: Record<EqRole, Set<PermKey>>` composed at import-time from each module's `permissions.ts` (initially empty — modules contribute in later PRs).

Convention is enforced at the type level. A typo in a perm key fails to compile because `PermKey` is a closed union over the master matrix.

**Verify:** unit test — `useCan('any_known_key')` returns true for a platform admin regardless of role's matrix entry; returns matrix lookup for non-platform-admin users.

### 4. EQ Field iframe bridge

File touched: [`netlify/functions/mint-iframe-token.ts`](../netlify/functions/mint-iframe-token.ts).

Changes:
- The 60-second HMAC payload extends from `{ kind, name, role: 'staff' | 'supervisor', exp }` to `{ kind, name, role: 'staff' | 'supervisor', eq_role: EqRole, is_platform_admin: boolean, exp }`.
- The `staff | supervisor` field stays for backward compatibility with Field's current `verify-shell-token` handler (no Field-side change required to ship this PR).
- Mapping rule from [IDENTITY-MODEL.md §7.1](./IDENTITY-MODEL.md#71-eq-field-iframe):
  - `manager` OR `is_platform_admin = true` → Field role `supervisor`
  - `supervisor` → Field role `supervisor`
  - `employee` / `apprentice` / `labour_hire` → Field role `staff`

**Follow-up PR on `eq-field-app` (separate repo, not blocking this phase but tracked here):** Field's `verify-pin` handler starts reading `eq_role` from the shell token and storing it in Field's session, so Field's UI can begin honouring the finer-grained tiers ahead of decommissioning. Filed as a tracking item, not a blocker for Phase 1.F merge.

**Verify:** `POST /.netlify/functions/mint-iframe-token` with `dev@eq.solutions` cookie returns a token whose decoded payload contains `eq_role: 'manager', is_platform_admin: true, role: 'supervisor'`.

### 5. Admin: invite user

Files touched:
- New: `netlify/functions/invite-user.ts` — admin-only endpoint, posts an invite, sends email, writes `user_invites` row.
- New: `netlify/functions/accept-invite.ts` — landing-page endpoint, verifies token, creates `users` row, signs them in.
- New: `src/pages/AdminInviteUser.tsx` — admin UI form.
- New: `src/pages/AcceptInvite.tsx` — public "set your PIN" landing page.
- [`src/App.tsx`](../src/App.tsx) — register new routes (`/<tenant>/admin/users/invite`, `/accept-invite`).

`invite-user.ts` semantics:
- Caller must have `useCan('admin.invite_user')` — gated server-side too via session role check.
- Body: `{ email, role, entitlements: string[] }`.
- Writes `user_invites` row, sends email via the same provider EQ Field uses for `send-email.js`, returns `{ ok: true }`.

`accept-invite.ts` semantics:
- Body: `{ invite_token, pin }`.
- Verifies invite_token_hash matches and `expires_at > now()`.
- Creates `users` row with the invite's role + entitlements, bcrypt-hashes pin, marks invite `accepted_at`.
- Sets `eq_shell_session` cookie and redirects to `/<tenant>/`.

**Verify:** end-to-end — admin invites `test@example.com` as `employee` with `field` + `intake` entitlements → email arrives → click link → set PIN → land on tenant home with the correct role and modules visible.

**Permission key contributed:** `admin.invite_user` (manager + platform_admin only).

### 6. Admin: edit / deactivate user

Files touched:
- New: `netlify/functions/edit-user.ts` — admin-only, mutates role / entitlements / active flag.
- New: `src/pages/AdminUserList.tsx` — list of users in this tenant.
- New: `src/pages/AdminEditUser.tsx` — edit form.
- [`src/App.tsx`](../src/App.tsx) — routes.

**Permission keys contributed:** `admin.edit_user`, `admin.deactivate_user` (manager + platform_admin).

**Verify:** admin demotes a `supervisor` to `employee`, target user signs out and back in, lands without supervisor perms.

### 7. Intake module bridge

File touched: [`src/modules/intake/*`](../src/modules/intake/) — wherever Intake currently reads session.

Changes:
- Replace any local "is this user an admin" check with `useCan('intake.<verb>')`.
- New `src/modules/intake/permissions.ts` declaring the module's perm keys against the 5-tier matrix.

Tender Pipeline (`src/modules/tender-pipeline/`) gets the same treatment **in Phase 2** when its branch is unparked — not in 1.F.

**Verify:** browser smoke test with the `core` tenant. Manager (Royce) sees all Intake actions. Hypothetically demote to `employee` and confirm `intake.import` is gated off. Restore.

### 8. Documentation pass

- [`README.md`](../README.md) — phase plan table gets a "1.F — Unified Identity" row. Auth contract section gets a "carries role + is_platform_admin" addendum.
- [`docs/IDENTITY-MODEL.md`](./IDENTITY-MODEL.md) — version bumped from v1 (draft) to v1 (live). Section 11 open questions resolved or moved to v2 backlog.

## Risk register

- **Field role mapping wrong.** If the staff↔supervisor derivation in step 4 doesn't match what Field actually expects, the iframe handshake silently downgrades or breaks. Mitigation: smoke test the full `dev@eq.solutions` → Field handoff before merging step 4. Keep step 1 reversible until step 4 is green.
- **Invite email deliverability.** Same provider as Field's send-email function; risk is shared but tractable. Mitigation: log the invite token server-side during the first week of use so a stuck invite can be hand-delivered.
- **Module declares wrong perm keys.** Per-module permissions.ts gives every module a foot-gun. Mitigation: the master matrix type is a closed union, so typos fail to compile. Code review checks against [IDENTITY-MODEL.md §4.2](./IDENTITY-MODEL.md#42-permission-keys) naming.
- **Session payload size.** Cookie grows from ~150 bytes to ~250 bytes with role + boolean + entitlements list. Well under any browser limit, but worth noting.
- **Phase 2 rebase cost.** `claude/phase-2-import-screen` will need rebasing onto `main` after 1.F. The branch is small (placeholder routes + a mock repository) so the cost is contained, but the longer 1.F takes, the wider the gap. Mitigation: don't extend 1.F scope mid-flight — keep the open questions in §11 tightly scoped.

## Effort estimate

Rough sizing, each step measured as solo developer with no surprises:

| Step | Estimate |
|---|---|
| 1. Migration | 0.5d |
| 2. Session payload | 0.5d |
| 3. SessionContext + useCan + Gate | 1d |
| 4. Field iframe bridge | 0.5d (+ a follow-up Field-side PR not included here) |
| 5. Admin invite flow | 2d (server + landing + email wiring) |
| 6. Admin edit / deactivate | 1d |
| 7. Intake bridge | 0.5d |
| 8. Documentation pass | 0.5d |
| **Total** | **~6.5d focused work** |

Pre-flight decisions add ~0.5d if any of the four §11 questions need real exploration.

## Definition of done

- All 8 steps merged to `main`.
- `dev@eq.solutions` logs into `core.eq.solutions`, sees role `manager` + platform admin in the session payload.
- A second invited user can complete the invite flow end-to-end, sign in, and have the correct role + entitlements applied.
- EQ Field iframe handoff still works (regression check on the `core` tenant).
- Intake module gates one action via `useCan()`.
- [`docs/IDENTITY-MODEL.md`](./IDENTITY-MODEL.md) version is live (not draft).
- Phase 2 (Tender Pipeline) branch is rebased onto `main` and ready to resume with `useCan('tender.*')` calls in place of any prior admin-only assumptions.
