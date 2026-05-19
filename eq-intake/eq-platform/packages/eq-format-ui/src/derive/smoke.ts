/**
 * Smoke test for the derive module. Not part of the test suite — just a
 * tsx-runnable script that confirms the BOM profile produces output
 * matching the SimPRO demo's bom.csv. Run from the package root:
 *
 *   pnpm tsx src/derive/smoke.ts
 *
 * Delete after item 4c lands and a real test exists.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCsv, derive, toCsv } from './index';

const DEMO_DIR = join(
  process.cwd(),
  '..',
  '..',
  '..',
  'demos',
  'simpro-quote-781',
);

const sourceText = await readFile(join(DEMO_DIR, 'source.csv'), 'utf8');
const { rows } = parseCsv(sourceText);
console.log(`[smoke] parsed ${rows.length} rows from source.csv`);

async function checkProfile(profileId: string, fixtureFile: string): Promise<void> {
  const out = derive(profileId, rows as unknown as Record<string, unknown>[]);
  console.log(
    `[smoke] ${profileId}: ${out.rows.length} rows, ${out.columns.length} columns`,
  );

  const liveCsv = toCsv(out.columns, out.rows);
  const expectedCsv = await readFile(join(DEMO_DIR, fixtureFile), 'utf8');

  if (liveCsv === expectedCsv) {
    console.log(`[smoke] ✓ ${profileId} output matches demos/simpro-quote-781/${fixtureFile} exactly`);
    return;
  }

  console.error(`[smoke] ✗ ${profileId} output differs from ${fixtureFile}`);
  const liveLines = liveCsv.split('\n');
  const expectedLines = expectedCsv.split('\n');
  for (let i = 0; i < Math.max(liveLines.length, expectedLines.length); i++) {
    if (liveLines[i] !== expectedLines[i]) {
      console.error(`  line ${i + 1}:`);
      console.error(`    expected: ${JSON.stringify(expectedLines[i] ?? '<missing>')}`);
      console.error(`    actual:   ${JSON.stringify(liveLines[i] ?? '<missing>')}`);
      if (i > 5) break;
    }
  }
  process.exit(1);
}

await checkProfile('bom', 'bom.csv');
await checkProfile('device-register', 'knx-device-register.csv');
await checkProfile('labour-summary', 'labour-summary.csv');
