import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBatchHealth, type QueryExisting } from './intake-health.ts';

// A fixed clock so "expired" checks are deterministic.
const NOW = new Date('2026-06-14T00:00:00Z');

/** Fake lookup: returns the supplied existing rows whose column is in values. */
function fakeLookup(existing: Record<string, unknown>[]): QueryExisting {
  return async (_table, column, values) => {
    const set = new Set(values.map((v) => String(v)));
    return existing.filter((e) => set.has(String(e[column])));
  };
}

const noExisting: QueryExisting = async () => [];

test('clean licence row scores 1.0 with no flags or conflicts', async () => {
  const rows = [
    {
      licence_number: 'EWP-1',
      licence_type: 'ewp',
      staff_id: 's1',
      issue_date: '2026-01-01',
      expiry_date: '2027-01-01',
    },
  ];
  const out = await computeBatchHealth('licences', rows, 'append', noExisting, NOW);
  assert.equal(out.rows[0].row_health, 1);
  assert.equal(out.rows[0].health_flags.length, 0);
  assert.equal(out.rows[0].conflicts.length, 0);
  assert.equal(out.score, 100);
  assert.equal(out.conflict_count, 0);
  assert.equal(out.flagged_count, 0);
});

test('duplicate licence_number in append mode is a duplicate conflict', async () => {
  const rows = [{ licence_number: 'EWP-1', licence_type: 'ewp', staff_id: 's1', expiry_date: '2027-01-01' }];
  const lookup = fakeLookup([{ licence_id: 'existing-1', licence_number: 'EWP-1', licence_type: 'ewp' }]);
  const out = await computeBatchHealth('licences', rows, 'append', lookup, NOW);
  assert.equal(out.rows[0].conflicts.length, 1);
  assert.equal(out.rows[0].conflicts[0].type, 'duplicate');
  assert.equal(out.rows[0].conflicts[0].match_id, 'existing-1');
  assert.deepEqual(out.rows[0].conflicts[0].on, ['licence_number']);
  assert.equal(out.conflict_count, 1);
  assert.ok(out.rows[0].row_health < 1);
});

test('same match in upsert mode is an update, not a duplicate', async () => {
  const rows = [{ licence_number: 'EWP-1', licence_type: 'ewp', staff_id: 's1', expiry_date: '2027-01-01' }];
  const lookup = fakeLookup([{ licence_id: 'existing-1', licence_number: 'EWP-1', licence_type: 'ewp' }]);
  const out = await computeBatchHealth('licences', rows, 'upsert', lookup, NOW);
  assert.equal(out.rows[0].conflicts[0].type, 'update');
});

test('expiry before issue is an error flag', async () => {
  const rows = [
    { licence_number: 'EWP-2', licence_type: 'ewp', staff_id: 's1', issue_date: '2027-01-01', expiry_date: '2026-01-01' },
  ];
  const out = await computeBatchHealth('licences', rows, 'append', noExisting, NOW);
  const err = out.rows[0].health_flags.find((f) => f.severity === 'error');
  assert.ok(err, 'expected an error flag');
  assert.equal(err!.field, 'expiry_date');
});

test('already-expired licence is a warning flag (date-relative to injected clock)', async () => {
  const rows = [{ licence_number: 'EWP-3', licence_type: 'ewp', staff_id: 's1', expiry_date: '2026-01-01' }];
  const out = await computeBatchHealth('licences', rows, 'append', noExisting, NOW);
  const warn = out.rows[0].health_flags.find((f) => f.severity === 'warning');
  assert.ok(warn, 'expected an expired warning');
});

test('missing recommended field is an info flag', async () => {
  const rows = [{ licence_number: 'EWP-4', licence_type: 'ewp', staff_id: 's1' /* no expiry_date */ }];
  const out = await computeBatchHealth('licences', rows, 'append', noExisting, NOW);
  const info = out.rows[0].health_flags.find((f) => f.severity === 'info' && f.field === 'expiry_date');
  assert.ok(info, 'expected info flag for missing expiry_date');
});

test('staff end_date before start_date is an error', async () => {
  const rows = [
    { email: 'a@b.com', first_name: 'A', last_name: 'B', employment_type: 'full_time', trade: 'electrician', start_date: '2026-06-01', end_date: '2026-05-01' },
  ];
  const out = await computeBatchHealth('staff', rows, 'append', noExisting, NOW);
  assert.ok(out.rows[0].health_flags.some((f) => f.severity === 'error' && f.field === 'end_date'));
});

test('unknown table degrades gracefully to a clean result', async () => {
  const rows = [{ anything: 'goes', here: 1 }];
  const out = await computeBatchHealth('toolbox_talks', rows, 'append', noExisting, NOW);
  assert.equal(out.rows[0].row_health, 1);
  assert.equal(out.rows[0].health_flags.length, 0);
  assert.equal(out.score, 100);
});

test('batch score is the mean of row healths × 100', async () => {
  const rows = [
    { licence_number: 'A', licence_type: 'ewp', staff_id: 's1', expiry_date: '2027-01-01' }, // clean → 1.0
    { licence_number: 'B', licence_type: 'ewp', staff_id: 's1' /* missing expiry */ },        // info -0.05 → 0.95
  ];
  const out = await computeBatchHealth('licences', rows, 'append', noExisting, NOW);
  assert.equal(out.rows[0].row_health, 1);
  assert.equal(out.rows[1].row_health, 0.95);
  assert.equal(out.score, 98); // round((1 + 0.95)/2 * 100) = 98 (97.5 → 98)
  assert.equal(out.flagged_count, 1);
});
