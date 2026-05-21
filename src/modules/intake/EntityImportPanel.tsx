// EntityImportPanel — extended in S2 prep to cover all entities with
// authored JSON schemas in @eq/schemas (20 of 42 total).
//
// Wires the commit function through the per-domain RPC by:
//   1. INSERTing a shell_control.eq_intake_events row (the intake header)
//   2. Calling eq_intake_commit_batch with the resulting intake_id
//
// Entities missing from this map: 22 Field-domain entities whose JSON
// schemas weren't authored during Unit 5 (registry-only placeholders).
// Authoring those is a follow-up; entries here only require the JSON +
// table name once the schemas exist.

import { useMemo } from 'react';
import { ParserDropZone, type CommitFn, type CommittableRow } from '@eq/confirm-ui';
import { createSupabaseClient } from '../../lib/supabaseJwt';
import { useSession } from '../../session';

// --- Core domain (3) ---
import customerSchema from '@eq/schemas/schemas/customer.schema.json';
import contactSchema from '@eq/schemas/schemas/contact.schema.json';
import siteSchema from '@eq/schemas/schemas/site.schema.json';

// --- Cards domain (1) ---
import licenceSchema from '@eq/schemas/schemas/licence.schema.json';

// --- Service domain (1) ---
import assetSchema from '@eq/schemas/schemas/asset.schema.json';

// --- Quotes domain (7) ---
import quoteSchema from '@eq/schemas/schemas/quote.schema.json';
import quoteLineItemSchema from '@eq/schemas/schemas/quote-line-item.schema.json';
import quoteStatusHistorySchema from '@eq/schemas/schemas/quote-status-history.schema.json';
import quoteAttachmentSchema from '@eq/schemas/schemas/quote-attachment.schema.json';
import scopeTemplateSchema from '@eq/schemas/schemas/scope-template.schema.json';
import rateLibrarySchema from '@eq/schemas/schemas/rate-library.schema.json';
import quoteEmailOutboxSchema from '@eq/schemas/schemas/quote-email-outbox.schema.json';

// --- Field domain (8 — registry-canonical entities with JSON files) ---
import staffSchema from '@eq/schemas/schemas/staff.schema.json';
import scheduleSchema from '@eq/schemas/schemas/schedule.schema.json';
import prestartSchema from '@eq/schemas/schemas/prestart.schema.json';
import toolboxTalkSchema from '@eq/schemas/schemas/toolbox-talk.schema.json';
import swmsSchema from '@eq/schemas/schemas/swms.schema.json';
import jsaSchema from '@eq/schemas/schemas/jsa.schema.json';
import itpSchema from '@eq/schemas/schemas/itp.schema.json';
import incidentSchema from '@eq/schemas/schemas/incident.schema.json';

interface EntityMapEntry {
  schema: Record<string, unknown>;
  table: string;
}

// Singular registry entity name → JSON schema + plural app_data table name.
// Order: Core → Cards → Service → Quotes → Field (matches landing-page sequence).
const ENTITY_MAP: Record<string, EntityMapEntry> = {
  // Core
  customer: { schema: customerSchema as Record<string, unknown>, table: 'customers' },
  contact: { schema: contactSchema as Record<string, unknown>, table: 'contacts' },
  site: { schema: siteSchema as Record<string, unknown>, table: 'sites' },
  // Cards
  licence: { schema: licenceSchema as Record<string, unknown>, table: 'licences' },
  // Service
  asset: { schema: assetSchema as Record<string, unknown>, table: 'assets' },
  // Quotes
  quote: { schema: quoteSchema as Record<string, unknown>, table: 'quote' },
  quote_line_item: { schema: quoteLineItemSchema as Record<string, unknown>, table: 'quote_line_item' },
  quote_status_history: { schema: quoteStatusHistorySchema as Record<string, unknown>, table: 'quote_status_history' },
  quote_attachment: { schema: quoteAttachmentSchema as Record<string, unknown>, table: 'quote_attachment' },
  scope_template: { schema: scopeTemplateSchema as Record<string, unknown>, table: 'scope_template' },
  rate_library: { schema: rateLibrarySchema as Record<string, unknown>, table: 'rate_library' },
  quote_email_outbox: { schema: quoteEmailOutboxSchema as Record<string, unknown>, table: 'quote_email_outbox' },
  // Field (the 8 entities with authored JSON schemas)
  staff: { schema: staffSchema as Record<string, unknown>, table: 'staff' },
  schedule: { schema: scheduleSchema as Record<string, unknown>, table: 'schedule_entries' },
  prestart: { schema: prestartSchema as Record<string, unknown>, table: 'prestart_checks' },
  toolbox_talk: { schema: toolboxTalkSchema as Record<string, unknown>, table: 'toolbox_talks' },
  swms: { schema: swmsSchema as Record<string, unknown>, table: 'swms' },
  jsa: { schema: jsaSchema as Record<string, unknown>, table: 'jsa_records' },
  itp: { schema: itpSchema as Record<string, unknown>, table: 'itp_records' },
  incident: { schema: incidentSchema as Record<string, unknown>, table: 'incidents' },
};

export const WIRED_ENTITY_NAMES = Object.keys(ENTITY_MAP);

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
          JSON schema not yet authored in @eq/schemas. Registry-only
          placeholder. Add a schema file + an entry in ENTITY_MAP to wire.
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
