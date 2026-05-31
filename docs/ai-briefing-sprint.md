# EQ Shell — AI Briefing Sprint
**Goal:** Production-grade, role-aware AI morning briefing across EQ Shell + SKS pipeline.
**Owner:** Royce Milmlow · eq-solutions
**Date drafted:** 2026-05-29

---

## What's already built

| File | What it does |
|---|---|
| `eq-shell/netlify/functions/ai-briefing.ts` | Sonnet 4.5 synthesis via forced `submit_briefing` tool. Parallel fetch: canonical_events (48h) + pipeline summary. Returns structured JSON: brief, actions[], on_shift[], upcoming[], pipeline, sources, generated_at. |
| `sks-nsw-labour/netlify/functions/pipeline-summary.js` | Read-only tender + resource summary. Bearer token auth (PIPELINE_API_KEY). Returns stage totals, verbal agreements, confirmed jobs, bench/peak demand. |
| `eq-shell/src/pages/TenantHome.tsx` | Renders AI Brief badge, brief prose, ranked actions panel (1-3 with urgency), On Shift / Upcoming / Pipeline side panels, tap-to-regenerate. |
| `eq-shell/src/App.css` | All component styles for above. EQ brand tokens throughout. |

**Env vars to set before going live:**
- `sks-nsw-labour`: `PIPELINE_API_KEY=<strong-random>`
- `eq-shell`: `SKS_PIPELINE_URL=https://sks-nsw-labour.netlify.app`, `SKS_PIPELINE_API_KEY=<same>`

---

## The 10/10 gap analysis

| Gap | Risk if unresolved | Sprint |
|---|---|---|
| Closed-loop events missing | Brief sounds permanently alarmed. "Defect raised" with no "defect resolved" = noise. | 1 |
| Event payload inconsistency | Claude gets `{}` payloads, can't name entities, produces vague brief. | 1 |
| Tender pipeline emits no canonical events | Pipeline is read-only snapshot; changes between logins are invisible to brief history. | 1 |
| Per-user brief caching | 10 simultaneous 7am logins = 10 Sonnet calls. At scale, expensive and incoherent. | 2 |
| Data coverage indicator | Brief sounds authoritative even when 2 of 4 apps have no events. False confidence. | 2 |
| SKS pipeline is a global env var | Any EQ tenant gets pipeline data. Must be per-tenant config. | 2 |
| Entity deep links in brief prose | Entities named in brief but not linked. User has to navigate manually. | 3 |
| Mobile layout | Panels stack poorly below 640px. Most 7am logins are on a phone. | 3 |
| Action → source app link | Actions panel has no tap-through. Urgency identified but not actioned in one tap. | 3 |
| No feedback loop | Claude ranks wrong, nobody knows, it repeats. | 4 |

---

## Sprint 1 — Data foundation
**Rationale:** Claude can only be as good as the events it receives. This sprint makes the underlying data trustworthy. Nothing else matters until this is right.

### 1.1 — Closed-loop events
Add the missing "resolved" half of every event pair. Each app that already emits an opening event must also emit the corresponding close.

**EQ Service** (`eq-solves-service` — wherever defects and work orders are resolved):
```
defect.resolved   payload: { defect_id, site_id, site_name, resolved_by, resolution_note? }
defect.overdue    payload: { defect_id, site_id, site_name, hours_overdue }
wo.overdue        payload: { wo_id, site_id, site_name, hours_overdue }
```

**EQ Field** (`eq-solves-field` — wherever licences are managed and shifts end):
```
licence.renewed   payload: { person_id, person_name, licence_type, new_expiry }
licence.expired   payload: { person_id, person_name, licence_type, expired_at }
shift.ended       payload: { person_id, person_name, site_id, site_name, ended_at }
```

**EQ Quotes** (wherever quotes are closed):
```
quote.expired     payload: { quote_id, reference, client_name, value_cents }
quote.declined    payload: { quote_id, reference, client_name, value_cents }
```

**Emit pattern** (same RPC used by existing events):
```sql
SELECT eq_write_canonical_event('service', 'defect.resolved', '{"defect_id":..., "site_name":...}'::jsonb);
```

**Acceptance criteria:**
- Every opening event has a matching closing event type defined and emitted on state change
- Brief no longer surfaces resolved items as open actions

---

### 1.2 — Payload standardisation
Every event payload must include at minimum:

```json
{
  "reference":   "Q-2026-0418",   // human identifier (quote ref, defect ID, etc.)
  "name":        "J. Thompson",   // person name where relevant
  "site_name":   "Site 4112",     // site name where relevant
  "value_cents": 85000,           // monetary value where relevant
  "due_date":    "2026-06-04"     // deadline where relevant
}
```

Fields are optional where not applicable. Standardising these lets Claude name entities in the brief rather than describing anonymous events.

**Audit:** Read `app_data.canonical_events` for the last 30 days on `eq-canonical`. For each event type, check `payload` keys and add the missing standard fields at the emit site.

**Acceptance criteria:**
- `licence.expiring` payload includes `person_name` and `expires_at`
- `defect.created` payload includes `defect_id` (human ref), `site_name`, `reported_by`
- `quote.sent` payload includes `reference`, `client_name`, `value_cents`
- `shift.started` payload includes `person_name`, `site_name`, `started_at`

---

### 1.3 — SKS tender pipeline emits canonical events
Currently the pipeline is a read-only snapshot. The briefing misses stage changes that happen between logins.

**In `sks-nsw-labour`:** whenever a tender's `stage` column changes, emit a canonical event to SKS's own `canonical_events` table (or create one if not yet present).

```
tender.stage_changed   payload: { tender_id, external_ref, job_name, client, from_stage, to_stage, quote_value }
tender.verbal_confirmed payload: { tender_id, external_ref, job_name, client, quote_value, due_date }  -- when is_high_confidence flips true
tender.won             payload: { tender_id, external_ref, job_name, client, quote_value }
tender.confirmed       payload: { tender_id, external_ref, job_name, client, quote_value, peak_workers, start_date }
```

Use a Postgres trigger on `tenders.stage` update or emit from the import function.

**Acceptance criteria:**
- Stage change in pipeline view creates a canonical event within 30s
- `tender.confirmed` event appears in brief when a tender is promoted

---

## Sprint 2 — Backend hardening

### 2.1 — Per-user brief caching with invalidation
**Problem:** 10 simultaneous logins = 10 Sonnet calls. Brief should be generated once per user per login window and cached.

**Implementation:**
- On `ai-briefing` call, check `app_data.briefing_cache` for a row matching `(tenant_id, user_id)` where `generated_at > NOW() - INTERVAL '10 minutes'`
- If fresh: return cached `payload` (JSON) — no Sonnet call
- If stale or missing: generate → store → return
- Invalidation: Supabase Realtime webhook on `canonical_events` INSERT → delete matching cache row for that tenant

**Schema** (run as migration on eq-canonical):
```sql
CREATE TABLE IF NOT EXISTS app_data.briefing_cache (
  tenant_id    uuid NOT NULL,
  user_id      uuid NOT NULL,
  payload      jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
```

**Acceptance criteria:**
- Second login within 10 minutes returns cached brief (< 100ms response)
- New canonical event invalidates cache for that tenant within 60s
- Manual regenerate bypasses cache (`?refresh=1` already implemented in frontend)

---

### 2.2 — Data coverage indicator
**Problem:** Brief sounds authoritative when coverage is partial.

**In `ai-briefing.ts`:** track which sources were attempted vs succeeded. Return in response:

```typescript
sources_attempted: ['eq-field', 'eq-service', 'eq-quotes', 'eq-cards', 'sks-pipeline'],
sources_succeeded: ['eq-field', 'eq-service', 'sks-pipeline'],  // cards + quotes had no events
```

**In `TenantHome.tsx`:** show below the brief meta:
```
Based on EQ Field, EQ Service, Pipeline · EQ Quotes, EQ Cards not available
```

Render "not available" sources in muted text so the user knows what the brief can't see.

**Acceptance criteria:**
- If any configured app has no events (not an error, just empty), it shows as "no data" not "not available"
- If any app errors, it shows as "not available" and brief continues

---

### 2.3 — Pipeline as per-tenant config
**Problem:** `SKS_PIPELINE_URL` and `SKS_PIPELINE_API_KEY` are global env vars on EQ Shell. Every tenant gets pipeline data.

**Fix:** Move to `shell_control.tenant_config` table:
```sql
ALTER TABLE shell_control.tenant_config
  ADD COLUMN IF NOT EXISTS pipeline_url       text,
  ADD COLUMN IF NOT EXISTS pipeline_api_key   text;  -- store encrypted or in Vault
```

**In `ai-briefing.ts`:** fetch pipeline config from tenant row, not env vars.
```typescript
const tenantConfig = await getServiceClient()
  .schema('shell_control')
  .from('tenant_config')
  .select('pipeline_url, pipeline_api_key')
  .eq('tenant_id', tenantId)
  .single();
```

Remove `SKS_PIPELINE_URL` and `SKS_PIPELINE_API_KEY` from Netlify env vars after migration.

**Acceptance criteria:**
- Adding a second EQ tenant does not expose SKS pipeline data to them
- SKS pipeline config lives in the SKS tenant row only

---

## Sprint 3 — Frontend completeness

### 3.1 — Entity deep links in brief prose
**Goal:** Named entities in the brief prose are tappable links to the source record.

**Pattern:** Claude outputs entity markers in the brief text using the format:
```
[[J. Thompson|/sks/field/staff/42]]
```

Update `SUBMIT_BRIEFING_TOOL` schema:
```json
"brief": {
  "type": "string",
  "description": "2-3 sentences. For named entities where a link is known, use [[Name|/path]] format. Example: [[J. Thompson|/sks/field/staff/42]] — do not use markdown."
}
```

**Frontend parser** (in `TenantHome.tsx`):
```typescript
function parseBriefLinks(brief: string): React.ReactNode[] {
  const parts = brief.split(/\[\[([^\]|]+)\|([^\]]+)\]\]/g);
  // Rebuild alternating text / link nodes
}
```

**Acceptance criteria:**
- Entity names in brief are rendered as `<Link>` components pointing to the source app
- Plain text brief still renders correctly if no markers present

---

### 3.2 — Mobile layout
**Goal:** Panels stack cleanly on a phone. Most 7am logins are mobile.

**In `App.css`:**
```css
@media (max-width: 640px) {
  .eq-hub-panels {
    grid-template-columns: 1fr;
  }
  .eq-hub-actions__list {
    gap: 0;
  }
  .eq-hub-content {
    padding: 16px;
  }
}
```

Brief prose wraps cleanly at `max-width: 100%` on mobile (remove the 640px cap on small screens).

**Acceptance criteria:**
- Brief, actions, and panels render without horizontal overflow at 375px
- Tap targets are minimum 44px height

---

### 3.3 — Action tap-through to source app
**Goal:** Tapping an action card opens the relevant record in the source app.

**In `ai-briefing.ts`:** extend `AiAction` with `link` field:
```typescript
"link": {
  "type": "string",
  "description": "Relative URL to the source record. E.g. /sks/field for EQ Field, /sks/service for EQ Service. Use the app root if no specific record link is derivable."
}
```

**In `TenantHome.tsx`:** wrap action cards in `<Link to={action.link}>` when `action.link` is present.

**Acceptance criteria:**
- Tapping action rank 1 navigates to the relevant app section
- If no link derivable, action renders without tap-through (no broken links)

---

## Sprint 4 — Feedback loop

### 4.1 — Action state persistence
**Goal:** Dismissed or completed actions don't reappear. Acted-on actions feed context back to Claude.

**Schema** (on eq-canonical, `app_data` schema):
```sql
CREATE TABLE IF NOT EXISTS app_data.briefing_actions (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  user_id      uuid NOT NULL,
  action_title text NOT NULL,
  action_source text NOT NULL,
  state        text NOT NULL CHECK (state IN ('actioned', 'dismissed')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON app_data.briefing_actions (tenant_id, user_id, created_at DESC);
```

**In `TenantHome.tsx`:** add Dismiss / Done buttons on each action card. POST to new `/.netlify/functions/briefing-action` on tap.

**New function:** `netlify/functions/briefing-action.ts`
- POST `{ action_title, action_source, state }` 
- Writes to `briefing_actions`
- Invalidates briefing cache for that user

**In `ai-briefing.ts`:** fetch recent actioned items (last 48h) for the user and pass to Claude:
```
RECENTLY ACTIONED (last 48h — do not re-surface unless state has changed):
- "Renew J. Thompson's licence" — marked done 6h ago
```

**Acceptance criteria:**
- Dismissed action does not reappear in the next briefing
- Actioned item reappears only if the underlying event re-fires (e.g. a new licence expiry)
- Action state is per-user, not per-tenant

---

## Kickoff prompt for next Claude session

Paste the following into a new Claude Code session in the `eq-shell` project to pick up Sprint 1:

---

```
We are building the EQ Shell AI morning briefing — a role-aware operational brief that synthesises data from EQ Field, EQ Service, EQ Quotes, EQ Cards, and the SKS NSW Labour tender pipeline.

WHAT'S ALREADY BUILT:
- `netlify/functions/ai-briefing.ts` — Sonnet 4.5 synthesis, structured output via `submit_briefing` tool_use, parallel fetch of canonical events + pipeline summary. Returns: brief, actions[], on_shift[], upcoming[], pipeline, sources, generated_at.
- `sks-nsw-labour/netlify/functions/pipeline-summary.js` — read-only tender + resource summary via Bearer token auth
- `src/pages/TenantHome.tsx` — renders AI brief badge, prose, ranked actions (3 max), On Shift / Upcoming / Pipeline panels, tap-to-regenerate
- `src/App.css` — all new component styles

SPRINT 1 GOAL — Data foundation. Three tasks:

TASK 1: Closed-loop events.
Every app that emits an "opening" event must also emit a "closing" event. Without this, the brief permanently surfaces resolved items as open. 
Required new events:
- EQ Service: defect.resolved, defect.overdue, wo.overdue
- EQ Field: licence.renewed, licence.expired, shift.ended  
- EQ Quotes: quote.expired, quote.declined
All use the existing `eq_write_canonical_event(app_source, event, payload)` RPC.

TASK 2: Payload standardisation.
Read the last 30 days of canonical_events on the tenant DB. For each event type, check payload keys. Every event must include the applicable fields from: { reference, name, site_name, value_cents, due_date }. Find the emit sites in each app repo and add the missing payload fields.

TASK 3: SKS tender pipeline emits canonical events.
In sks-nsw-labour, add a Postgres trigger on `tenders.stage` UPDATE that calls `eq_write_canonical_event` (or equivalent) with: tender.stage_changed, tender.verbal_confirmed (when is_high_confidence flips true), tender.won, tender.confirmed.

CONSTRAINTS:
- Never delete files without explicit permission
- Never deploy without explicit instruction
- Work in worktrees, not directly on main
- SKS Technologies and EQ Solutions are separate entities — no credential mixing
- The Supabase for eq-canonical is the tenant data plane (accessed via getTenantDataClientById). The Supabase for sks-nsw-labour uses AUDIT_SB_URL + AUDIT_SB_KEY env vars.

Start by reading `netlify/functions/ai-briefing.ts` and `src/pages/TenantHome.tsx` to understand the current state, then audit canonical_events to map which payload fields are missing.
```

---

## Definition of done (full sprint)

- [ ] Every event type has a paired close event
- [ ] Event payloads consistently include name, reference, site_name where applicable
- [ ] SKS pipeline stage changes emit canonical events
- [ ] Brief cached per-user, invalidated on new canonical event
- [ ] Data coverage shown below brief ("Based on X of Y apps")
- [ ] Pipeline config is per-tenant, not a global env var
- [ ] Entity names in brief are tappable links to source records
- [ ] Actions panel renders cleanly at 375px
- [ ] Action cards link to source app
- [ ] Dismissed actions don't reappear
- [ ] Actioned items passed back as context in subsequent brief
- [ ] Brief tested with Royce logged in as OPS at SKS — actions ranked correctly for role
