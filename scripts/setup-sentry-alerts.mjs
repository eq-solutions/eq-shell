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
// eq-solutions org is on Sentry's EU/DE region — use de.sentry.io, not sentry.io.
const BASE_URL     = 'https://de.sentry.io/api/0';

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

// Shared action: notify IssueOwners, fall through to ActiveMembers.
// targetIdentifier must be empty string for IssueOwners target type.
const NOTIFY_ACTION = {
  id: 'sentry.mail.actions.NotifyEmailAction',
  targetType: 'IssueOwners',
  fallthroughType: 'ActiveMembers',
  targetIdentifier: '',
};

const ISSUE_ALERT_RULES = [
  {
    name: '[eq-shell] 5xx error spike',
    environment: 'production',
    // ≥10 errors in 1h. All Netlify function errors that reach Sentry
    // (via withSentry) count. No status-code filter — tag filter operators
    // in the Sentry API don't support gte; using a volume threshold instead.
    conditions: [
      {
        id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
        value: 10,
        comparisonType: 'count',
        interval: '1h',
      },
    ],
    filters: [],
    actions: [NOTIFY_ACTION],
    actionMatch: 'all',
    filterMatch: 'all',
    frequency: 60,
  },
  {
    name: '[eq-shell] Auth failure spike',
    environment: 'production',
    // ≥10 events in 15 min whose message contains "not_signed_in" or
    // "unauthorized" — indicates a broken auth flow at volume.
    conditions: [
      {
        id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
        value: 10,
        comparisonType: 'count',
        interval: '15m',
      },
    ],
    filters: [
      {
        id: 'sentry.rules.filters.event_attribute.EventAttributeFilter',
        attribute: 'message',
        match: 'co',
        value: 'not_signed_in',
      },
    ],
    actions: [NOTIFY_ACTION],
    actionMatch: 'all',
    filterMatch: 'all',
    frequency: 30,
  },
  {
    name: '[eq-shell] RLS / permission denied',
    environment: 'production',
    // First occurrence OR regression of any event whose message contains
    // "permission denied". These should never reach Sentry in prod —
    // RLS policies return empty, not throw. Fires as soon as one appears.
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
    actions: [NOTIFY_ACTION],
    actionMatch: 'any',
    filterMatch: 'all',
    frequency: 15,
  },
  {
    name: '[eq-shell] JWT / token mint failure',
    environment: 'production',
    // ≥3 events containing "mint" in 5 min — Cards/Field iframe loads
    // break when the mint function fails at volume.
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
    actions: [NOTIFY_ACTION],
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
