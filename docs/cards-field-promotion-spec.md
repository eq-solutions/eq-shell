# Cards → Field promotion — refactor spec

**Status:** design-locked; **Shell-side code BUILT on branch 2026-06-06 (green, not
applied/deployed/merged)** — `_shared/field-promotion.ts` + refactored
`cards-approve-staff.ts` / `cards-pending-staff.ts`. Apply + deploy gated (see below).
Author: 2026-06-06. **Sprint:** `~/.claude/plans/cards-field-promotion-sprint.md`.
**Do not apply/deploy standalone** — invisible before the F3 cutover (SKS "Field" is
still the legacy `sks-nsw-labour` app, which never reads the tenant plane).

## What this fixes

`cards-approve-staff` today reads the Cards profile from the tenant plane correctly,
then **blind-INSERTs a new person into the Field DEMO project** (`FIELD_SUPABASE_URL`
= `ktmjmdzqrogauaevbktn`, `public.people`) — wrong DB, needs `tenants.field_org_id`
(NULL for SKS → 500), no dedupe. It has only ever run for `core`/demo.

The fix reframes promotion as a **state transition on the row that already exists** in
the tenant plane, not a cross-DB copy. The duplicate-person risk dissolves because
there is no INSERT.

## Decisions locked (D-A…D-D, steelmanned 2026-06-06)

- **D-A** — the gate is `app_data.staff.field_status` (`pending` | `active` | `rejected`),
  authored in `0039_staff_field_status.sql`. Tenant-plane, because Field reads its own
  plane and cannot cheaply join the control-plane `cards_field_approvals` (that row
  stays who/when audit, not the gate). **Steelman upgrade:** Field reads through the
  single view `app_data.field_people` (= staff WHERE field_status='active'), never the
  raw table — so no consumer can forget the filter and leak a pending person. The gate
  is the surface.
- **D-B** — keep the manual "Add to Field" gate as the **launch policy**, but
  **decouple it from the UI** (steelman): promotion is a standalone
  `promoteStaffToField(staff_id, tenant_id, by_user_id)` helper the click calls today
  and an auto-trigger could call later. Architecture allows auto; policy stays manual.
  No config surface built now.
- **D-C** — collapse `public.sks_staff` into `app_data.staff` **once**, during F2, as a
  **dedup + provenance-merge of the overlaps — NOT a promotion** (steelman): the 19 are
  *managers*; management ≠ dispatch roster. Net-new managers default **not**
  field-active; Royce flags the ones who are also field workers. Audit what reads
  `sks_staff` before retiring it.
- **D-D** — **FLIPPED (steelman): single state-flip path for ALL tenants; retire the
  demo write path (`FIELD_SUPABASE_*` + `field_org_id`) entirely.** No tenant branch.
  Promotions are dormant-until-that-tenant's-Field-cutover for everyone, incl. `core`.
  **Gate on removal:** verify `core` has no live dependency on the demo path (looks
  dormant — 2 historical rows, none since 2026-05-23) and get Royce's explicit ok,
  since it removes a currently-deployed capability.

## The refactor (apply inside F1, with 0039, behind a PR)

### `cards-approve-staff.ts` — single path, all tenants (D-D flipped)

- Extract the promotion into a helper (D-B decouple):
  ```
  // promoteStaffToField(staff_id, tenant_id, by_user_id)
  UPDATE app_data.staff
     SET field_status = 'active', updated_by = <by_user_id>
   WHERE staff_id = <staff_id> AND tenant_id = <tenant_id>
  ```
  via `getTenantDataClientById(tenant_id)` (service-role, **β-aligned** — same pattern
  as the existing `entity-*` surface). The manual approve calls this helper today; an
  auto-trigger can call the same helper later.
- **Remove for ALL tenants** (no `core` branch): the `getFieldServiceClient()` INSERT,
  the `tenants.field_org_id` lookup, the `people`/`qualifications` writes, the dob
  day/month parsing. Licences are already co-located in `app_data.licences` — nothing
  to copy.
- **Reject:** `field_status = 'rejected'` on the staff row **and** the control-plane
  audit row (unchanged who/when).
- **Audit row (`cards_field_approvals`):** still written for both outcomes. **Fix
  `field_project_ref`** in the same change — drop the `'ktmjmdzqrogauaevbktn'` column
  DEFAULT or set it from `tenant_routing.supabase_project_ref`; the row's `tenant_id`
  already names the plane, so today's default silently lies for any non-demo write.
- Keep: idempotency guard (409 if already reviewed), `admin.review_cards` gate.

> **Pre-req for the D-D flip (removing the demo path is a live-behaviour change):**
> confirm `core` has no active use of the demo promotion (2 rows, none since
> 2026-05-23) and get Royce's explicit ok before deleting `_shared/field-supabase.ts`
> + its env vars. Until then the helper is the only path; the demo client is simply
> unreferenced.

### `cards-pending-staff.ts`

- Pending filter becomes `field_status = 'pending'` (replaces the
  `imported_from !== 'eq-solves-field'` heuristic, which only worked because the 49
  back-migrated rows happen to carry that marker — `0039` backfills them to `active`,
  so the heuristic and the explicit gate agree, and the explicit one is clearer).

### Field read path

- Field's people query (in `eq-solves-field`, post-cutover) selects from the
  `app_data.field_people` **view**, not `app_data.staff` — see D-A. The Shell-side
  reuse surface (`entity-rows` etc.) should register `field_people` as the people
  entity so the filter is structural, not per-call.

### Cleanup (single path — D-D flipped)

- Retire `_shared/field-supabase.ts` + `FIELD_SUPABASE_URL` /
  `FIELD_SUPABASE_SERVICE_ROLE_KEY` **outright** once the demo-path removal is
  confirmed safe for `core` (see pre-req above) — not deferred to F4, not kept for a
  tenant branch. One path, no demo client.

## sks_staff reconciliation (D-C) — live dry-run, 2026-06-06

`scripts/reconcile-sks-staff-dry-run.mjs` (read-only). Live result against ehowg:

| | count |
|---|---|
| active managers in `public.sks_staff` | 18 |
| already in `app_data.staff` by phone | 7 |
| already in `app_data.staff` by email only | 1 |
| **net-new (no match)** | **10** |

So **8 of 18 managers already exist** in the canonical table — that overlap is exactly
the duplication the bridge would have caused had it inserted blindly into a shared
people table. **The collapse dedups those 8 (provenance-merge of the duplicate human),
it does NOT promote anyone** (D-C steelman): a merged manager's `field_status` reflects
their real role — a dispatchable supervisor → `active`, a pure office manager →
stays `pending`/unset, never auto-`active`. The 10 net-new managers default **not**
field-active; Royce flags the few who are also field workers. Ambiguous (>1) matches go
to a human. **Applied during F2**; first audit what still reads `public.sks_staff`
before retiring it.

## Sequencing

1. **Now (this sprint, ungated):** `0039` authored (not applied), this spec, the
   read-only dry-run. ✅
2. **F1 (gated on the Prestart/Toolbox port):** apply `0039` (+ `field_people` view) to
   **both** tenant planes (ehowg + zaap); land the single-path
   `cards-approve-staff` / `cards-pending-staff` refactor (+ the `promoteStaffToField`
   helper) in the same PR that registers Field's `field_people` entity. **In the same
   change, on Royce's ok, drop `field-supabase.ts` + `FIELD_SUPABASE_*`** (the D-D
   flip — no separate F4 step) once `core`'s demo path is confirmed unused.
3. **F2:** run the reconciliation for real — dedup the 8 overlaps (provenance-merge),
   leave managers un-promoted; audit `sks_staff` readers before retiring it.

## Verification (at F1, behind the PR)

- `pnpm run build` green.
- Preview smoke (single path, any tenant): approve flips `field_status` to `active`,
  `app_data.field_people` then includes the row, the pending queue drops it, audit row
  written with a correct `field_project_ref`.
- Confirm **no** `FIELD_SUPABASE_*` env dependency remains on the promotion path.
- Confirm `app_data.field_people` returns only `active` rows (no pending leak).
- Reject sets `rejected` and does not appear in pending or `field_people`.
