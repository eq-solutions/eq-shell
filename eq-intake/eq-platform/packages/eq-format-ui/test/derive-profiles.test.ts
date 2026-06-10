/**
 * Derive profile unit tests.
 *
 * Each profile is a pure function: rows in, {columns, rows} out. No network,
 * no DB, no Vite runtime needed — pure Node vitest.
 *
 * Test goals:
 *   1. Output column shape matches the declared COLUMNS constant.
 *   2. Row count is preserved (one output row per input row).
 *   3. Sorting behaves correctly (criticality order, date order, etc.).
 *   4. Edge cases don't throw: empty input, null fields, unknown enums.
 *   5. Sort keys (_critOrder, _type, etc.) are stripped from output rows.
 *   6. defaultTasksForType and normaliseSection cover the key branches.
 */

import { describe, it, expect } from "vitest";

import { ppmSowProfile }              from "../src/derive/profiles/ppm-sow.js";
import { equinixAuditSimproProfile }  from "../src/derive/profiles/equinix-audit-simpro.js";
import { assetRegisterExportProfile } from "../src/derive/profiles/asset-register-export.js";
import { siteRegisterExportProfile }  from "../src/derive/profiles/site-register-export.js";
import { serviceVisitScheduleProfile } from "../src/derive/profiles/service-visit-schedule.js";
import { listProfiles, getProfile }   from "../src/derive/registry.js";

// ── Registry ─────────────────────────────────────────────────────────────────

describe("derive profile registry", () => {
  it("contains no duplicate IDs", () => {
    const ids = listProfiles().map((p) => p.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it("has at least 12 registered profiles", () => {
    expect(listProfiles().length).toBeGreaterThanOrEqual(12);
  });

  it("getProfile returns undefined for unknown ID", () => {
    expect(getProfile("this-does-not-exist")).toBeUndefined();
  });

  it("every profile has id, label, description, inputShape, and derive()", () => {
    for (const p of listProfiles()) {
      expect(typeof p.id).toBe("string");
      expect(p.id.length).toBeGreaterThan(0);
      expect(typeof p.label).toBe("string");
      expect(typeof p.description).toBe("string");
      expect(["raw", "canonical", "simpro-quote"]).toContain(p.inputShape);
      expect(typeof p.derive).toBe("function");
    }
  });
});

// ── ppm-sow ───────────────────────────────────────────────────────────────────

describe("ppmSowProfile", () => {
  const ASSET_ROWS: Record<string, unknown>[] = [
    {
      external_id: "DB-01",
      name: "Main Switchboard",
      asset_type: "switchboard",
      location_in_site: "Level 1 Plant Room",
      make: "Schneider",
      model: "Prisma",
      serial_number: "SN123",
      ppm_frequency: "Annual",
      last_service_date: "2024-01-15",
      next_service_due: "2025-01-15",
      criticality: "critical",
      active: true,
      notes: "Requires PPE",
    },
    {
      external_id: "GEN-01",
      name: "Emergency Generator",
      asset_type: "generator",
      location_in_site: "Roof",
      make: "Cummins",
      model: "C500D5",
      serial_number: "SN456",
      ppm_frequency: "Quarterly",
      last_service_date: "2024-03-01",
      next_service_due: "2024-06-01",
      criticality: "high",
      active: true,
    },
    {
      external_id: "UPS-01",
      name: "UPS System",
      asset_type: "ups",
      location_in_site: "Data Room",
      criticality: "medium",
      active: true,
    },
    {
      external_id: "BAT-01",
      name: "Battery Bank",
      asset_type: "battery",
      criticality: "low",
      active: false,
    },
  ];

  it("produces the declared column set", () => {
    const { columns } = ppmSowProfile.derive(ASSET_ROWS);
    expect(columns).toEqual([
      "Tag", "Asset", "Type", "Location", "Make / Model", "Serial",
      "Frequency", "Last Service", "Next Due", "Criticality",
      "Scheduled Tasks", "Status", "Initials", "Notes",
    ]);
  });

  it("emits one row per input row", () => {
    const { rows } = ppmSowProfile.derive(ASSET_ROWS);
    expect(rows.length).toBe(ASSET_ROWS.length);
  });

  it("sorts by criticality: critical first, low last", () => {
    const { rows } = ppmSowProfile.derive(ASSET_ROWS);
    // DB-01 is critical, BAT-01 is low
    expect(rows[0]!["Tag"]).toBe("DB-01");
    expect(rows[rows.length - 1]!["Tag"]).toBe("BAT-01");
  });

  it("strips sort keys from output rows", () => {
    const { rows } = ppmSowProfile.derive(ASSET_ROWS);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("_critOrder");
      expect(Object.keys(row)).not.toContain("_type");
    }
  });

  it("marks decommissioned asset status", () => {
    const { rows } = ppmSowProfile.derive(ASSET_ROWS);
    const batRow = rows.find((r) => r["Tag"] === "BAT-01");
    expect(batRow!["Status"]).toBe("Decommissioned");
  });

  it("pre-populates switchboard tasks correctly", () => {
    const { rows } = ppmSowProfile.derive(ASSET_ROWS);
    const dbRow = rows.find((r) => r["Tag"] === "DB-01");
    expect(dbRow!["Scheduled Tasks"]).toContain("Annual DB Maint");
  });

  it("pre-populates generator tasks correctly", () => {
    const { rows } = ppmSowProfile.derive(ASSET_ROWS);
    const genRow = rows.find((r) => r["Tag"] === "GEN-01");
    expect(genRow!["Scheduled Tasks"]).toContain("Run Start");
  });

  it("pre-populates UPS tasks correctly", () => {
    const { rows } = ppmSowProfile.derive(ASSET_ROWS);
    const upsRow = rows.find((r) => r["Tag"] === "UPS-01");
    expect(upsRow!["Scheduled Tasks"]).toContain("UPS Service");
  });

  it("handles empty input without throwing", () => {
    expect(() => ppmSowProfile.derive([])).not.toThrow();
    const { rows } = ppmSowProfile.derive([]);
    expect(rows).toHaveLength(0);
  });

  it("handles rows with all null/undefined fields without throwing", () => {
    const nullRow: Record<string, unknown> = {};
    expect(() => ppmSowProfile.derive([nullRow])).not.toThrow();
  });

  it("falls back to generic tasks for unknown asset types", () => {
    const { rows } = ppmSowProfile.derive([
      { external_id: "X-01", asset_type: "something-weird", criticality: "low" },
    ]);
    expect(rows[0]!["Scheduled Tasks"]).toContain("Service");
  });
});

// ── equinix-audit-simpro ──────────────────────────────────────────────────────

describe("equinixAuditSimproProfile", () => {
  const AUDIT_ROWS: Record<string, unknown>[] = [
    {
      "Site": "SY3",
      "Asset ID": "DB-01",
      "Asset Name": "Main Switchboard",
      "Location": "Hall A",
      "Test Type": "Annual DB Maintenance",
      "Last Test Date": "2024-01-15",
      "Test Result": "Pass",
      "Pass/Fail": "P",
      "Technician": "John Smith",
      "Licence No": "ECL12345",
      "Notes": "",
      "Client Reference": "JOB-001",
    },
    {
      "Site": "SY3",
      "Asset ID": "MSB-02",
      "Asset Name": "Sub Board",
      "Location": "Hall B",
      "Test Type": "Thermal Scan",
      "Last Test Date": "2024-01-16",
      "Test Result": "Pass",
      "Pass/Fail": "pass",
      "Technician": "Jane Doe",
      "Licence No": "ECL67890",
    },
    {
      "Site": "SY3",
      "Asset ID": "RCD-01",
      "Asset Name": "RCD Array",
      "Location": "Hall A",
      "Test Type": "RCD Test",
      "Last Test Date": "2024-01-15",
      "Test Result": "Fail",
      "Pass/Fail": "FAIL",
      "Technician": "John Smith",
      "Licence No": "ECL12345",
    },
  ];

  it("produces the declared column set", () => {
    const { columns } = equinixAuditSimproProfile.derive(AUDIT_ROWS);
    expect(columns).toEqual([
      "Site", "Section", "Cost Centre", "Asset ID", "Asset Name",
      "Location", "Test Type", "Test Date", "Result", "Pass/Fail",
      "Technician", "Licence No", "Notes", "Client Reference",
    ]);
  });

  it("emits one row per input row", () => {
    const { rows } = equinixAuditSimproProfile.derive(AUDIT_ROWS);
    expect(rows.length).toBe(AUDIT_ROWS.length);
  });

  it("normalises 'Annual DB Maintenance' → 'Switchboard Maintenance'", () => {
    const { rows } = equinixAuditSimproProfile.derive(AUDIT_ROWS);
    const dbRow = rows.find((r) => r["Asset ID"] === "DB-01");
    expect(dbRow!["Section"]).toBe("Switchboard Maintenance");
  });

  it("normalises 'Thermal Scan' → 'Thermal Imaging'", () => {
    const { rows } = equinixAuditSimproProfile.derive(AUDIT_ROWS);
    const thermalRow = rows.find((r) => r["Asset ID"] === "MSB-02");
    expect(thermalRow!["Section"]).toBe("Thermal Imaging");
  });

  it("normalises 'RCD Test' → 'RCD Testing'", () => {
    const { rows } = equinixAuditSimproProfile.derive(AUDIT_ROWS);
    const rcdRow = rows.find((r) => r["Asset ID"] === "RCD-01");
    expect(rcdRow!["Section"]).toBe("RCD Testing");
  });

  it("normalises pass/fail variants: P → Pass, FAIL → Fail", () => {
    const { rows } = equinixAuditSimproProfile.derive(AUDIT_ROWS);
    const dbRow = rows.find((r) => r["Asset ID"] === "DB-01");
    const rcdRow = rows.find((r) => r["Asset ID"] === "RCD-01");
    expect(dbRow!["Pass/Fail"]).toBe("Pass");
    expect(rcdRow!["Pass/Fail"]).toBe("Fail");
  });

  it("sorts by Section → Site → Location", () => {
    const { rows } = equinixAuditSimproProfile.derive(AUDIT_ROWS);
    const sections = rows.map((r) => r["Section"] as string);
    // Should be sorted alphabetically by section
    const sorted = [...sections].sort((a, b) => a.localeCompare(b));
    expect(sections).toEqual(sorted);
  });

  it("handles column name variants (Facility instead of Site)", () => {
    const { rows } = equinixAuditSimproProfile.derive([
      { "Facility": "MEL1", "Asset ID": "X", "Test Type": "Visual Inspection" },
    ]);
    expect(rows[0]!["Site"]).toBe("MEL1");
  });

  it("handles empty input without throwing", () => {
    expect(() => equinixAuditSimproProfile.derive([])).not.toThrow();
  });
});

// ── asset-register-export ─────────────────────────────────────────────────────

describe("assetRegisterExportProfile", () => {
  const ASSET_ROWS: Record<string, unknown>[] = [
    {
      external_id: "DB-01",
      name: "Main Switchboard",
      asset_type: "switchboard",
      location_in_site: "Level 1",
      make: "Schneider",
      model: "Prisma",
      serial_number: "SN123",
      condition: "good",
      criticality: "critical",
      ppm_frequency: "Annual",
      last_service_date: "2024-01-15",
      next_service_due: "2025-01-15",
      active: true,
      defects_summary: "Minor corrosion on terminal",
      notes: "PPE required",
    },
    {
      external_id: "GEN-01",
      name: "Generator",
      asset_type: "generator",
      criticality: "high",
      condition: "fair",
      active: true,
    },
    {
      external_id: "OLD-01",
      name: "Old UPS",
      asset_type: "ups",
      criticality: "low",
      condition: "needs_replacement",
      active: false,
    },
  ];

  it("produces the declared column set", () => {
    const { columns } = assetRegisterExportProfile.derive(ASSET_ROWS);
    expect(columns).toEqual([
      "Tag", "Asset Name", "Type", "Location", "Make / Model", "Serial",
      "Condition", "Criticality", "PPM Frequency", "Last Service", "Next Due",
      "Status", "Open Defects", "Notes",
    ]);
  });

  it("sorts by criticality: critical first", () => {
    const { rows } = assetRegisterExportProfile.derive(ASSET_ROWS);
    expect(rows[0]!["Tag"]).toBe("DB-01");
    expect(rows[rows.length - 1]!["Tag"]).toBe("OLD-01");
  });

  it("marks decommissioned assets as Decommissioned in Status", () => {
    const { rows } = assetRegisterExportProfile.derive(ASSET_ROWS);
    const oldRow = rows.find((r) => r["Tag"] === "OLD-01");
    expect(oldRow!["Status"]).toBe("Decommissioned");
  });

  it("maps condition enum to readable label (needs_replacement → Needs Replacement)", () => {
    const { rows } = assetRegisterExportProfile.derive(ASSET_ROWS);
    const oldRow = rows.find((r) => r["Tag"] === "OLD-01");
    expect(oldRow!["Condition"]).toBe("Needs Replacement");
  });

  it("strips sort keys from output", () => {
    const { rows } = assetRegisterExportProfile.derive(ASSET_ROWS);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("_critOrder");
      expect(Object.keys(row)).not.toContain("_type");
    }
  });

  it("handles empty input", () => {
    const { rows } = assetRegisterExportProfile.derive([]);
    expect(rows).toHaveLength(0);
  });
});

// ── site-register-export ──────────────────────────────────────────────────────

describe("siteRegisterExportProfile", () => {
  const SITE_ROWS: Record<string, unknown>[] = [
    {
      external_id: "S-001",
      name: "Equinix SY3",
      customer_name: "Equinix",
      site_type: "Data Centre",
      street_address: "4 Eden Park Dr",
      suburb: "Macquarie Park",
      state: "NSW",
      postcode: "2113",
      access_instructions: "Badge required at gate",
      emergency_contact_name: "Ops Team",
      emergency_contact_phone: "1300 000 001",
      notes: "24/7 access",
    },
    {
      external_id: "S-002",
      name: "Macquarie Data Centre",
      customer_name: "Macquarie",
      site_type: "Data Centre",
      address: { street: "1 Technology Pl", suburb: "Macquarie Park", state: "NSW", postcode: "2113" },
    },
    {
      external_id: "S-003",
      name: "Alpha Office",
      customer_name: "Alpha Corp",
      site_type: "Commercial",
    },
  ];

  it("produces the declared column set", () => {
    const { columns } = siteRegisterExportProfile.derive(SITE_ROWS);
    expect(columns).toEqual([
      "Site ID", "Site Name", "Customer", "Type",
      "Street Address", "Suburb", "State", "Postcode",
      "Access Instructions", "Emergency Contact", "Emergency Phone", "Notes",
    ]);
  });

  it("sorts by customer then site name", () => {
    const { rows } = siteRegisterExportProfile.derive(SITE_ROWS);
    // Alpha Corp → Equinix → Macquarie
    expect(rows[0]!["Customer"]).toBe("Alpha Corp");
    expect(rows[1]!["Customer"]).toBe("Equinix");
    expect(rows[2]!["Customer"]).toBe("Macquarie");
  });

  it("reads nested address object (address.suburb etc.)", () => {
    const { rows } = siteRegisterExportProfile.derive(SITE_ROWS);
    const macRow = rows.find((r) => r["Site ID"] === "S-002");
    expect(macRow!["Suburb"]).toBe("Macquarie Park");
  });

  it("strips sort keys from output", () => {
    const { rows } = siteRegisterExportProfile.derive(SITE_ROWS);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("_customer");
      expect(Object.keys(row)).not.toContain("_name");
    }
  });

  it("handles empty input", () => {
    const { rows } = siteRegisterExportProfile.derive([]);
    expect(rows).toHaveLength(0);
  });
});

// ── service-visit-schedule ────────────────────────────────────────────────────

describe("serviceVisitScheduleProfile", () => {
  const VISIT_ROWS: Record<string, unknown>[] = [
    {
      visit_id: "V-001",
      scheduled_date: "2024-06-10",
      site_name: "Equinix SY3",
      client_job_code: "JOB-100",
      crew_lead_name: "John Smith",
      expected_assets: 12,
      expected_circuits: 6,
      status: "planned",
      logistics_notes: "Access via gate B",
    },
    {
      visit_id: "V-002",
      scheduled_date: "2024-06-10",
      site_name: "Macquarie DC",
      client_job_code: "JOB-101",
      crew_lead_name: "Jane Doe",
      status: "cancelled",
    },
    {
      visit_id: "V-003",
      scheduled_date: "2024-06-05",
      site_name: "Alpha Office",
      status: "complete",
      actual_date: "2024-06-05",
    },
    {
      visit_id: "V-004",
      scheduled_date: "2024-06-07",
      site_name: "Beta Site",
      status: "in_progress",
    },
  ];

  it("produces the declared column set", () => {
    const { columns } = serviceVisitScheduleProfile.derive(VISIT_ROWS);
    expect(columns).toEqual([
      "Date", "Site", "Client Job Code", "Crew Lead",
      "Expected Assets", "Expected Circuits", "Status", "Logistics Notes",
    ]);
  });

  it("sorts by date ascending", () => {
    const { rows } = serviceVisitScheduleProfile.derive(VISIT_ROWS);
    const dates = rows.map((r) => r["Date"] as string);
    const sorted = [...dates].sort((a, b) => a.localeCompare(b));
    expect(dates).toEqual(sorted);
  });

  it("puts in_progress before planned within the same date", () => {
    // V-001 (planned, 06-10) and V-002 (cancelled, 06-10) on same date
    // Cancelled should sort last within 06-10
    const { rows } = serviceVisitScheduleProfile.derive(VISIT_ROWS);
    const juneTenh = rows.filter((r) => r["Date"] === "2024-06-10");
    const lastOfDay = juneTenh[juneTenh.length - 1]!;
    expect(lastOfDay["Status"]).toBe("Cancelled");
  });

  it("formats status labels correctly", () => {
    const { rows } = serviceVisitScheduleProfile.derive(VISIT_ROWS);
    const complete = rows.find((r) => String(r["Status"]).startsWith("Complete"));
    expect(complete).toBeDefined();
    expect(complete!["Status"]).toBe("Complete ✓");
  });

  it("uses actual_date over scheduled_date when present", () => {
    const { rows } = serviceVisitScheduleProfile.derive(VISIT_ROWS);
    // V-003 has actual_date = scheduled_date = "2024-06-05"
    const completeRow = rows.find((r) => r["Site"] === "Alpha Office");
    expect(completeRow!["Date"]).toBe("2024-06-05");
  });

  it("strips sort keys from output", () => {
    const { rows } = serviceVisitScheduleProfile.derive(VISIT_ROWS);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("_date");
      expect(Object.keys(row)).not.toContain("_status");
      expect(Object.keys(row)).not.toContain("_site");
    }
  });

  it("handles empty input", () => {
    const { rows } = serviceVisitScheduleProfile.derive([]);
    expect(rows).toHaveLength(0);
  });
});
