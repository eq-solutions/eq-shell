# Add a trial tenant to EQ Field

Runbook for wiring a new trial tenant into the shell's EQ Field surface.

**Current state of Field (2026-05-25):** EQ Field for trial customers is the shared `eq-solves-field.netlify.app` demo instance — it shows EQ's own seed data, not the trial tenant's data. Per-tenant Field data comes in F1-F3 (BLOCKED on prestart/toolbox unification, tracked in `docs/FIELD-UNIFICATION-PLAN.md`). Until F1 lands, trial tenants onboarded with `--modules=field` see the shared demo.

**Decision:** include Field in `--modules` for trial tenants that explicitly want to see the interface. Do NOT include it for trials where you haven't demoed the shared-demo caveat.

---

## When to add a new slug to Field

This is needed when:
- You're launching a new eq-solves-field **production instance** for a paying tenant (e.g. the way SKS NSW Labour has its own deploy).
- You want to pre-wire a trial slug for a future dedicated instance.

The shared `eq-solves-field.netlify.app` demo already serves slugs `eq`, `demo-trades`, and `melbourne` without any shell change. SKS has its own Netlify site. Any new paying tenant that gets a *dedicated* Field deploy needs the two file edits below.

---

## Two files to edit (always in the same PR)

### 1. `src/lib/fieldTenants.ts`

Defines the shell-side picker cards and URL routing.

```ts
// FIELD_TENANT_URLS — maps slug → Field Netlify URL.
// Shared demo instance: point to eq-solves-field.netlify.app
// Dedicated instance: point to the tenant's own Netlify site
export const FIELD_TENANT_URLS: Record<string, string> = {
  eq:           'https://eq-solves-field.netlify.app/',
  'demo-trades':'https://eq-solves-field.netlify.app/',
  melbourne:    'https://eq-solves-field.netlify.app/',
  sks:          'https://sks-nsw-labour.netlify.app/',
  acme:         'https://acme-field.netlify.app/',  // ← new tenant
};

// TENANT_OPTIONS — drives the picker UI for platform admins.
// Non-admin users only see the option matching their session tenant.
// tier: display-only label shown in the picker card.
export const TENANT_OPTIONS = [
  { slug: 'sks',          tier: 'Live',       name: 'SKS Technologies', tagline: '...' },
  { slug: 'eq',           tier: 'Standard',   name: 'EQ Demo',          tagline: '...' },
  { slug: 'demo-trades',  tier: 'Advanced',   name: 'Demo Trades',      tagline: '...' },
  { slug: 'melbourne',    tier: 'Enterprise', name: 'Melbourne',        tagline: '...' },
  { slug: 'acme',         tier: 'Trial',      name: 'Acme Electrical',  tagline: 'Trial — shared demo data until F1 lands.' },
] as const;
```

> **Note on visibility:** Non-platform-admin users only see picker options matching `session.tenant.slug`. A trial user on tenant `acme` will auto-select the `acme` option if it exists; if it doesn't, the picker shows no option and Field breaks. Always add the slug here before the trial user signs in.

### 2. `netlify/functions/mint-iframe-token.ts`

The server-side allow-list that validates the picker's choice. If the slug isn't on this list, the mint function rejects the request with `400 Invalid tenant_slug` and the iframe stays blank.

```ts
const ALLOWED_FIELD_TENANT_SLUGS = [
  'eq', 'demo-trades', 'melbourne', 'sks',
  'acme',  // ← new tenant
] as const;
```

---

## Full workflow

```bash
# 1. Create the branch
git checkout main && git pull
git checkout -b add-field-tenant/<slug>

# 2. Edit both files (see above)
#    - src/lib/fieldTenants.ts  → FIELD_TENANT_URLS + TENANT_OPTIONS
#    - netlify/functions/mint-iframe-token.ts → ALLOWED_FIELD_TENANT_SLUGS

# 3. Build + verify
pnpm run build  # must pass clean

# 4. Commit + push + open PR
git add src/lib/fieldTenants.ts netlify/functions/mint-iframe-token.ts
git commit -m "Field: add <slug> tenant to picker + token allow-list"
git push -u origin add-field-tenant/<slug>
gh pr create --title "Field: add <slug> to tenant picker" --body "..."

# 5. After merge: smoke the picker
#    Sign in as a platform admin at core.eq.solutions
#    Navigate to /<slug>/field — the new tenant card should appear in the picker
#    Click it — the Field iframe should load under the eq-solves-field.netlify.app instance
```

---

## Field-side requirements (for dedicated deploys only)

If the tenant gets their **own** Netlify Field instance (vs the shared demo):

1. **Deploy eq-solves-field to a new Netlify site** for the tenant.
2. **Set `EQ_SECRET_SALT`** on the new Netlify site — must match the value on eq-shell. This is the shared HMAC key for iframe handoff tokens. Rotating it on one site requires rotating it on all four (eq-shell, eq-solves-field, sks-nsw-labour, eq-solves-service).
3. **Verify the `/verify-pin?action=verify-shell-token` endpoint** works against the new instance. A shell-minted token should get back a 200 with a Field session.
4. **Point `FIELD_TENANT_URLS[slug]`** to the new Netlify site URL (step 1 above in `fieldTenants.ts`).

The shared demo (steps 1-3 already done) is the fastest path for trials.

---

## Per-tenant data (F1 — deferred)

Until `docs/FIELD-UNIFICATION-PLAN.md` F1 lands:
- All trial tenants on `eq-solves-field.netlify.app` see the **shared seed data**, not their own.
- The `canonical-api.ts` APP_TENANT_SCOPE for `field` is currently restricted to `['eq', 'sks', 'demo-trades', 'melbourne']`. When a trial tenant's slug is added there, Field's own data reads start hitting their per-tenant DB — but Field doesn't yet call `canonical-api` for data; it reads its own Supabase directly. F1 changes that.

**Do not expand `APP_TENANT_SCOPE['field']`** until F1 is wired — it would have no effect and just create a misleading allow-list.

---

## Related

- `src/lib/fieldTenants.ts` — single source of truth for shell-side config
- `netlify/functions/mint-iframe-token.ts` — server-side allow-list
- `docs/FIELD-UNIFICATION-PLAN.md` — F1-F3 roadmap and prestart/toolbox blockers
- `SECURITY-PATTERNS.md §9` — EQ_SECRET_SALT rotation rules
