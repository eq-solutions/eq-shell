#!/usr/bin/env node
// scripts/setup-sentry-alerts.mjs
//
// Creates / upserts the four operational alert rules for eq-shell on
// Sentry. Idempotent: if a rule with the same name already exists it is
// deleted first, then re-created with the current definition.
//
// Prerequisites
//   SENTRY_AUTH_TOKEN — internal integration token from
//     https://eq-solutions.sentry.io/settings/auth-tokens/
//     Scopes required: project:write, project:read, alerts:write, alerts:read
//
// Usage
//   SENTRY_AUTH_TOKEN=sntrys_xxx node scripts/setup-sentry-alerts.mjs
//   # or
//   export SENTRY_AUTH_TOKEN=sntrys_xxx
//   node scripts/setup-sentry-alerts.mjs

const ORG_SLUG     = 'eq-solutions';
const PROJECT_SLUG = 'eq-shell';
const NOTIFY_EMAIL = 'dev@eq.solutions';
const BASE_URL     = 'https://sentry.io/api/0';

const AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error('ERROR: SENTRY_AUTH_TOKEN not set.');
  console.error('Get one from https://eq-solutions.sentry.io/settings/auth-tokens/');
  console.error('Scopes: project:write, project:read, alerts:write, alerts:read');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  'Content-Type': 'application/json',
};

async function sentry(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sentry ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

// ─── Alert rule definitions ─────────────────────────────────────────────────

// Issue-level alert rules fire when an individual error event matches a
// set of filters. Sentry's "issue alert" model — not metric alerts.
//
// The `actions` block sends a notification email to dev@eq.solutions.
// Replace `targetIdentifier` with the integer ID of the team/user in
// your Sentry org if the email action 422s (Sentry doesn't auto-create
// the recipient by address for all account types).

const ISSUE_ALERT_RULES = [
  {
    name: '[eq-shell] 5xx error spike',
    environment: 'production',
    // Fires when ANY error with a 5xx HTTP status tag is seen. This
    // catches both browser-side Sentry captures (Sentry.captureMessage)
    // and any exception propagating out of a Netlify function that
    // withSentry wraps. For rate-based gating see conditions below.
    conditions: [
      {
        id: 'sentry.rules.conditions.first_seen_event.FirstSeenEventCondition',
      },
      {
        id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
        value: 5,
        comparisonType: 'count',
        interval: '1h',
      },
    ],
    filters: [
      {
        id: 'sentry.rules.filters.tagged_event.TaggedEventFilter',
        key: 'http.status_code',
        match: 'gte',
        value: '500',
      },
    ],
    actions: [
      {
        id: 'sentry.mail.actions.NotifyEmailAction',
        targetType: 'Member',
        targetIdentifier: NOTIFY_EMAIL,
      },
    ],
    actionMatch: 'all',
    filterMatch: 'all',
    frequency: 60,
  },
  {
    name: '[eq-shell] Auth failure spike',
    environment: 'production',
    // Fires when shell-login, verify-shell-session, or any auth surface
    // returns not_signed_in / unauthorized / jwt_missing_tenant_or_user
    // at volume — indicates a broken auth flow, not just a stale session.
    conditions: [
      {
        id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
        value: 10,
        comparisonType: 'count',
        interval: '10m',
      },
    ],
    filters: [
      {
        id: 'sentry.rules.filters.tagged_event.TaggedEventFilter',
        key: 'logger',
        match: 'eq',
        value: 'auth',
      },
    ],
    actions: [
      {
        id: 'sentry.mail.actions.NotifyEmailAction',
        targetType: 'Member',
        targetIdentifier: NOTIFY_EMAIL,
      },
    ],
    actionMatch: 'all',
    filterMatch: 'any',
    frequency: 30,
  },
  {
    name: '[eq-shell] RLS / permission denied',
    environment: 'production',
    // Fires on any event whose message contains Postgres RLS-error strings.
    // These should never happen in prod — every RLS policy was written to
    // return empty, not throw. If one fires, a policy is mis-wired.
    conditions: [
      {
        id: 'sentry.rules.conditions.first_seen_event.FirstSeenEventCondition',
      },
      {
        id: 'sentry.rules.conditions.regression_event.RegressionEventCondition',
      },
    ],
    filters: [
      {
        id: 'sentry.rules.filters.event_attribute.EventAttributeFilter',
        attribute: 'message',
        match: 'co',
        value: 'permission denied',
      },
    ],
    actions: [
      {
        id: 'sentry.mail.actions.NotifyEmailAction',
        targetType: 'Member',
        targetIdentifier: NOTIFY_EMAIL,
      },
    ],
    actionMatch: 'any',
    filterMatch: 'all',
    frequency: 15,
  },
  {
    name: '[eq-shell] JWT / token mint failure',
    environment: 'production',
    // Fires when mint-supabase-jwt, mint-cards-iframe-token, or any other
    // token mint function fails. Sentry.captureMessage is called in each
    // mint function on non-2xx; this rule escalates recurrences to email.
    conditions: [
      {
        id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
        value: 3,
        comparisonType: 'count',
        interval: '5m',
      },
    ],
    filters: [
      {
        id: 'sentry.rules.filters.event_attribute.EventAttributeFilter',
        attribute: 'message',
        match: 'co',
        value: 'mint',
      },
    ],
    actions: [
      {
        id: 'sentry.mail.actions.NotifyEmailAction',
        targetType: 'Member',
        targetIdentifier: NOTIFY_EMAIL,
      },
    ],
    actionMatch: 'all',
    filterMatch: 'all',
    frequency: 15,
  },
];

// ─── Apply ──────────────────────────────────────────────────────────────────

async function getExistingRules() {
  return sentry('GET', `/projects/${ORG_SLUG}/${PROJECT_SLUG}/rules/`);
}

async function deleteRule(ruleId) {
  await sentry('DELETE', `/projects/${ORG_SLUG}/${PROJECT_SLUG}/rules/${ruleId}/`);
}

async function createRule(rule) {
  return sentry('POST', `/projects/${ORG_SLUG}/${PROJECT_SLUG}/rules/`, rule);
}

(async () => {
  console.log(`\nConfiguring Sentry alert rules for ${ORG_SLUG}/${PROJECT_SLUG}…\n`);

  let existing;
  try {
    existing = await getExistingRules();
  } catch (e) {
    console.error('Failed to fetch existing rules:', e.message);
    process.exit(1);
  }

  const existingByName = Object.fromEntries(existing.map((r) => [r.name, r]));

  for (const rule of ISSUE_ALERT_RULES) {
    // Delete existing rule with the same name before re-creating.
    const prior = existingByName[rule.name];
    if (prior) {
      try {
        await deleteRule(prior.id);
        console.log(`  ✓ deleted existing rule "${rule.name}" (id ${prior.id})`);
      } catch (e) {
        console.error(`  ✗ could not delete "${rule.name}":`, e.message);
      }
    }

    try {
      const created = await createRule(rule);
      console.log(`  ✓ created rule "${created.name}" (id ${created.id})`);
    } catch (e) {
      console.error(`  ✗ failed to create "${rule.name}":`, e.message);
      // Log the body that was sent to help debug.
      console.error('    Rule body:', JSON.stringify(rule, null, 2));
    }
  }

  console.log('\nDone. Verify at:');
  console.log(`  https://eq-solutions.sentry.io/alerts/rules/?project=${PROJECT_SLUG}`);
})();
