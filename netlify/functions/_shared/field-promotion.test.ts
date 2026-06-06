// Behavioural tests for the Cards -> Field promotion state-flip — runs via
// `pnpm test` (node --test + tsx). Uses an in-memory fake of the narrow supabase-js
// surface applyFieldStatus relies on (.schema().from().update().eq().eq().eq()
// .select()), so the flip + tenant-scoping + notFound contract is verified without a
// live DB.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFieldStatus, refFromUrl } from './field-promotion.ts';

interface StaffRow { staff_id: string; tenant_id: string; active: boolean }

// Models exactly the chain applyFieldStatus makes: one UPDATE narrowed by three
// eq() filters, terminated by .select('staff_id'). Records the update payload and
// returns the rows that matched all filters.
function makeFakeClient(rows: StaffRow[]) {
  const captured: { schema?: string; table?: string; payload?: unknown; filters: Array<[string, unknown]> } = { filters: [] };

  const client = {
    schema(s: string) {
      captured.schema = s;
      return {
        from(table: string) {
          captured.table = table;
          const filters: Array<[string, unknown]> = [];
          const builder = {
            update(payload: unknown) { captured.payload = payload; return builder; },
            eq(col: string, val: unknown) { filters.push([col, val]); captured.filters = filters; return builder; },
            select(_cols: string) {
              const matched = rows.filter((r) => filters.every(([c, v]) => (r as any)[c] === v));
              return Promise.resolve({ data: matched.map((r) => ({ staff_id: r.staff_id })), error: null });
            },
          };
          return builder;
        },
      };
    },
  };

  return { client, captured };
}

test('promote flips field_status to active on the matching active row', async () => {
  const { client, captured } = makeFakeClient([
    { staff_id: 's1', tenant_id: 't1', active: true },
  ]);

  const res = await applyFieldStatus(client as any, 's1', 't1', 'active', 'u1');

  assert.deepEqual(res, { ok: true, notFound: false });
  assert.equal(captured.schema, 'app_data');
  assert.equal(captured.table, 'staff');
  assert.deepEqual(captured.payload, { field_status: 'active', updated_by: 'u1' });
  // Tenant + active scoping is the guard (service-role bypasses RLS).
  assert.deepEqual(captured.filters, [['staff_id', 's1'], ['tenant_id', 't1'], ['active', true]]);
});

test('reject flips field_status to rejected', async () => {
  const { client, captured } = makeFakeClient([
    { staff_id: 's1', tenant_id: 't1', active: true },
  ]);

  const res = await applyFieldStatus(client as any, 's1', 't1', 'rejected', 'u9');

  assert.deepEqual(res, { ok: true, notFound: false });
  assert.deepEqual(captured.payload, { field_status: 'rejected', updated_by: 'u9' });
});

test('notFound when the staff row belongs to another tenant', async () => {
  const { client } = makeFakeClient([
    { staff_id: 's1', tenant_id: 'OTHER', active: true },
  ]);

  const res = await applyFieldStatus(client as any, 's1', 't1', 'active', 'u1');

  assert.deepEqual(res, { ok: false, notFound: true });
});

test('notFound when the staff row is inactive (archived)', async () => {
  const { client } = makeFakeClient([
    { staff_id: 's1', tenant_id: 't1', active: false },
  ]);

  const res = await applyFieldStatus(client as any, 's1', 't1', 'active', 'u1');

  assert.deepEqual(res, { ok: false, notFound: true });
});

test('refFromUrl extracts the project ref, empty on garbage', () => {
  assert.equal(refFromUrl('https://ehowgjardagevnrluult.supabase.co'), 'ehowgjardagevnrluult');
  assert.equal(refFromUrl('https://zaapmfdkgedqupfjtchl.supabase.co/'), 'zaapmfdkgedqupfjtchl');
  assert.equal(refFromUrl('not a url'), '');
  assert.equal(refFromUrl(''), '');
});
