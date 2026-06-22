#!/usr/bin/env node
// scripts/create-sentry-alerts.mjs
//
// E3 — Create Sentry issue-alert rules for the EQ Shell auth seams.
//
// Idempotent: checks existing rules by name and skips any that already exist.
// Run once after initial setup; re-run safely at any time to add gaps.
//
// Required env:
//   SENTRY_AUTH_TOKEN  — Sentry API token with project:write scope
//                        (create at https://eq-solutions.sentry.io/settings/auth-tokens/)
//
// Usage:
//   SENTRY_AUTH_TOKEN=sntrys_xxx node scripts/create-sentry-alerts.mjs
//
// What gets created:
//   4 issue-alert rules on the `eq-shell` Sentry project, one per auth seam:
//     [auth] Login seam errors
//     [auth] Token-exchange seam errors
//     [auth] Session verify seam errors
//     [auth] PIN reset seam errors
//
//   Each rule:
//     • Fires when a new issue is first seen OR a resolved issue regresses
//     • Filters to `production` environment only
//     • Scopes to the specific Netlify function names via `netlify_function` tag
//     • Notifies the `eq-solutions` Sentry team (→ dev@eq.solutions)
//     • 30-minute re-alert window per issue (avoids spam on persistent errors)

const ORG_SLUG    = 'eq-solutions';
const PROJECT_SLUG = 'eq-shell';
// Team numeric ID for "eq-solutions" (slug: eq-solutions).
// Resolved via Sentry MCP: find_teams(organizationSlug='eq-solutions') → ID 4511296908427344.
const TEAM_ID = '4511296908427344';

const AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error('ERROR: SENTRY_AUTH_TOKEN env var is not set.');
  console.error('  Get a token at: https://eq-solutions.sentry.io/settings/auth-tokens/');
  console.error('  Required scope: project:write');
  process.exit(1);
}

const BASE_URL = `https://sentry.io/api/0/projects/${ORG_SLUG}/${PROJECT_SLUG}/rules/`;

const headers = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  'Content-Type': 'application/json',
};

// ── Alert rule building blocks ─────────────────────────────────────────────

const NOTIFY_TEAM = {
  id: 'sentry.mail.actions.NotifyEmailAction',
  targetType: 'Team',
  targetIdentifier: TEAM_ID,
};

// Conditions: trigger when a brand-new issue appears, or a resolved one comes back.
const FIRST_SEEN = { id: 'sentry.rules.conditions.first_seen_event.FirstSeenEventCondition' };
const REGRESSION = { id: 'sentry.rules.conditions.regression_event.RegressionEventCondition' };

/** Tag filter: matches events whose `netlify_function` tag equals `value`. */
function fnTag(value) {
  return {
    id: 'sentry.rules.filters.tagged_event.TaggedEventFilter',
    key: 'netlify_function',
    match: 'is',
    value,
  };
}

// ── Rule definitions ───────────────────────────────────────────────────────

const RULES = [
  {
    name: '[auth] Login seam errors',
    // shell-login         — email+PIN login (main path)
    // shell-login-magic-link — magic link variant
    // shell-login-phone-otp  — phone OTP variant
    environment: 'production',
    actionMatch: 'any',   // fire if ANY condition triggers (first-seen OR regression)
    filterMatch: 'any',   // fire if ANY filter matches (OR across function names)
    actions:    [NOTIFY_TEAM],
    conditions: [FIRST_SEEN, REGRESSION],
    filters: [
      fnTag('shell-login'),
      fnTag('shell-login-magic-link'),
      fnTag('shell-login-phone-otp'),
    ],
    frequency: 30, // minutes between re-alerts for the same issue
  },

  {
    name: '[auth] Token-exchange seam errors',
    // token-exchange         — cross-app token exchange
    // mint-supabase-jwt      — mints tenant JWT for downstream services
    // mint-cards-iframe-token — Cards iframe mint
    // mint-quotes-iframe-token — Quotes iframe mint
    environment: 'production',
    actionMatch: 'any',
    filterMatch: 'any',
    actions:    [NOTIFY_TEAM],
    conditions: [FIRST_SEEN, REGRESSION],
    filters: [
      fnTag('token-exchange'),
      fnTag('mint-supabase-jwt'),
      fnTag('mint-cards-iframe-token'),
      fnTag('mint-quotes-iframe-token'),
    ],
    frequency: 30,
  },

  {
    name: '[auth] Session verify seam errors',
    // verify-shell-session — validates an existing session token
    // challenge-totp       — presents TOTP challenge
    // confirm-totp         — validates TOTP code
    // select-tenant        — switches active tenant on a session
    // switch-tenant        — alias (used by shell-v1 path)
    environment: 'production',
    actionMatch: 'any',
    filterMatch: 'any',
    actions:    [NOTIFY_TEAM],
    conditions: [FIRST_SEEN, REGRESSION],
    filters: [
      fnTag('verify-shell-session'),
      fnTag('challenge-totp'),
      fnTag('confirm-totp'),
      fnTag('select-tenant'),
      fnTag('switch-tenant'),
    ],
    frequency: 30,
  },

  {
    name: '[auth] PIN reset seam errors',
    // shell-request-pin-reset — user requests a PIN reset (sends email)
    // accept-pin-reset        — user lands on reset link and sets new PIN
    // reset-user-pin          — admin-side PIN reset
    environment: 'production',
    actionMatch: 'any',
    filterMatch: 'any',
    actions:    [NOTIFY_TEAM],
    conditions: [FIRST_SEEN, REGRESSION],
    filters: [
      fnTag('shell-request-pin-reset'),
      fnTag('accept-pin-reset'),
      fnTag('reset-user-pin'),
    ],
    frequency: 30,
  },
];

// ── Main ───────────────────────────────────────────────────────────────────

async function fetchExistingRules() {
  const res = await fetch(BASE_URL, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${BASE_URL} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function createRule(rule) {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(rule),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`POST failed for "${rule.name}": ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  console.log(`Fetching existing alert rules for ${ORG_SLUG}/${PROJECT_SLUG}…`);
  const existing = await fetchExistingRules();
  const existingNames = new Set(existing.map((r) => r.name));
  console.log(`  Found ${existing.length} existing rule(s).`);
  console.log();

  let created = 0;
  let skipped = 0;

  for (const rule of RULES) {
    if (existingNames.has(rule.name)) {
      console.log(`  skip  "${rule.name}" (already exists)`);
      skipped++;
      continue;
    }
    const created_rule = await createRule(rule);
    console.log(`  ✓ created  "${rule.name}"  id=${created_rule.id}`);
    created++;
  }

  console.log();
  console.log(`Done. Created ${created}, skipped ${skipped}.`);

  if (created > 0) {
    console.log();
    console.log('Review in Sentry:');
    console.log(`  https://eq-solutions.sentry.io/alerts/rules/?project=${PROJECT_SLUG}`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
