// Behavioural tests for seedDefaultGroups — runs via `pnpm test`
// (node --test + tsx). Uses an in-memory fake of the narrow supabase-js surface
// the seed relies on (upsert with ignoreDuplicates, select/eq/single), so the
// idempotency + "exactly the templates" contract is verified without a live DB.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedDefaultGroups } from './seed-default-groups.ts';
import { DEFAULT_GROUPS } from './default-groups.ts';

interface GroupRow { id: string; tenant_id: string; name: string; description: string | null; created_by: string | null }
interface PermRow { group_id: string; perm_key: string }

// Minimal in-memory stand-in for the two tables the seed writes. Models the
// exact chain calls seedDefaultGroups makes and nothing more.
function makeFakeClient() {
  const groups: GroupRow[] = [];
  const perms: PermRow[] = [];
  let idSeq = 0;

  function from(table: string) {
    if (table === 'security_groups') {
      return {
        upsert(row: Omit<GroupRow, 'id'>, opts: { onConflict: string; ignoreDuplicates: boolean }) {
          assert.equal(opts.onConflict, 'tenant_id,name');
          assert.equal(opts.ignoreDuplicates, true);
          const exists = groups.some((g) => g.tenant_id === row.tenant_id && g.name === row.name);
          if (!exists) groups.push({ id: `g${++idSeq}`, ...row });
          return Promise.resolve({ data: null, error: null });
        },
        select(_cols: string) {
          const filters: Array<[string, unknown]> = [];
          const builder = {
            eq(col: string, val: unknown) { filters.push([col, val]); return builder; },
            single<T>() {
              const match = groups.find((g) => filters.every(([c, v]) => (g as any)[c] === v));
              return Promise.resolve(
                match ? { data: { id: match.id } as T, error: null } : { data: null, error: { message: 'not found' } },
              );
            },
          };
          return builder;
        },
      };
    }
    if (table === 'security_group_perms') {
      return {
        upsert(rows: PermRow[], opts: { onConflict: string; ignoreDuplicates: boolean }) {
          assert.equal(opts.onConflict, 'group_id,perm_key');
          assert.equal(opts.ignoreDuplicates, true);
          for (const r of rows) {
            const dup = perms.some((p) => p.group_id === r.group_id && p.perm_key === r.perm_key);
            if (!dup) perms.push(r);
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    throw new Error(`unexpected table: ${table}`);
  }

  return { client: { from } as any, groups, perms };
}

test('seeds exactly the default group templates with their perms', async () => {
  const { client, groups, perms } = makeFakeClient();
  await seedDefaultGroups(client, 'tenant-1');

  // Exactly the DEFAULT_GROUPS, by name, for this tenant — system-seeded.
  assert.equal(groups.length, DEFAULT_GROUPS.length);
  assert.deepEqual(
    groups.map((g) => g.name).sort(),
    DEFAULT_GROUPS.map((g) => g.name).sort(),
  );
  for (const g of groups) {
    assert.equal(g.tenant_id, 'tenant-1');
    assert.equal(g.created_by, null, 'seeded groups must be system templates (created_by null)');
  }

  // Each group's perm rows match its template exactly.
  for (const tmpl of DEFAULT_GROUPS) {
    const row = groups.find((g) => g.name === tmpl.name)!;
    const got = perms.filter((p) => p.group_id === row.id).map((p) => p.perm_key).sort();
    assert.deepEqual(got, [...tmpl.perms].sort(), `perms for "${tmpl.name}"`);
  }
});

test('re-seeding the same tenant is a no-op', async () => {
  const { client, groups, perms } = makeFakeClient();
  await seedDefaultGroups(client, 'tenant-1');
  const groupsAfterFirst = groups.length;
  const permsAfterFirst = perms.length;

  await seedDefaultGroups(client, 'tenant-1');

  assert.equal(groups.length, groupsAfterFirst, 'no duplicate groups on re-seed');
  assert.equal(perms.length, permsAfterFirst, 'no duplicate perm rows on re-seed');
});

test('seeds independently per tenant', async () => {
  const { client, groups } = makeFakeClient();
  await seedDefaultGroups(client, 'tenant-1');
  await seedDefaultGroups(client, 'tenant-2');

  assert.equal(groups.filter((g) => g.tenant_id === 'tenant-1').length, DEFAULT_GROUPS.length);
  assert.equal(groups.filter((g) => g.tenant_id === 'tenant-2').length, DEFAULT_GROUPS.length);
});
