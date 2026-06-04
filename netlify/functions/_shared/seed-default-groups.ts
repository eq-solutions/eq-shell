// Seed a freshly created tenant with the canonical default security groups.
//
// A fresh tenant starts with ZERO security groups; this gives managers a useful
// starting point — the cross-cutting templates from @eq-solutions/roles. Each
// group is created as a system template (created_by NULL); managers assign the
// actual members later. We deliberately do NOT touch user_security_groups.
//
// Idempotent: safe to re-run. Groups are matched by their unique
// (tenant_id, name) and perms by their (group_id, perm_key) primary key, so a
// repeat call inserts nothing and never throws on duplicates.

import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_GROUPS } from './default-groups.js';

// Expects a shell_control-scoped service client (see getServiceClient()).
export async function seedDefaultGroups(
  sb: SupabaseClient<any, any, any>,
  tenantId: string,
): Promise<void> {
  for (const group of DEFAULT_GROUPS) {
    // Insert the group template; skip silently if it already exists for this
    // tenant (INSERT ... ON CONFLICT (tenant_id, name) DO NOTHING).
    const { error: groupErr } = await sb
      .from('security_groups')
      .upsert(
        { tenant_id: tenantId, name: group.name, description: group.description, created_by: null },
        { onConflict: 'tenant_id,name', ignoreDuplicates: true },
      );
    if (groupErr) throw new Error(`seed group "${group.name}": ${groupErr.message}`);

    // ignoreDuplicates returns no row on conflict, so re-fetch the id by its
    // unique (tenant_id, name) — works whether we just inserted it or it existed.
    const { data: row, error: idErr } = await sb
      .from('security_groups')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', group.name)
      .single<{ id: string }>();
    if (idErr || !row) {
      throw new Error(`resolve group id "${group.name}": ${idErr?.message ?? 'not found'}`);
    }

    if (group.perms.length === 0) continue;
    const permRows = group.perms.map((perm_key) => ({ group_id: row.id, perm_key }));
    const { error: permErr } = await sb
      .from('security_group_perms')
      .upsert(permRows, { onConflict: 'group_id,perm_key', ignoreDuplicates: true });
    if (permErr) throw new Error(`seed perms for "${group.name}": ${permErr.message}`);
  }
}
