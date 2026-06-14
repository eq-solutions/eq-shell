// EntityImportPanel — lazy-loaded version.
//
// The previous version statically imported 20+ JSON schemas + @eq/confirm-ui
// (pdfjs ~1.6MB) at module load. That made /core/intake/{module} pages hang
// the renderer for 45+ seconds (audit-2026-05-21.md finding #1).
//
// This version:
//   - DomainLanding mounts → only the lightweight component shell loads (~few KB)
//   - User clicks "Import CSV" → schema + ParserDropZone are dynamic-imported
//     as their own chunks
//   - Per-entity schema chunks are emitted by Vite (each `import()` becomes
//     a separate chunk by default)

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { CommitFn, CommittableRow } from '@eq/confirm-ui';
import { createSupabaseClient } from '../../lib/supabaseJwt';
import { useSession } from '../../session';
import { friendlyError } from '../../lib/friendlyError';

// Lazy-load the @eq/confirm-ui ParserDropZone — pulls pdfjs + a lot of other
// weight. Only mounted once a user actually opens an import panel.
const ParserDropZone = lazy(() =>
  import('@eq/confirm-ui').then((m) => ({ default: m.ParserDropZone })),
);

// All entities with authored JSON schemas + their plural table names.
// This list drives `WIRED_ENTITY_NAMES` so DomainLanding knows which
// "Import CSV" buttons to enable without loading any schemas.
const ENTITY_TABLE_MAP: Record<string, string> = {
  // Core
  customer: 'customers',
  contact: 'contacts',
  site: 'sites',
  // Cards
  licence: 'licences',
  // Service
  asset: 'assets',
  // Quotes
  quote: 'quote',
  quote_line_item: 'quote_line_item',
  quote_status_history: 'quote_status_history',
  quote_attachment: 'quote_attachment',
  scope_template: 'scope_template',
  rate_library: 'rate_library',
  quote_email_outbox: 'quote_email_outbox',
  // Field — original 8
  staff: 'staff',
  schedule: 'schedule_entries',
  prestart: 'prestart_checks',
  toolbox_talk: 'toolbox_talks',
  swms: 'swms',
  jsa: 'jsa_records',
  itp: 'itp_records',
  incident: 'incidents',
  // Field — Sprint S2.A authored
  timesheet: 'timesheets',
  leave_request: 'leave_requests',
  leave_balance: 'leave_balances',
  checkin: 'checkins',
  tenant_app_config: 'tenant_app_configs',
  tender: 'tenders',
  tender_enrichment: 'tender_enrichments',
  tender_nomination: 'tender_nominations',
  tender_import_run: 'tender_import_runs',
  tender_review_decision: 'tender_review_decisions',
  site_diary: 'site_diaries',
  weekly_report: 'weekly_reports',
  apprentice_profile: 'apprentice_profiles',
  skills_rating: 'skills_ratings',
  feedback_entry: 'feedback_entries',
  rotation: 'rotations',
  buddy_checkin: 'buddy_checkins',
  quarterly_review: 'quarterly_reviews',
  engagement_log: 'engagement_logs',
  tafe_calendar: 'tafe_calendars',
  schedule_change_log: 'schedule_change_logs',
  leave_approval_log: 'leave_approval_logs',
};

export const WIRED_ENTITY_NAMES = Object.keys(ENTITY_TABLE_MAP);

/**
 * Dynamic-import a schema JSON by entity name. Each case becomes its own
 * Vite chunk — the user only pays the cost of the schema they're about
 * to import.
 *
 * Returns null if no schema file exists for the entity.
 */
async function loadEntitySchema(entity: string): Promise<Record<string, unknown> | null> {
  switch (entity) {
    // Core
    case 'customer': return (await import('@eq/schemas/schemas/customer.schema.json')).default as Record<string, unknown>;
    case 'contact': return (await import('@eq/schemas/schemas/contact.schema.json')).default as Record<string, unknown>;
    case 'site': return (await import('@eq/schemas/schemas/site.schema.json')).default as Record<string, unknown>;
    // Cards
    case 'licence': return (await import('@eq/schemas/schemas/licence.schema.json')).default as Record<string, unknown>;
    // Service
    case 'asset': return (await import('@eq/schemas/schemas/asset.schema.json')).default as Record<string, unknown>;
    // Quotes
    case 'quote': return (await import('@eq/schemas/schemas/quote.schema.json')).default as Record<string, unknown>;
    case 'quote_line_item': return (await import('@eq/schemas/schemas/quote-line-item.schema.json')).default as Record<string, unknown>;
    case 'quote_status_history': return (await import('@eq/schemas/schemas/quote-status-history.schema.json')).default as Record<string, unknown>;
    case 'quote_attachment': return (await import('@eq/schemas/schemas/quote-attachment.schema.json')).default as Record<string, unknown>;
    case 'scope_template': return (await import('@eq/schemas/schemas/scope-template.schema.json')).default as Record<string, unknown>;
    case 'rate_library': return (await import('@eq/schemas/schemas/rate-library.schema.json')).default as Record<string, unknown>;
    case 'quote_email_outbox': return (await import('@eq/schemas/schemas/quote-email-outbox.schema.json')).default as Record<string, unknown>;
    // Field originals
    case 'staff': return (await import('@eq/schemas/schemas/staff.schema.json')).default as Record<string, unknown>;
    case 'schedule': return (await import('@eq/schemas/schemas/schedule.schema.json')).default as Record<string, unknown>;
    case 'prestart': return (await import('@eq/schemas/schemas/prestart.schema.json')).default as Record<string, unknown>;
    case 'toolbox_talk': return (await import('@eq/schemas/schemas/toolbox-talk.schema.json')).default as Record<string, unknown>;
    case 'swms': return (await import('@eq/schemas/schemas/swms.schema.json')).default as Record<string, unknown>;
    case 'jsa': return (await import('@eq/schemas/schemas/jsa.schema.json')).default as Record<string, unknown>;
    case 'itp': return (await import('@eq/schemas/schemas/itp.schema.json')).default as Record<string, unknown>;
    case 'incident': return (await import('@eq/schemas/schemas/incident.schema.json')).default as Record<string, unknown>;
    // Field S2.A
    case 'timesheet': return (await import('@eq/schemas/schemas/timesheet.schema.json')).default as Record<string, unknown>;
    case 'leave_request': return (await import('@eq/schemas/schemas/leave-request.schema.json')).default as Record<string, unknown>;
    case 'leave_balance': return (await import('@eq/schemas/schemas/leave-balance.schema.json')).default as Record<string, unknown>;
    case 'checkin': return (await import('@eq/schemas/schemas/checkin.schema.json')).default as Record<string, unknown>;
    case 'tenant_app_config': return (await import('@eq/schemas/schemas/tenant-app-config.schema.json')).default as Record<string, unknown>;
    case 'tender': return (await import('@eq/schemas/schemas/tender.schema.json')).default as Record<string, unknown>;
    case 'tender_enrichment': return (await import('@eq/schemas/schemas/tender-enrichment.schema.json')).default as Record<string, unknown>;
    case 'tender_nomination': return (await import('@eq/schemas/schemas/tender-nomination.schema.json')).default as Record<string, unknown>;
    case 'tender_import_run': return (await import('@eq/schemas/schemas/tender-import-run.schema.json')).default as Record<string, unknown>;
    case 'tender_review_decision': return (await import('@eq/schemas/schemas/tender-review-decision.schema.json')).default as Record<string, unknown>;
    case 'site_diary': return (await import('@eq/schemas/schemas/site-diary.schema.json')).default as Record<string, unknown>;
    case 'weekly_report': return (await import('@eq/schemas/schemas/weekly-report.schema.json')).default as Record<string, unknown>;
    case 'apprentice_profile': return (await import('@eq/schemas/schemas/apprentice-profile.schema.json')).default as Record<string, unknown>;
    case 'skills_rating': return (await import('@eq/schemas/schemas/skills-rating.schema.json')).default as Record<string, unknown>;
    case 'feedback_entry': return (await import('@eq/schemas/schemas/feedback-entry.schema.json')).default as Record<string, unknown>;
    case 'rotation': return (await import('@eq/schemas/schemas/rotation.schema.json')).default as Record<string, unknown>;
    case 'buddy_checkin': return (await import('@eq/schemas/schemas/buddy-checkin.schema.json')).default as Record<string, unknown>;
    case 'quarterly_review': return (await import('@eq/schemas/schemas/quarterly-review.schema.json')).default as Record<string, unknown>;
    case 'engagement_log': return (await import('@eq/schemas/schemas/engagement-log.schema.json')).default as Record<string, unknown>;
    case 'tafe_calendar': return (await import('@eq/schemas/schemas/tafe-calendar.schema.json')).default as Record<string, unknown>;
    case 'schedule_change_log': return (await import('@eq/schemas/schemas/schedule-change-log.schema.json')).default as Record<string, unknown>;
    case 'leave_approval_log': return (await import('@eq/schemas/schemas/leave-approval-log.schema.json')).default as Record<string, unknown>;
    default: return null;
  }
}

interface EntityImportPanelProps {
  entity: string;
  entityLabel?: string;
  onClose?: () => void;
}

export function EntityImportPanel({ entity, entityLabel, onClose }: EntityImportPanelProps) {
  const label = entityLabel || entity;
  const { session } = useSession();
  const table = ENTITY_TABLE_MAP[entity];
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // null = unknown / not-applicable; number = the tenant's site count. Used to
  // warn before importing a site-scoped entity (e.g. assets) with no sites to
  // link to, so the user fixes the order instead of hitting silent FK failures.
  const [siteCount, setSiteCount] = useState<number | null>(null);
  // Set after an import completes — drives the "N sent to review" banner.
  const [stageSummary, setStageSummary] = useState<StageSummary | null>(null);

  // Lazy-load the schema only when the panel opens
  useEffect(() => {
    if (!table) return;
    let cancelled = false;
    setSchema(null);
    setLoadErr(null);
    setStageSummary(null);
    loadEntitySchema(entity)
      .then((s) => {
        if (cancelled) return;
        if (!s) setLoadErr(`This record type isn't set up for import yet.`);
        else setSchema(s);
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(friendlyError(e, "We couldn't load this importer. Please try again."));
      });
    return () => {
      cancelled = true;
    };
  }, [entity, table]);

  // If this entity's schema requires a site link, check the tenant has sites.
  const requiresSite = Array.isArray((schema as { required?: unknown })?.required)
    && ((schema as { required: string[] }).required).includes('site_id');

  useEffect(() => {
    if (!requiresSite || entity === 'site') return;
    let cancelled = false;
    fetch('/.netlify/functions/entity-rows?entity=site&limit=1', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { total?: number } | null) => {
        if (!cancelled && body && typeof body.total === 'number') setSiteCount(body.total);
      })
      .catch(() => { /* non-blocking — guard is advisory */ });
    return () => { cancelled = true; };
  }, [requiresSite, entity]);

  const config = useMemo(() => {
    if (!session || !schema || !table) return null;
    return {
      schema,
      tenantId: session.tenant.id,
      commit: makeCommitFn(table, session.tenant.id, entity, setStageSummary),
    };
  }, [session, entity, schema, table]);

  if (!session) {
    return <div className="eq-loading">Loading session…</div>;
  }

  if (!table) {
    return (
      <div className="eq-coming-soon">
        <h3>Import {label}</h3>
        <p>Direct file import isn't available for this record type yet.</p>
        {onClose && <button type="button" onClick={onClose}>Close</button>}
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="eq-error" role="alert">
        <p className="eq-error__title">Couldn't load the importer</p>
        <p className="eq-error__body">{loadErr}</p>
        {onClose && <button type="button" className="eq-error__retry" onClick={onClose}>Close</button>}
      </div>
    );
  }

  if (!schema || !config) {
    return <div className="eq-loading">Loading importer…</div>;
  }

  const properties = schema.properties as Record<string, unknown> | undefined;
  const canonicalFields = Object.keys(properties ?? {});

  return (
    <div className="entity-import-panel">
      <header className="entity-import-panel__header">
        <h3>Import {label}</h3>
        {onClose && (
          <button type="button" className="entity-import-panel__close" onClick={onClose}>
            Close
          </button>
        )}
      </header>
      {requiresSite && siteCount === 0 && (
        <div className="eq-hub-alert eq-hub-alert--action" role="alert" style={{ marginBottom: 12 }}>
          <span className="eq-hub-alert__icon" aria-hidden="true"><AlertTriangle size={14} /></span>
          <span className="eq-hub-alert__text">
            No sites found yet. Each item links to a site, so import your sites first
            (Core intake) — otherwise rows without a matching site won't be saved.
          </span>
        </div>
      )}
      <Suspense fallback={<div className="eq-loading">Loading import surface…</div>}>
        <ParserDropZone config={config} canonicalFields={canonicalFields} />
      </Suspense>
      {stageSummary && stageSummary.staged > 0 && (
        <div className="eq-hub-alert eq-hub-alert--action" role="status" style={{ marginTop: 12 }}>
          <span className="eq-hub-alert__icon" aria-hidden="true"><AlertTriangle size={14} /></span>
          <span className="eq-hub-alert__text">
            {stageSummary.committed > 0 && `${stageSummary.committed.toLocaleString()} imported. `}
            <strong>{stageSummary.staged.toLocaleString()}</strong>{' '}
            {stageSummary.staged === 1 ? 'row needs' : 'rows need'} a closer look
            {stageSummary.conflict_count > 0 &&
              ` (${stageSummary.conflict_count} possible duplicate${stageSummary.conflict_count === 1 ? '' : 's'})`}
            {' '}and {stageSummary.staged === 1 ? 'is' : 'are'} waiting in the review queue.
          </span>
        </div>
      )}
    </div>
  );
}

// Schema version stamped on the intake event and passed to the commit RPC.
// Matches x-eq-version on the authored JSON schemas.
const SCHEMA_VERSION = '1.0.0';

interface IntakeStageResponse {
  ok: boolean;
  committed_count?: number;
  committed_ids?: string[];
  staged_count?: number;
  health_score?: number;
  flagged_count?: number;
  conflict_count?: number;
  error?: string;
  detail?: string;
}

// Surfaced to the panel after an import so it can show how the batch split:
// some rows committed immediately (clean), some parked in the review queue
// (a conflict or an error/warning flag).
export interface StageSummary {
  intake_id: string;
  committed: number;
  staged: number;
  health_score: number;
  conflict_count: number;
}

function makeCommitFn(
  table: string,
  tenantId: string,
  entity: string,
  onStage: (s: StageSummary) => void,
): CommitFn {
  return async (rows: CommittableRow[]) => {
    const sb = await createSupabaseClient();

    const sourceSig = `shell-${entity}-${new Date().toISOString().slice(0, 19)}.csv`;

    const intakePayload = {
      tenant_id: tenantId,
      entity,
      source_kind: 'manual',
      source_subkind: 'shell-dropzone',
      source_filename: sourceSig,
      schema_version: SCHEMA_VERSION,
      status: 'pending',
      import_mode: 'append',
      source_app: 'shell',
      intake_mode: 'strict',
    };

    // Intake events live on the control plane (the DB the browser client
    // reaches). Create one first to get the intake_id; intake-stage stamps it
    // onto every committed/staged row and finalises the event status.
    const { data: intakeRow, error: intakeErr } = await sb
      .schema('shell_control')
      .from('eq_intake_events')
      .insert(intakePayload)
      .select('intake_id')
      .single();

    if (intakeErr || !intakeRow) {
      throw new Error(`Could not create intake event: ${intakeErr?.message ?? 'no row returned'}`);
    }

    const intakeId = (intakeRow as { intake_id: string }).intake_id;
    const rowsJsonb = rows.map((r) => r.canonical);

    // Route through intake-stage: it scores each row, commits the clean ones
    // immediately and parks rows with conflicts / errors in the review queue.
    // The tenant data plane is server-only, so this must go through a function.
    let result: IntakeStageResponse;
    try {
      const res = await fetch('/.netlify/functions/intake-stage', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intake_id: intakeId,
          entity,
          table,
          rows: rowsJsonb,
          source_sig: sourceSig,
          schema_version: SCHEMA_VERSION,
          import_mode: 'append',
        }),
      });
      result = (await res.json()) as IntakeStageResponse;
      if (!res.ok || !result.ok) {
        throw new Error(result.detail || result.error || `import failed (${res.status})`);
      }
    } catch (e) {
      const message = (e as Error).message;
      await sb.schema('shell_control').from('eq_intake_events').update({ status: 'failed', error_message: message }).eq('intake_id', intakeId);
      throw new Error(`Import failed: ${message}`);
    }

    const committed = result.committed_count ?? 0;
    const staged = result.staged_count ?? 0;

    // Surface the split to the panel (banner). intake-stage already finalised
    // the event status, so nothing more to write here.
    onStage({
      intake_id: intakeId,
      committed,
      staged,
      health_score: result.health_score ?? 100,
      conflict_count: result.conflict_count ?? 0,
    });

    // confirm-ui shows `committed` as the headline and treats `failed` as
    // rejected — staged rows are neither, so they're reported via the banner,
    // not here. failed=0 keeps confirm-ui's own summary accurate.
    return { committed, failed: 0 };
  };
}
