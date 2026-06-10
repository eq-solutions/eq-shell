/**
 * canonical-export.ts — per-entity exporters that reshape eq-solves-service
 * DB rows into the canonical EQ schema shape (see eq-intake/schemas/).
 *
 * Each exporter:
 *   - Queries the relevant table(s), tenant-scoped.
 *   - Reshapes DB column names → canonical schema property names
 *     (e.g. assets.id → asset.asset_id, assets.maximo_id → asset.external_id).
 *   - Returns rows that should validate clean against the matching schema
 *     in https://schemas.eq.solutions/.
 *
 * Pure data transformation. No deletion, no caching. Designed to be invoked
 * from the /api/admin/export route handler under an admin role check.
 *
 * Coverage today:
 *   FULL: acb_test (+ child visual_check_items + electrical_readings)
 *   FULL: customer, site, asset, maintenance_check, check_asset, check_item,
 *         defect
 *   STUB: everything else — returns { schema_id, count: 0, rows: [],
 *         note: "exporter not yet implemented" }
 *
 * Adding a new exporter: add a key to ENTITY_EXPORTERS and write the
 * mapping function. Stubs surface clearly in the response so consumers
 * know what's missing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ───────────────────────────────────────────────────────────

export interface EntityExportResult {
  schema_id: string;
  schema_version: string;
  count: number;
  rows: Array<Record<string, unknown>>;
  /** Present only when the exporter is a stub. */
  note?: string;
}

export type EntityExporter = (
  supabase: SupabaseClient,
  tenantId: string,
) => Promise<EntityExportResult>;

const SCHEMA_BASE = "https://schemas.eq.solutions";

function schemaId(module: string, entity: string): string {
  return `${SCHEMA_BASE}/${module}/${entity}/v1.json`;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Cast a Supabase `.select(literalString)` response data into a row array
 * we can read. Supabase's type inference returns `Row[] | GenericStringError`
 * when the select string is a long literal — even though the runtime value
 * is always the array once the error check has passed. This unwrap keeps
 * the per-entity functions readable.
 */
type Row = Record<string, unknown>;
function asRows(data: unknown): Row[] {
  return (Array.isArray(data) ? data : []) as Row[];
}

function stub(module: string, entity: string): EntityExportResult {
  return {
    schema_id: schemaId(module, entity),
    schema_version: "1.0.0",
    count: 0,
    rows: [],
    note: "exporter not yet implemented",
  };
}

// ── Per-entity exporters ────────────────────────────────────────────

/**
 * customer exporter — emits ONLY the CRM-shape fields. Contract fields
 * (CPI, SLAs, hourly rates, contract_template, term dates) are emitted
 * by `exportServiceContract` reading from the same DB row.
 *
 * The eq-solves-service DB still has both sets of fields jammed into
 * the `customers` table; the canonical split happens at export time.
 * A future migration will physically split them into two tables.
 *
 * Lifecycle `type` is derived from the row state:
 *   - has any contract_term_start/end set → "active"
 *   - is_active=false                     → "churned"
 *   - else                                 → "lead"
 * This is a best-effort derivation until the DB carries the field
 * explicitly. Customers who currently have draft quotes but no signed
 * contracts will be tagged "lead" here — Royce can manually flag
 * "prospect" once the customers UI grows a lifecycle picker.
 */
const exportCustomer: EntityExporter = async (supabase, tenantId) => {
  const { data, error } = await supabase
    .from("customers")
    .select(
      "id, name, code, email, phone, address, is_active, logo_url, " +
        "customer_entity_legal_name, customer_entity_abn, customer_entity_acn, " +
        "contract_term_start, contract_term_end, created_at",
    )
    .eq("tenant_id", tenantId);

  if (error) throw error;
  const rows = asRows(data).map((r) => {
    // Derive lifecycle type until the DB has its own column.
    let lifecycleType: "lead" | "prospect" | "active" | "churned" = "lead";
    if (r.is_active === false) lifecycleType = "churned";
    else if (r.contract_term_start || r.contract_term_end) lifecycleType = "active";

    const out: Row = {
      customer_id: r.id,
      tenant_id: tenantId,
      type: lifecycleType,
      company_name: r.name,
      code: r.code,
      customer_entity_legal_name: r.customer_entity_legal_name,
      customer_entity_abn: r.customer_entity_abn,
      customer_entity_acn: r.customer_entity_acn,
      email: r.email,
      phone: r.phone,
      address: r.address,
      logo_url: r.logo_url,
      first_engaged_at: r.created_at ? String(r.created_at).slice(0, 10) : null,
      became_active_at:
        lifecycleType === "active" && r.contract_term_start
          ? String(r.contract_term_start).slice(0, 10)
          : null,
      churned_at: null,
      active: r.is_active !== false,
    };
    return out;
  });

  return { schema_id: schemaId("core", "customer"), schema_version: "2.0.0", count: rows.length, rows };
};

/**
 * service_contract exporter — emits one row per customer that has any
 * contract-side field set on the `customers` table. Until the DB is
 * physically split, the canonical service_contract is derived from
 * the customer row.
 *
 * Once the DB grows a real `service_contracts` table this exporter
 * pivots to reading from that. Until then: one contract per customer
 * with `contract_template != null OR contract_term_start != null`.
 */
const exportServiceContract: EntityExporter = async (supabase, tenantId) => {
  const { data, error } = await supabase
    .from("customers")
    .select(
      "id, name, " +
        "contract_template, smca_agreement_number, schedule_agreement_number, " +
        "contract_term_start, contract_term_end, contract_options, " +
        "visit_cadence, cpi_basis, cpi_rate, fiscal_year_basis, " +
        "payment_terms_days, hourly_rate_normal, hourly_rate_after_hours, " +
        "hourly_rate_weekend, hourly_rate_public_holiday, " +
        "min_hours_after_hours, min_hours_weekend, hourly_rate_effective_from, " +
        "sla_response_minutes, sla_onsite_hours, sla_resolution_hours, " +
        "monthly_report_due_day, pm_reschedule_notice_days, " +
        "service_credit_pm_breach_pct, service_credit_reactive_breach_pct, " +
        "service_credit_spares_breach_pct, " +
        "management_hours_per_period, management_period_basis",
    )
    .eq("tenant_id", tenantId);

  if (error) throw error;
  // Only emit customers that have at least one contract-side field set.
  const rows = asRows(data)
    .filter(
      (r) =>
        r.contract_template !== null ||
        r.contract_term_start !== null ||
        r.smca_agreement_number !== null,
    )
    .map((r) => {
      // Derive a deterministic contract_id from the customer id while
      // the DB doesn't have its own — uses the customer's UUID. A real
      // contracts table will replace this with its own PK.
      const out: Row = {
        contract_id: r.id,
        tenant_id: tenantId,
        customer_id: r.id,
        name: r.name ? `${r.name} — current contract` : null,
        status: "active",
        contract_template: r.contract_template,
        smca_agreement_number: r.smca_agreement_number,
        schedule_agreement_number: r.schedule_agreement_number,
        term_start: r.contract_term_start,
        term_end: r.contract_term_end,
        options: r.contract_options,
        visit_cadence: r.visit_cadence,
        cpi_basis: r.cpi_basis,
        cpi_rate: r.cpi_rate,
        fiscal_year_basis: r.fiscal_year_basis,
        payment_terms_days: r.payment_terms_days,
        hourly_rate_normal: r.hourly_rate_normal,
        hourly_rate_after_hours: r.hourly_rate_after_hours,
        hourly_rate_weekend: r.hourly_rate_weekend,
        hourly_rate_public_holiday: r.hourly_rate_public_holiday,
        min_hours_after_hours: r.min_hours_after_hours,
        min_hours_weekend: r.min_hours_weekend,
        hourly_rate_effective_from: r.hourly_rate_effective_from,
        sla_response_minutes: r.sla_response_minutes,
        sla_onsite_hours: r.sla_onsite_hours,
        sla_resolution_hours: r.sla_resolution_hours,
        monthly_report_due_day: r.monthly_report_due_day,
        pm_reschedule_notice_days: r.pm_reschedule_notice_days,
        service_credit_pm_breach_pct: r.service_credit_pm_breach_pct,
        service_credit_reactive_breach_pct: r.service_credit_reactive_breach_pct,
        service_credit_spares_breach_pct: r.service_credit_spares_breach_pct,
        management_hours_per_period: r.management_hours_per_period,
        management_period_basis: r.management_period_basis,
        active: true,
      };
      return out;
    });

  return {
    schema_id: schemaId("service", "service-contract"),
    schema_version: "1.0.0",
    count: rows.length,
    rows,
  };
};

const exportSite: EntityExporter = async (supabase, tenantId) => {
  const { data, error } = await supabase
    .from("sites")
    .select(
      "id, customer_id, name, code, address, city, state, postcode, country, " +
        "is_active",
    )
    .eq("tenant_id", tenantId);

  if (error) throw error;
  const rows = asRows(data).map((r) => {
    const out: Record<string, unknown> = {
      site_id: r.id,
      tenant_id: tenantId,
      customer_id: r.customer_id,
      name: r.name,
      code: r.code,
      address_line_1: r.address,
      suburb: r.city,
      state: r.state,
      postcode: r.postcode,
      country: r.country ?? "AU",
      active: r.is_active,
    };
    return out;
  });

  return { schema_id: schemaId("core", "site"), schema_version: "1.0.0", count: rows.length, rows };
};

const exportAsset: EntityExporter = async (supabase, tenantId) => {
  const { data, error } = await supabase
    .from("assets")
    .select(
      "id, site_id, name, asset_type, manufacturer, model, serial_number, " +
        "maximo_id, jemena_asset_id, install_date, location, is_active",
    )
    .eq("tenant_id", tenantId);

  if (error) throw error;
  const rows = asRows(data).map((r) => {
    // Asset uses external_id for the customer-facing tag. eq-solves-service
    // stores both maximo_id and jemena_asset_id — prefer maximo_id since
    // that's the most common at SKS today; surface the Jemena id as a
    // separate field on the row so consumers can resolve if needed.
    const out: Record<string, unknown> = {
      asset_id: r.id,
      tenant_id: tenantId,
      site_id: r.site_id,
      asset_type: r.asset_type,
      name: r.name,
      make: r.manufacturer,
      model: r.model,
      serial_number: r.serial_number,
      external_id: r.maximo_id ?? r.jemena_asset_id ?? null,
      install_date: r.install_date,
      location_in_site: r.location,
      active: r.is_active,
    };
    return out;
  });

  return { schema_id: schemaId("service", "asset"), schema_version: "1.0.0", count: rows.length, rows };
};

const exportMaintenanceCheck: EntityExporter = async (supabase, tenantId) => {
  const { data, error } = await supabase
    .from("maintenance_checks")
    .select(
      "id, job_plan_id, site_id, assigned_to, status, due_date, start_date, " +
        "started_at, completed_at, frequency, is_dark_site, custom_name, " +
        "maximo_wo_number, maximo_pm_number, notes",
    )
    .eq("tenant_id", tenantId);

  if (error) throw error;
  const rows = asRows(data).map((r) => {
    const out: Record<string, unknown> = {
      check_id: r.id,
      tenant_id: tenantId,
      plan_id: r.job_plan_id,
      site_id: r.site_id,
      assigned_to_user_id: r.assigned_to,
      status: r.status,
      due_date: r.due_date,
      start_date: r.start_date,
      started_at: r.started_at,
      completed_at: r.completed_at,
      frequency: r.frequency,
      is_dark_site: r.is_dark_site ?? false,
      custom_name: r.custom_name,
      maximo_wo_number: r.maximo_wo_number,
      maximo_pm_number: r.maximo_pm_number,
      notes: r.notes,
    };
    return out;
  });

  return {
    schema_id: schemaId("service", "maintenance-check"),
    schema_version: "1.0.0",
    count: rows.length,
    rows,
  };
};

const exportCheckAsset: EntityExporter = async (supabase, tenantId) => {
  const { data, error } = await supabase
    .from("check_assets")
    .select(
      "id, check_id, asset_id, status, work_order_number, priority, work_type, " +
        "crew_id, target_start, target_finish, failure_code, problem, cause, " +
        "remedy, classification, ir_scan_result, completed_at, notes",
    )
    .eq("tenant_id", tenantId);

  if (error) throw error;
  const rows = asRows(data).map((r) => {
    const out: Record<string, unknown> = {
      check_asset_id: r.id,
      tenant_id: tenantId,
      check_id: r.check_id,
      asset_id: r.asset_id,
      status: r.status,
      work_order_number: r.work_order_number,
      priority: r.priority,
      work_type: r.work_type,
      crew_id: r.crew_id,
      target_start: r.target_start,
      target_finish: r.target_finish,
      failure_code: r.failure_code,
      problem: r.problem,
      cause: r.cause,
      remedy: r.remedy,
      classification: r.classification,
      ir_scan_result: r.ir_scan_result,
      completed_at: r.completed_at,
      notes: r.notes,
    };
    return out;
  });

  return {
    schema_id: schemaId("service", "check-asset"),
    schema_version: "1.0.0",
    count: rows.length,
    rows,
  };
};

const exportCheckItem: EntityExporter = async (supabase, tenantId) => {
  const { data, error } = await supabase
    .from("maintenance_check_items")
    .select(
      "id, check_id, check_asset_id, job_plan_item_id, asset_id, description, " +
        "sort_order, is_required, result, notes, completed_at, completed_by",
    )
    .eq("tenant_id", tenantId);

  if (error) throw error;
  const rows = asRows(data).map((r) => {
    const out: Record<string, unknown> = {
      item_id: r.id,
      tenant_id: tenantId,
      check_id: r.check_id,
      check_asset_id: r.check_asset_id,
      plan_item_id: r.job_plan_item_id,
      asset_id: r.asset_id,
      description: r.description,
      sort_order: r.sort_order ?? 0,
      is_required: r.is_required ?? true,
      result: r.result,
      notes: r.notes,
      completed_at: r.completed_at,
      completed_by_user_id: r.completed_by,
    };
    return out;
  });

  return {
    schema_id: schemaId("service", "check-item"),
    schema_version: "1.0.0",
    count: rows.length,
    rows,
  };
};

const exportDefect: EntityExporter = async (supabase, tenantId) => {
  const { data, error } = await supabase
    .from("defects")
    .select(
      "id, check_id, check_asset_id, asset_id, site_id, title, description, " +
        "severity, status, raised_by, assigned_to, resolved_at, resolved_by, " +
        "resolution_notes, work_order_number, work_order_date",
    )
    .eq("tenant_id", tenantId);

  if (error) throw error;
  const rows = asRows(data).map((r) => {
    const out: Record<string, unknown> = {
      defect_id: r.id,
      tenant_id: tenantId,
      check_id: r.check_id,
      check_asset_id: r.check_asset_id,
      asset_id: r.asset_id,
      site_id: r.site_id,
      title: r.title,
      description: r.description,
      severity: r.severity,
      status: r.status,
      raised_by_user_id: r.raised_by,
      assigned_to_user_id: r.assigned_to,
      resolved_at: r.resolved_at,
      resolved_by_user_id: r.resolved_by,
      resolution_notes: r.resolution_notes,
      work_order_number: r.work_order_number,
      work_order_date: r.work_order_date,
    };
    return out;
  });

  return {
    schema_id: schemaId("service", "defect"),
    schema_version: "1.0.0",
    count: rows.length,
    rows,
  };
};

/**
 * ACB tests with their child readings. The acb_test_readings DB table is
 * split into two canonical entities at export time:
 *   - acb_visual_check_item: rows where `unit` is null (qualitative pass/fail)
 *   - acb_electrical_reading: rows where `unit` is non-null (with value+unit)
 * See the `x-eq-table-discriminator` extension on the child schemas.
 */
const exportAcbTest: EntityExporter = async (supabase, tenantId) => {
  const { data: tests, error: testsErr } = await supabase
    .from("acb_tests")
    .select("*")
    .eq("tenant_id", tenantId);
  if (testsErr) throw testsErr;

  const testIds = (tests ?? []).map((t) => t.id as string);
  let readings: Array<Record<string, unknown>> = [];
  if (testIds.length > 0) {
    const { data: readingsData, error: readingsErr } = await supabase
      .from("acb_test_readings")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("acb_test_id", testIds);
    if (readingsErr) throw readingsErr;
    readings = (readingsData ?? []) as Array<Record<string, unknown>>;
  }

  // Split readings by test id + discriminator.
  const visualByTest = new Map<string, Array<Record<string, unknown>>>();
  const electricalByTest = new Map<string, Array<Record<string, unknown>>>();
  for (const r of readings) {
    const tid = r.acb_test_id as string;
    const isVisual = r.unit === null || r.unit === "";
    const canonical = isVisual
      ? {
          item_id: r.id,
          tenant_id: tenantId,
          acb_test_id: tid,
          label: r.label,
          // value column carries "Pass"/"Fail"/"N/A" for visual items
          is_pass:
            r.value === "Pass" || r.value === "pass" || r.value === "P"
              ? true
              : r.value === "Fail" || r.value === "fail" || r.value === "F"
                ? false
                : null,
          sort_order: r.sort_order ?? 0,
        }
      : {
          reading_id: r.id,
          tenant_id: tenantId,
          acb_test_id: tid,
          label: r.label,
          value: r.value,
          unit: r.unit,
          is_pass: r.is_pass,
          sort_order: r.sort_order ?? 0,
        };
    const target = isVisual ? visualByTest : electricalByTest;
    if (!target.has(tid)) target.set(tid, []);
    target.get(tid)!.push(canonical);
  }

  const rows = (tests ?? []).map((t) => {
    const out: Record<string, unknown> = {
      acb_test_id: t.id,
      tenant_id: tenantId,
      asset_id: t.asset_id,
      site_id: t.site_id,
      test_date: t.test_date,
      tested_by_user_id: t.tested_by,
      test_type: t.test_type,
      brand: t.brand,
      breaker_type: t.breaker_type,
      name_location: t.name_location,
      performance_level: t.performance_level,
      protection_unit_fitted: t.protection_unit_fitted,
      trip_unit_model: t.trip_unit_model,
      current_in: t.current_in,
      fixed_withdrawable: t.fixed_withdrawable,
      cb_make: t.cb_make,
      cb_model: t.cb_model,
      cb_serial: t.cb_serial,
      cb_rating: t.cb_rating,
      cb_poles: t.cb_poles,
      trip_unit: t.trip_unit,
      trip_settings_ir: t.trip_settings_ir,
      trip_settings_isd: t.trip_settings_isd,
      trip_settings_ii: t.trip_settings_ii,
      trip_settings_ig: t.trip_settings_ig,
      long_time_ir: t.long_time_ir,
      long_time_delay_tr: t.long_time_delay_tr,
      short_time_pickup_isd: t.short_time_pickup_isd,
      short_time_delay_tsd: t.short_time_delay_tsd,
      instantaneous_pickup: t.instantaneous_pickup,
      earth_fault_pickup: t.earth_fault_pickup,
      earth_fault_delay: t.earth_fault_delay,
      earth_leakage_pickup: t.earth_leakage_pickup,
      earth_leakage_delay: t.earth_leakage_delay,
      motor_charge: t.motor_charge,
      shunt_trip_mx1: t.shunt_trip_mx1,
      shunt_close_xf: t.shunt_close_xf,
      undervoltage_mn: t.undervoltage_mn,
      second_shunt_trip: t.second_shunt_trip,
      overall_result: t.overall_result,
      step1_status: t.step1_status,
      step2_status: t.step2_status,
      step3_status: t.step3_status,
      active: t.is_active,
      notes: t.notes,
      visual_check_items: visualByTest.get(t.id as string) ?? [],
      electrical_readings: electricalByTest.get(t.id as string) ?? [],
    };
    return out;
  });

  return {
    schema_id: schemaId("service", "acb-test"),
    schema_version: "1.0.0",
    count: rows.length,
    rows,
  };
};

// ── Registry ────────────────────────────────────────────────────────

/**
 * All canonical entities. Stub entries return empty rows + a note so
 * consumers can see at a glance what's been wired vs what hasn't.
 */
export const ENTITY_EXPORTERS: Record<string, EntityExporter> = {
  // ── core ──
  customer: exportCustomer,
  site: exportSite,
  contact: async () => stub("core", "contact"),
  attachment: async () => stub("core", "attachment"),
  // ── service ──
  asset: exportAsset,
  service_contract: exportServiceContract,
  maintenance_plan: async () => stub("service", "maintenance-plan"),
  maintenance_plan_item: async () => stub("service", "maintenance-plan-item"),
  maintenance_check: exportMaintenanceCheck,
  check_asset: exportCheckAsset,
  check_item: exportCheckItem,
  contract_scope: async () => stub("service", "contract-scope"),
  pm_calendar: async () => stub("service", "pm-calendar"),
  acb_test: exportAcbTest,
  nsx_test: async () => stub("service", "nsx-test"),
  rcd_test: async () => stub("service", "rcd-test"),
  defect: exportDefect,
};

export const ALL_ENTITY_NAMES: readonly string[] = Object.freeze(
  Object.keys(ENTITY_EXPORTERS),
);
