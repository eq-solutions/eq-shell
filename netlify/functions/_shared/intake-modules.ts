// Single source of truth for intake table -> module routing.
//
// Shared by the commit orchestrator (intake-commit), the staging writer
// (intake-stage), and the approval path (intake-staging-approve). Extracted
// here so the 30+ entry map can't drift between those functions — adding a
// table is a one-line change in one place (plus the per-module RPC allow-list
// on the tenant data plane).

export type IntakeModule = 'cards' | 'service' | 'quotes' | 'core' | 'field';
export type ImportMode = 'append' | 'upsert' | 'replace';

// Table -> module mapping. Mirrors the dispatcher in the shared
// eq_intake_commit_batch (and eq_schema_registry.module). Kept on the function
// side so we don't need a control-plane round-trip just to learn which tenant
// DB RPC to call.
export const TABLE_MODULE: Record<string, IntakeModule> = {
  // cards
  licences: 'cards',
  // service
  assets: 'service',
  // quotes
  quote: 'quotes',
  quote_line_item: 'quotes',
  quote_status_history: 'quotes',
  quote_attachment: 'quotes',
  quote_email_outbox: 'quotes',
  scope_template: 'quotes',
  rate_library: 'quotes',
  // core (SimPRO flow)
  customers: 'core',
  contacts: 'core',
  sites: 'core',
  // field — full list. Must mirror v_allowed in 0011_intake_field_rpc.sql.
  staff:                     'field',
  apprentice_profiles:       'field',
  buddy_checkins:            'field',
  checkins:                  'field',
  engagement_logs:           'field',
  feedback_entries:          'field',
  incidents:                 'field',
  itp_records:               'field',
  jsa_records:               'field',
  swms:                      'field',
  prestart_checks:           'field',
  toolbox_talks:             'field',
  jobs:                      'field',
  leave_approval_logs:       'field',
  leave_balances:            'field',
  leave_requests:            'field',
  quarterly_reviews:         'field',
  rotations:                 'field',
  schedule_change_logs:      'field',
  schedule_entries:          'field',
  site_diaries:              'field',
  skills_ratings:            'field',
  tafe_calendars:            'field',
  tender_enrichments:        'field',
  tender_import_runs:        'field',
  tender_nominations:        'field',
  tender_review_decisions:   'field',
  tenders:                   'field',
  timesheets:                'field',
  weekly_reports:            'field',
};

// Modules implemented on the tenant data plane. Add to this set as each
// per-module RPC lands.
export const IMPLEMENTED_MODULES: ReadonlySet<IntakeModule> = new Set<IntakeModule>([
  'cards', 'service', 'quotes', 'core', 'field',
]);

export function resolveModule(table: string): IntakeModule | undefined {
  return TABLE_MODULE[table];
}
