// EntityImportPanel — Sprint S1.6.
//
// One ParserDropZone per canonical entity. Wires the commit function
// through the per-domain RPC by:
//   1. INSERTing a shell_control.eq_intake_events row (the intake header)
//   2. Calling eq_intake_commit_batch with the resulting intake_id
//
// Schemas are statically imported per entity for the Core domain (customer,
// contact, site). Adding domains = add to the schemas + entities maps.

import { useMemo } from 'react';
import { ParserDropZone, type CommitFn, type CommittableRow } from '@eq/confirm-ui';
import { createSupabaseClient } from '../../lib/supabaseJwt';
import { useSession } from '../../session';

// Static schema imports — Core domain (3 entities, S1.6 scope).
// Quotes + Field + Cards + Service domains: extend this map (S2 follow-up).
// JSON imports need vite-json plugin (default in Vite).
import customerSchema from '@eq/schemas/schemas/customer.schema.json';
import contactSchema from '@eq/schemas/schemas/contact.schema.json';
import siteSchema from '@eq/schemas/schemas/site.schema.json';

// Map entity-singular (registry-canonical name) → JSON schema + plural table name
const ENTITY_MAP: Record<string, { schema: Record<string, unknown>; table: string }> = {
  customer: { schema: customerSchema as Record<string, unknown>, table: 'customers' },
  contact: { schema: contactSchema as Record<string, unknown>, table: 'contacts' },
  site: { schema: siteSchema as Record<string, unknown>, table: 'sites' },
};

interface EntityImportPanelProps {
  entity: string; // registry-canonical singular name
  onClose?: () => void;
}

export function EntityImportPanel({ entity, onClose }: EntityImportPanelProps) {
  const { session } = useSession();

  const mapEntry = ENTITY_MAP[entity];

  const config = useMemo(() => {
    if (!session || !mapEntry) return null;
    return {
      schema: mapEntry.schema,
      tenantId: session.tenant.id,
      commit: makeCommitFn(mapEntry.table, session.tenant.id, entity),
    };
  }, [session, entity, mapEntry]);

  if (!session) {
    return <div className="eq-loading">Loading session…</div>;
  }

  if (!mapEntry) {
    return (
      <div className="eq-coming-soon">
        <h3>Import for "{entity}"</h3>
        <p>
          Schema not yet wired for this entity. Core domain entities (customer,
          contact, site) are wired in Sprint S1.6; the rest land in S2.
        </p>
        {onClose && (
          <button type="button" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    );
  }

  if (!config) {
    return <div className="eq-loading">Initialising…</div>;
  }

  const properties = mapEntry.schema.properties as Record<string, unknown>;
  const canonicalFields = Object.keys(properties ?? {});

  return (
    <div className="entity-import-panel">
      <header className="entity-import-panel__header">
        <h3>Import {entity}</h3>
        {onClose && (
          <button type="button" className="entity-import-panel__close" onClick={onClose}>
            Close
          </button>
        )}
      </header>
      <ParserDropZone config={config} canonicalFields={canonicalFields} />
    </div>
  );
}

/**
 * Builds a CommitFn that:
 *   1. Creates a shell_control.eq_intake_events row (the intake header)
 *   2. Calls eq_intake_commit_batch RPC with the resulting intake_id
 *   3. Returns { committed, failed } for the dropzone status display
 */
function makeCommitFn(table: string, tenantId: string, entity: string): CommitFn {
  return async (rows: CommittableRow[]) => {
    const sb = await createSupabaseClient();

    // Step 1: create eq_intake_events row.
    // We use the .schema('shell_control') accessor now that PostgREST exposes
    // shell_control (S1.1 toggled this on).
    const intakePayload = {
      tenant_id: tenantId,
      entity,
      source_kind: 'manual',
      source_subkind: 'shell-dropzone',
      source_filename: `shell-${entity}-${new Date().toISOString().slice(0, 19)}.csv`,
      schema_version: '1.0.0',
      status: 'committing',
      import_mode: 'insert',
      source_app: 'shell',
      intake_mode: 'strict',
      created_by: undefined,
    };

    const { data: intakeRow, error: intakeErr } = await sb
      .schema('shell_control')
      .from('eq_intake_events')
      .insert(intakePayload)
      .select('intake_id')
      .single();

    if (intakeErr || !intakeRow) {
      throw new Error(
        `Could not create intake event: ${intakeErr?.message ?? 'no row returned'}`,
      );
    }

    const intakeId = (intakeRow as { intake_id: string }).intake_id;

    // Step 2: commit the rows via the router RPC.
    const rowsJsonb = rows.map((r) => r.canonical);

    const { data: commitResult, error: commitErr } = await sb.rpc('eq_intake_commit_batch', {
      p_intake_id: intakeId,
      p_tenant_id: tenantId,
      p_table: table,
      p_rows: rowsJsonb,
      p_confirm_replace: false,
      p_intake_mode: 'strict',
    });

    if (commitErr) {
      // Mark the intake event as errored so future runs show what happened
      await sb
        .schema('shell_control')
        .from('eq_intake_events')
        .update({ status: 'failed', error_message: commitErr.message })
        .eq('intake_id', intakeId);
      throw new Error(`Commit failed: ${commitErr.message}`);
    }

    const result = Array.isArray(commitResult) ? commitResult[0] : commitResult;
    const committed = result?.committed_count ?? 0;
    const failed = rows.length - committed;

    // Mark intake event complete
    await sb
      .schema('shell_control')
      .from('eq_intake_events')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
      })
      .eq('intake_id', intakeId);

    return { committed, failed };
  };
}
