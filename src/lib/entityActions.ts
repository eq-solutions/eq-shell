// Thin wrappers around the entity-actions and entity-patch Netlify functions.
// Used by bulk-action handlers in Table instances across the shell.

export type CrmEntity = 'customer' | 'site' | 'contact' | 'asset';
export type EntityActionType = 'archive' | 'unarchive' | 'delete';

async function postJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { ok: boolean; error?: string; detail?: string };
  if (!res.ok || !json.ok) throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
}

/** Archive or hard-delete one CRM / asset entity record. */
export async function entityAction(
  entity: CrmEntity,
  id: string,
  action: EntityActionType,
): Promise<void> {
  return postJson('/.netlify/functions/entity-actions', { entity, id, action });
}

/** Archive or hard-delete multiple records in parallel. Rejects if any fail. */
export async function entityActions(
  entity: CrmEntity,
  ids: string[],
  action: EntityActionType,
): Promise<void> {
  await Promise.all(ids.map((id) => entityAction(entity, id, action)));
}

/** Soft-archive staff members by setting active = false via entity-patch. */
export async function archiveStaff(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id) =>
      postJson('/.netlify/functions/entity-patch', {
        entity: 'staff',
        id,
        fields: { active: false },
      }),
    ),
  );
}
