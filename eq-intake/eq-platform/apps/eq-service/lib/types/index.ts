// Global TypeScript types for EQ Solves Service

export type Role = 'super_admin' | 'admin' | 'supervisor' | 'technician' | 'read_only'

export type ProfileRole = Role | 'user'

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'annual' | 'ad_hoc'

// Tier framework (Phase A — visibility only, no enforcement yet).
// `tier` is the scale dimension; `compliance_tier` is the procurement-bar
// dimension. Independent because Jemena's small-contract / enterprise-grade
// compliance pattern proved they don't co-vary. See migration 0092.
export type TenantTier = 'starter' | 'team' | 'enterprise'
export type TenantComplianceTier = 'standard' | 'enhanced' | 'enterprise'

export interface Tenant {
  id: string
  name: string
  slug: string
  is_active: boolean
  tier: TenantTier
  compliance_tier: TenantComplianceTier
  created_at: string
  updated_at: string
}

// Shape returned by the public.tenant_tier_view (used by the Plan chip).
export interface TenantTierView {
  tenant_id: string
  tenant_name: string
  tier: TenantTier
  compliance_tier: TenantComplianceTier
  is_active: boolean
}

export interface TenantSettings {
  id: string
  tenant_id: string
  primary_colour: string
  deep_colour: string
  ice_colour: string
  ink_colour: string
  logo_url: string | null
  logo_url_on_dark: string | null
  product_name: string
  support_email: string | null
  // Report template settings
  // (report_site_photos / report_show_site_overview / report_customer_logo
  //  removed 26-Apr-2026 — see audit items 6-8.)
  report_show_cover_page: boolean
  report_show_contents: boolean
  report_show_executive_summary: boolean
  report_show_sign_off: boolean
  report_header_text: string | null
  report_footer_text: string | null
  report_company_name: string | null
  report_company_address: string | null
  report_company_abn: string | null
  report_company_phone: string | null
  report_sign_off_fields: string[]
  // Enhanced report settings
  report_logo_url: string | null
  report_logo_url_on_dark: string | null
  report_complexity: 'summary' | 'standard' | 'detailed'
  // When true, the commercial-tier features activate for this tenant:
  // contract-scope period-locking + audit history view, variations register,
  // service-credit risk surfacing, renewal pack generator, customer-visible
  // scope statement. When false (default) only the universal tier
  // (scope-context display, auto gap-close, out-of-scope block) is active.
  // See migration 0085.
  commercial_features_enabled: boolean
  // Module toggles (migration 0097) — per-tenant switches for non-core
  // sidebar entries. Existing tenants were backfilled to true; new tenants
  // default false so admins opt in to additional modules.
  calendar_enabled: boolean
  defects_enabled: boolean
  analytics_enabled: boolean
  contract_scope_enabled: boolean
  updated_at: string
}

export interface TenantMember {
  id: string
  tenant_id: string
  user_id: string
  role: Role
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: ProfileRole
  is_active: boolean
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  tenant_id: string
  name: string
  code: string | null
  email: string | null
  phone: string | null
  address: string | null
  logo_url: string | null
  logo_url_on_dark: string | null
  primary_contact_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type DefectSeverity = 'low' | 'medium' | 'high' | 'critical'
export type DefectStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

export interface Defect {
  id: string
  tenant_id: string
  check_id: string | null
  check_asset_id: string | null
  asset_id: string | null
  site_id: string | null
  title: string
  description: string | null
  severity: DefectSeverity
  status: DefectStatus
  raised_by: string | null
  assigned_to: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolution_notes: string | null
  work_order_number: string | null
  work_order_date: string | null
  created_at: string
  updated_at: string
}

export interface ReportDelivery {
  id: string
  tenant_id: string
  customer_id: string
  maintenance_check_id: string
  revision: number
  pdf_file_path: string
  docx_file_path: string
  content_hash_sha256: string
  delivered_to: string[]
  delivered_at: string
  delivered_by: string
  signed_url_expires_at: string
  delivery_message: string | null
  revision_reason: string | null
  download_count: number
  last_downloaded_at: string | null
  revoked_at: string | null
  revoked_by: string | null
  revoke_reason: string | null
  mutation_id: string | null
  created_at: string
  updated_at: string
}

export type ContractScopePeriodStatus = 'draft' | 'committed' | 'locked' | 'archived'

export type ContractVariationStatus =
  | 'draft'
  | 'quoted'
  | 'approved'
  | 'rejected'
  | 'billed'
  | 'cancelled'

export interface ContractVariation {
  id: string
  tenant_id: string
  customer_id: string
  site_id: string | null
  contract_scope_id: string | null
  variation_number: string
  title: string
  description: string | null
  financial_year: string | null
  value_estimate: number | null
  value_approved: number | null
  status: ContractVariationStatus
  customer_ref: string | null
  source_check_id: string | null
  approved_at: string | null
  rejected_at: string | null
  billed_at: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ContractScope {
  id: string
  tenant_id: string
  customer_id: string
  site_id: string | null
  financial_year: string
  scope_item: string
  is_included: boolean
  notes: string | null
  /**
   * Lifecycle stage. Added in migration 0084. Defaults to 'committed' so
   * legacy data behaves as before; year-end close flips to 'locked' which
   * makes the row immutable except via super_admin override (enforced by
   * the BD trigger, gated by the tenant's commercial_features_enabled flag
   * — migration 0085).
   */
  period_status: ContractScopePeriodStatus
  created_at: string
  updated_at: string
}

export interface SiteContact {
  id: string
  tenant_id: string
  site_id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
  created_at: string
  updated_at: string
}

export interface CustomerContact {
  id: string
  tenant_id: string
  customer_id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
  created_at: string
  updated_at: string
}

export interface Site {
  id: string
  tenant_id: string
  customer_id: string | null
  name: string
  code: string | null
  address: string | null
  city: string | null
  state: string | null
  postcode: string | null
  country: string
  latitude: number | null
  longitude: number | null
  photo_url: string | null
  logo_url: string | null
  logo_url_on_dark: string | null
  primary_contact_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Asset {
  id: string
  tenant_id: string
  site_id: string
  name: string
  asset_type: string
  manufacturer: string | null
  model: string | null
  serial_number: string | null
  maximo_id: string | null
  jemena_asset_id: string | null
  expected_rcd_circuits: number | null
  install_date: string | null
  location: string | null
  building: string | null
  job_plan_id: string | null
  dark_site_test: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface JobPlan {
  id: string
  tenant_id: string
  site_id: string | null
  customer_id: string | null
  name: string
  code: string | null
  type: string | null
  description: string | null
  frequency: Frequency | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface JobPlanItem {
  id: string
  tenant_id: string
  job_plan_id: string
  asset_id: string | null
  description: string
  sort_order: number
  is_required: boolean
  dark_site: boolean
  freq_monthly: boolean
  freq_quarterly: boolean
  freq_semi_annual: boolean
  freq_annual: boolean
  freq_2yr: boolean
  freq_3yr: boolean
  freq_5yr: boolean
  freq_8yr: boolean
  freq_10yr: boolean
  created_at: string
  updated_at: string
}

export type CheckStatus = 'scheduled' | 'in_progress' | 'complete' | 'overdue' | 'cancelled'

export type CheckItemResult = 'pass' | 'fail' | 'na'

export type MaintenanceFrequency = 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | '2yr' | '3yr' | '5yr' | '8yr' | '10yr'

export interface MaintenanceCheck {
  id: string
  tenant_id: string
  job_plan_id: string | null
  site_id: string
  assigned_to: string | null
  status: CheckStatus
  frequency: MaintenanceFrequency | null
  is_dark_site: boolean
  custom_name: string | null
  start_date: string | null
  due_date: string
  maximo_wo_number: string | null
  maximo_pm_number: string | null
  started_at: string | null
  completed_at: string | null
  notes: string | null
  signature_technician_url: string | null
  signature_site_url: string | null
  signature_initials: string | null
  gps_lat: number | null
  gps_lng: number | null
  created_at: string
  updated_at: string
}

// ── RCD test types (migration 0069) ───────────────────────────────────

export type RcdTestStatus = 'draft' | 'complete' | 'archived'

export interface RcdTest {
  id: string
  tenant_id: string
  customer_id: string | null
  site_id: string
  asset_id: string
  check_id: string | null
  test_date: string
  technician_user_id: string | null
  technician_name_snapshot: string | null
  technician_initials: string | null
  site_signature_url: string | null
  site_rep_name: string | null
  equipment_used: string | null
  notes: string | null
  status: RcdTestStatus
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface RcdTestCircuit {
  id: string
  tenant_id: string
  rcd_test_id: string
  section_label: string | null
  circuit_no: string
  normal_trip_current_ma: number
  // Timing values stored as text to allow ">310" non-trip indicator.
  x1_no_trip_0_ms: string | null
  x1_no_trip_180_ms: string | null
  x1_trip_0_ms: string | null
  x1_trip_180_ms: string | null
  x5_fast_0_ms: string | null
  x5_fast_180_ms: string | null
  trip_test_button_ok: boolean
  jemena_circuit_asset_id: string | null
  action_taken: string | null
  is_critical_load: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

// ── Thermal scan types (migration 0070) ───────────────────────────────

export type ThermalScanStatus = 'draft' | 'complete' | 'archived'
export type ThermalEvaluationMode = 'qualitative' | 'quantitative'
export type ThermalPriorityRating =
  | 'monitor'
  | 'repair_when_practical'
  | 'repair_soon'
  | 'urgent'
  | 'critical'

export interface ThermalScan {
  id: string
  tenant_id: string
  customer_id: string | null
  site_id: string
  check_id: string | null
  date_performed: string
  performed_by_user_id: string | null
  performed_by_snapshot: string | null
  report_author: string | null
  report_date: string | null
  scope_of_survey: string | null
  equipment_used: string | null
  evaluation_mode: ThermalEvaluationMode
  total_photos: number
  anomalies_found: number
  notes: string | null
  status: ThermalScanStatus
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ThermalScanFinding {
  id: string
  tenant_id: string
  thermal_scan_id: string
  asset_id: string | null
  ir_image_attachment_id: string | null
  daylight_image_attachment_id: string | null
  priority_rating: ThermalPriorityRating
  observation: string | null
  delta_temp_c: number | null
  ambient_temp_c: number | null
  apparent_load_pct: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type CheckAssetStatus = 'pending' | 'completed' | 'na'

export interface CheckAsset {
  id: string
  tenant_id: string
  check_id: string
  asset_id: string
  status: CheckAssetStatus
  work_order_number: string | null
  notes: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface MaintenanceCheckItem {
  id: string
  tenant_id: string
  check_id: string
  check_asset_id: string | null
  job_plan_item_id: string | null
  asset_id: string | null
  description: string
  sort_order: number
  is_required: boolean
  result: CheckItemResult | null
  notes: string | null
  completed_at: string | null
  completed_by: string | null
  created_at: string
  updated_at: string
}

export type TestResult = 'pending' | 'pass' | 'fail' | 'defect'

export interface TestRecord {
  id: string
  tenant_id: string
  asset_id: string
  site_id: string
  test_type: string
  test_date: string
  tested_by: string | null
  result: TestResult
  notes: string | null
  next_test_due: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TestRecordReading {
  id: string
  tenant_id: string
  test_record_id: string
  label: string
  value: string | null
  unit: string | null
  pass: boolean | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type AcbTestType = 'Initial' | 'Routine' | 'Special'

export type AcbTestResult = 'Pending' | 'Pass' | 'Fail' | 'Defect'

export type AcbPerformanceLevel = 'N1' | 'H1' | 'H2' | 'H3' | 'L1'
export type AcbFixedWithdrawable = 'Fixed' | 'Withdrawable'

export interface AcbTest {
  id: string
  tenant_id: string
  asset_id: string
  site_id: string
  check_id: string | null
  test_date: string
  tested_by: string | null
  test_type: AcbTestType
  cb_make: string | null
  cb_model: string | null
  cb_serial: string | null
  cb_rating: string | null
  cb_poles: string | null
  trip_unit: string | null
  trip_settings_ir: string | null
  trip_settings_isd: string | null
  trip_settings_ii: string | null
  trip_settings_ig: string | null
  overall_result: AcbTestResult
  notes: string | null
  step1_status: 'pending' | 'in_progress' | 'complete'
  step2_status: 'pending' | 'in_progress' | 'complete'
  step3_status: 'pending' | 'in_progress' | 'complete'
  is_active: boolean
  created_at: string
  updated_at: string
  // Asset Collection fields (migration 0023)
  brand: string | null
  breaker_type: string | null
  name_location: string | null
  performance_level: AcbPerformanceLevel | null
  protection_unit_fitted: boolean | null
  trip_unit_model: string | null
  current_in: string | null
  fixed_withdrawable: AcbFixedWithdrawable | null
  // Protection Settings
  long_time_ir: string | null
  long_time_delay_tr: string | null
  short_time_pickup_isd: string | null
  short_time_delay_tsd: string | null
  instantaneous_pickup: string | null
  earth_fault_pickup: string | null
  earth_fault_delay: string | null
  earth_leakage_pickup: string | null
  earth_leakage_delay: string | null
  // Accessories
  motor_charge: string | null
  shunt_trip_mx1: string | null
  shunt_close_xf: string | null
  undervoltage_mn: string | null
  second_shunt_trip: string | null
}

export interface AcbTestReading {
  id: string
  acb_test_id: string
  tenant_id: string
  label: string
  value: string
  unit: string | null
  is_pass: boolean | null
  sort_order: number
  created_at: string
}

/**
 * Attachment categorisation. Drives where the file shows up:
 *   - evidence  → photos/videos on tests + defects, included on PDF reports.
 *   - reference → site drawings/SLDs/manuals, pinned to site detail pages.
 *   - paperwork → POs/customer signoffs/dockets on work orders, internal only.
 *
 * Required on every new upload (migration 0060). Existing pre-2026-04-26 rows
 * were wiped; no nulls in the column.
 */
export type AttachmentType = 'evidence' | 'reference' | 'paperwork'

export interface Attachment {
  id: string
  tenant_id: string
  entity_type: string
  entity_id: string
  attachment_type: AttachmentType
  file_name: string
  file_size: number
  content_type: string
  storage_path: string
  uploaded_by: string | null
  created_at: string
}

export type MediaCategory = 'customer_logo' | 'site_photo' | 'report_image' | 'general'

export interface MediaItem {
  id: string
  tenant_id: string
  name: string
  /**
   * Legacy single-valued category — kept in sync with categories[0] by a DB
   * trigger (migration 0056). Read from `categories` for new code; this field
   * is only here for backwards compat until it's dropped.
   */
  category: MediaCategory
  /** Multi-category tags — added in migration 0056. Always non-empty. */
  categories: MediaCategory[]
  entity_type: 'customer' | 'site' | null
  entity_id: string | null
  file_url: string
  file_name: string
  content_type: string | null
  file_size: number | null
  uploaded_by: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type NsxTestType = 'Initial' | 'Routine' | 'Special'

export type NsxTestResult = 'Pending' | 'Pass' | 'Fail' | 'Defect'

export interface NsxTest {
  id: string
  tenant_id: string
  asset_id: string
  site_id: string
  check_id: string | null
  test_date: string
  tested_by: string | null
  test_type: NsxTestType
  cb_make: string | null
  cb_model: string | null
  cb_serial: string | null
  cb_rating: string | null
  cb_poles: string | null
  trip_unit: string | null
  overall_result: NsxTestResult
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  // 3-step workflow (migration 0026) — mirrors ACB
  step1_status: 'pending' | 'in_progress' | 'complete'
  step2_status: 'pending' | 'in_progress' | 'complete'
  step3_status: 'pending' | 'in_progress' | 'complete'
  // Extended asset collection fields (migration 0026)
  brand: string | null
  breaker_type: string | null
  name_location: string | null
  current_in: string | null
  fixed_withdrawable: 'fixed' | 'withdrawable' | 'plug_in' | null
  protection_unit_fitted: boolean | null
  trip_unit_model: string | null
  long_time_ir: string | null
  long_time_delay_tr: string | null
  short_time_pickup_isd: string | null
  short_time_delay_tsd: string | null
  instantaneous_pickup: string | null
  earth_fault_pickup: string | null
  earth_fault_delay: string | null
  motor_charge: string | null
  shunt_trip_mx1: string | null
  shunt_close_xf: string | null
  undervoltage_mn: string | null
}

export interface NsxTestReading {
  id: string
  nsx_test_id: string
  tenant_id: string
  label: string
  value: string
  unit: string | null
  is_pass: boolean | null
  sort_order: number
  created_at: string
}

// Testing Checks — groups multiple ACB/NSX tests under one named check
export type TestingCheckType = 'acb' | 'nsx' | 'general'
export type TestingCheckStatus = 'scheduled' | 'in_progress' | 'complete' | 'cancelled'

export interface TestingCheck {
  id: string
  tenant_id: string
  site_id: string
  job_plan_id: string | null
  name: string
  check_type: TestingCheckType
  frequency: string | null
  month: number | null
  year: number | null
  status: TestingCheckStatus
  created_by: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  tenant_id: string
  user_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  summary: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export type InstrumentStatus = 'Active' | 'Out for Cal' | 'Retired' | 'Lost'

export interface Instrument {
  id: string
  tenant_id: string
  name: string
  instrument_type: string
  make: string | null
  model: string | null
  serial_number: string | null
  asset_tag: string | null
  calibration_date: string | null
  calibration_due: string | null
  calibration_cert: string | null
  status: InstrumentStatus
  assigned_to: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// PM Calendar
export type PmCalendarStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
export type AuFyQuarter = 'Q1' | 'Q2' | 'Q3' | 'Q4'

export type PmCalendarCategory =
  | 'Thermal scanning'
  | 'Dark site test'
  | 'Emergency lighting'
  | 'Lightning protection testing'
  | 'Management'
  | 'RCD testing'
  | 'Test and tagging'
  | 'Quarterly maintenance'
  | 'WOs'

export interface PmCalendarEntry {
  id: string
  tenant_id: string
  site_id: string | null
  title: string
  location: string | null
  description: string | null
  category: string
  start_time: string
  end_time: string | null
  hours: number
  contractor_materials_cost: number
  quarter: AuFyQuarter | null
  financial_year: string | null
  recurrence_rule: string | null
  recurrence_parent_id: string | null
  reminder_days_before: number[]
  notification_recipients: string[]
  email_template: string | null
  last_notified_at: string | null
  assigned_to: string | null
  status: PmCalendarStatus
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ApiResponse<T> {
  data: T | null
  error: string | null
  meta?: PaginationMeta
}

export interface PaginationMeta {
  page: number
  per_page: number
  total: number
  total_pages: number
}
