#!/usr/bin/env node
// Field schema-parity audit (Field unification F1, WS3).
//
// Compares table + column shapes across the four Supabase projects the Field
// cutover touches, and emits the unique-to-EQ / unique-to-SKS / drift lists that
// docs/FIELD-UNIFICATION-PLAN.md §"Current state" needs refreshed once Royce's
// Prestart/Toolbox port lands. Read-only: every query is SELECT against
// information_schema.
//
// WHY this is built before the port lands: the plan mandates a re-audit *after*
// the port, and pinpoints prestart_checks + toolbox_talks as the exact tables
// migration 0012 must cover. Having the audit ready means that re-audit is one
// command, and running it now gives a pre-port baseline to diff against.
//
// AUTH: uses the Supabase Management API (api.supabase.com) with a single
// personal access token — no per-project service-role keys needed. The token is
// read-only here (we only issue SELECTs). Get one at
// https://supabase.com/dashboard/account/tokens.
//
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/audit-field-schema-parity.mjs
//
// Override the default project refs with env vars if they ever change:
//   FIELD_EQ_LEGACY_REF, FIELD_SKS_LEGACY_REF, FIELD_EQ_PLANE_REF, FIELD_SKS_PLANE_REF

const PROJECTS = {
  'eq-field-legacy (ktmj)': process.env.FIELD_EQ_LEGACY_REF ?? 'ktmjmdzqrogauaevbktn',
  'sks-labour-legacy (nspbmir)': process.env.FIELD_SKS_LEGACY_REF ?? 'nspbmirochztcjijmcrx',
  'core-plane / eq-canonical-internal (zaap)': process.env.FIELD_EQ_PLANE_REF ?? 'zaapmfdkgedqupfjtchl',
  'sks-plane / sks-canonical (ehowg)': process.env.FIELD_SKS_PLANE_REF ?? 'ehowgjardagevnrluult',
};

// The schemas Field data lives in: legacy apps use `public`; the per-tenant
// data planes use `app_data`. We union both so the comparison is apples-to-apples.
const SCHEMAS = ['public', 'app_data'];

// Tables the plan flags as load-bearing for migration 0012 — reported in detail.
const FOCUS_TABLES = ['prestart_checks', 'toolbox_talks'];

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error(
    'ERROR: SUPABASE_ACCESS_TOKEN is required.\n' +
      'Get a personal access token at https://supabase.com/dashboard/account/tokens then:\n' +
      '  SUPABASE_ACCESS_TOKEN=sbp_... node scripts/audit-field-schema-parity.mjs',
  );
  process.exit(1);
}

async function runQuery(ref, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Management API ${res.status} for ${ref}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

const COLUMNS_SQL = `
  SELECT table_schema, table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = ANY (ARRAY[${SCHEMAS.map((s) => `'${s}'`).join(',')}])
  ORDER BY table_schema, table_name, ordinal_position;
`;

/** rows -> Map<"schema.table", Map<column, data_type>> */
function indexRows(rows) {
  const tables = new Map();
  for (const r of rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    if (!tables.has(key)) tables.set(key, new Map());
    tables.get(key).set(r.column_name, r.data_type);
  }
  return tables;
}

/** bare table name regardless of schema, for cross-schema comparison */
function bareName(qualified) {
  return qualified.split('.').slice(1).join('.');
}

async function main() {
  console.log('# Field schema-parity audit');
  console.log(`# ${new Date().toISOString()}`);
  console.log('');

  const indexed = {};
  for (const [label, ref] of Object.entries(PROJECTS)) {
    process.stderr.write(`Querying ${label} (${ref})… `);
    try {
      const rows = await runQuery(ref, COLUMNS_SQL);
      indexed[label] = indexRows(rows);
      process.stderr.write(`${indexed[label].size} tables\n`);
    } catch (e) {
      process.stderr.write(`FAILED\n`);
      console.log(`## ⚠ ${label}: ${e.message}`);
      indexed[label] = new Map();
    }
  }

  // Bare-table-name sets per project (schema-agnostic).
  const bareSets = {};
  for (const [label, tables] of Object.entries(indexed)) {
    bareSets[label] = new Set([...tables.keys()].map(bareName));
  }

  const labels = Object.keys(PROJECTS);
  const [eqLegacy, sksLegacy, eqPlane, sksPlane] = labels;

  console.log('## Table presence (bare name, any schema)');
  console.log('');
  console.log(`| table | ${labels.map((l) => l.split(' ')[0]).join(' | ')} |`);
  console.log(`|---|${labels.map(() => '---').join('|')}|`);
  const allTables = new Set();
  for (const s of Object.values(bareSets)) for (const t of s) allTables.add(t);
  for (const t of [...allTables].sort()) {
    const cells = labels.map((l) => (bareSets[l].has(t) ? '✓' : '·'));
    console.log(`| ${t} | ${cells.join(' | ')} |`);
  }
  console.log('');

  // Unique-to lists the plan's §"Current state" tables need.
  const onlyIn = (a, others) =>
    [...bareSets[a]].filter((t) => others.every((o) => !bareSets[o].has(t))).sort();

  console.log('## Unique-to lists (feeds the plan re-audit)');
  console.log('');
  console.log(`### Only in EQ Field legacy (${eqLegacy}), absent from SKS legacy`);
  console.log(onlyIn(eqLegacy, [sksLegacy]).map((t) => `- ${t}`).join('\n') || '- (none)');
  console.log('');
  console.log(`### Only in SKS legacy (${sksLegacy}), absent from EQ Field legacy`);
  console.log(onlyIn(sksLegacy, [eqLegacy]).map((t) => `- ${t}`).join('\n') || '- (none)');
  console.log('');
  console.log('### In a legacy app but NOT yet in its per-tenant data plane (0012 backlog)');
  const eqGap = [...bareSets[eqLegacy]].filter((t) => !bareSets[eqPlane].has(t)).sort();
  const sksGap = [...bareSets[sksLegacy]].filter((t) => !bareSets[sksPlane].has(t)).sort();
  console.log(`EQ legacy → core plane gap: ${eqGap.length ? eqGap.join(', ') : '(none)'}`);
  console.log(`SKS legacy → sks plane gap: ${sksGap.length ? sksGap.join(', ') : '(none)'}`);
  console.log('');

  // Focus tables — column-level diff (the exact 0012 input).
  console.log('## Focus tables — column diff (migration 0012 input)');
  for (const focus of FOCUS_TABLES) {
    console.log('');
    console.log(`### ${focus}`);
    const perProject = {};
    for (const label of labels) {
      // find the qualified key matching this bare name in this project
      const key = [...indexed[label].keys()].find((k) => bareName(k) === focus);
      perProject[label] = key ? indexed[label].get(key) : null;
    }
    const allCols = new Set();
    for (const cols of Object.values(perProject)) if (cols) for (const c of cols.keys()) allCols.add(c);
    if (allCols.size === 0) {
      console.log('_(table not present in any project)_');
      continue;
    }
    console.log(`| column | ${labels.map((l) => l.split(' ')[0]).join(' | ')} |`);
    console.log(`|---|${labels.map(() => '---').join('|')}|`);
    for (const c of [...allCols].sort()) {
      const cells = labels.map((l) => {
        const cols = perProject[l];
        if (!cols) return '·';
        return cols.has(c) ? cols.get(c) : '·';
      });
      console.log(`| ${c} | ${cells.join(' | ')} |`);
    }
  }
  console.log('');
  console.log('## Next');
  console.log('- Re-run AFTER the EQ→SKS Prestart/Toolbox port lands.');
  console.log('- Any column present in a legacy app but missing from its plane → add to 0012_field_enterprise_extras.sql.');
  console.log('- Refresh the plan §"Current state" unique-to lists from the table above.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
