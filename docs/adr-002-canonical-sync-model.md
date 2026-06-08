# ADR-002 — Canonical data sync model (write path, identity, staying current)

- **Status:** Accepted — 2026-06-08 (Royce)
- **Extends:** `ARCHITECTURE-V2.md` (canonical = system of record, locked 2026-05-30)
- **Companion to:** `eq-context/cross-app-linkage-audit-2026-06-07.md` (the live evidence)
- **Decision owner:** Royce Milmlow

## Context

The suite runs on **separate Supabase projects per tenant** + a control plane (jvkn).
No cross-database foreign keys are possible. Shared "master" entities (the 6-entity
spine: **customer, site, staff, asset, contact, licence**) must mean the same thing in
every app. `ARCHITECTURE-V2` already chose **canonical as the system of record**; apps
are consumers over `canonical-api`, not parallel authoritative stores.

But the live audit (2026-06-07) and a code-seam audit (2026-06-08) showed the decision
was only *half-built*:

- **Quotes** is still **local-first dual-write** (`sks_quotes_customers` first, then mirror
  up) — the direct cause of customer fragmentation (3–4 stores, `canonical_id` ~0–28/520,
  117 duplicate-name groups in `app_data.customers`).
- **Service** conforms (canonical-first PUT, stamps `canonical_id`).
- **Intake** writes canonical directly via `eq_commit_batch` — "the only path in" — but its
  **dedupe matcher is unbuilt**.
- `canonical-api` already supports **match-or-create upsert by `external_id`** + a
  `?since=` delta-read + an append-only `canonical_events` log.
- **`quote-job-consumer.ts` is deployed** — a scheduled (15-min) consumer polling `?since=`
  for `quote.accepted` and upserting jobs. The scheduled-consumer pattern is **proven**.
- **No down-sync loop exists** — `?since=` is only ever used to write *up*. Nothing refreshes
  an app cache *down*. That, plus non-atomic "local-write-then-HTTP-POST", is why back-links
  sit near zero.

The question driving this ADR: do we go bidirectional, or force creation through Shell?

## Decision

**Reaffirm canonical-first write-through. Reject bidirectional/multi-master.** Bidirectional
is the current disease, not the cure: multi-master assumes identity is already resolved (so
rows can be merged) — we cannot yet say which two "Acme"s are the same. It would amplify the
duplicate problem. Centralise the **write path**, not the **UI**: a user still creates a
customer from the app they're in, but that create goes **through `canonical-api`
(match-or-create)** and the app keeps a `canonical_id`-stamped **read-cache**, not a rival
store.

Six concrete commitments:

1. **One writer of record per entity** (directional, not symmetric sync):

   | Entity | System of record | Everyone else |
   |---|---|---|
   | Customer / Contact / Site | **Canonical** (canonical-api upsert + dedupe-on-write) | read/cache |
   | Asset / test / defect | **Service** → pushes up (live, 100% linked) | read |
   | Schedule / timesheet / roster | **Field** (resources rule) | read |
   | Worker / credential | **Cards / jvkn** | read |
   | Job / work-order | **Canonical writer on `quote.accepted`** (consumer deployed) | read |
   | **Person identity** | **Control plane (`shell_control`)** — see #2 | all tenants |

2. **Person identity is promoted to the control plane.** Per-tenant canonical works for
   customer/site/asset (they don't cross tenants). The labour-hire case (one worker
   sub-contracted across tenants) breaks every per-tenant pattern — there is no plane where
   the join lives. Resolution: a **control-plane `person` golden record + `xref
   (tenant, local_worker_id) → person_id`**. `shell_control` already spans tenants and owns
   identity/membership. **Only an opaque identity pointer is shared; hours, licences,
   payroll, assignments stay tenant-scoped and never cross** — this respects EQ/SKS entity
   separation. "Who is this human" (control plane, cross-tenant) is split from "what they did
   for tenant X" (tenant-scoped).

3. **Identity is resolved by an xref / golden-id spine — deterministic first.** The single
   highest-leverage primitive. Match on exact ABN/email/phone day one (collapses the obvious
   dupes, makes back-links *mean* something). Probabilistic matching (pg_trgm → fuzzy rescore)
   + a steward review queue come **later, behind the same contract** — never auto-merge on a
   fuzzy score without labelled thresholds. **Merges stay reversible** (soft-merge + provenance).

4. **Staying current = a scheduled reconciler, not streaming.** Build the missing down-sync
   loop as a batch `?since=` drain that refreshes app caches (reuse the proven
   `quote-job-consumer` pattern). **Batch-first is the chosen size** — defer CDC / logical
   replication / event-sourcing until batch latency demonstrably hurts. Reliable delivery is
   added via a **transactional outbox** (one local txn: write entity + record intent-to-sync),
   which closes the non-atomic-POST gap that produced the ~0% back-link.

5. **Synchronous for office apps, provisional-id for field.** Canonical stays a synchronous
   dependency for office apps (Quotes/Service/Cards — fine at this scale). Field **offline
   creates** get the one sanctioned exception: a **provisional local id + async reconcile**.
   This is the only place local-first is justified.

6. **The event log stays as audit + replay substrate** (not the primary entity model). When
   the fuzzy matcher lands, history can be replayed through better merge logic instead of a
   one-shot production merge.

## Why not the alternatives (steelman summary)

- **Bidirectional/multi-master:** best *availability*, but assumes identity is solved — it
  amplifies our duplicate problem. Avoided as a *goal*; we get its availability benefit
  indirectly via the async outbox without signing up for hand-written conflict merges.
- **Event sourcing (primary):** powerful for replay-remerge, but full ES is over-budget for
  ~6 apps + small team. Kept as secondary audit/replay only.
- **Outbox + CDC:** outbox is adopted (#4). **Logical-replication CDC is deferred** — N
  tenants = N slots to babysit (WAL footgun); outbox-poll gives the same delivery guarantee
  with far less ops load.
- **CQRS read-models:** adopted in spirit (#1 "read-cache") — an app's local copy is a
  read-model, not a rival SoR. Not built as bespoke per-app projections beyond that.
- **MDM match/merge:** this *is* the missing primitive (#3), but synchronous blocking
  fuzzy-dedupe in the create hot path is rejected (false-merge risk > duplicate risk).

## Consequences & build order

1. **xref / golden-id spine** (deterministic ABN/email/phone). Highest leverage.
2. **Flip Quotes → canonical-first** (write through canonical-api; demote
   `sks_quotes_customers` to a `canonical_id`-stamped cache). Kills fragmentation at source.
3. **Transactional outbox** for delivery reliability (closes the back-link gap).
4. **Scheduled down-sync reconciler** (`?since=` drain → refresh caches).
5. **Person spine in the control plane** (the labour-hire enabler — accepted 2026-06-08).
6. *Later, only when batch hurts:* probabilistic matcher + steward UI + CDC.

**Explicitly deferred:** CDC/logical replication, full event sourcing, probabilistic
auto-merge, steward UI. **Avoided as goals:** multi-master conflict resolution, synchronous
fuzzy-dedupe in the create path.

## Open follow-ups

- Mirror a strategic pointer into `eq-context` decisions log (cross-app source of truth).
- Spec PR-1: the xref schema + deterministic matcher + the Quotes canonical-first flip.
- Confirm the legal posture of the opaque cross-tenant person pointer is documented in the
  entities reference (entity separation: identity pointer shared, payroll never).
