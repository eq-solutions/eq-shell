/**
 * Generate an annotated field mapping document showing where each
 * dynamic field in the ACB, NSX, PM Asset and PM Check reports
 * pulls its data from.
 *
 * Run: node scripts/gen-field-map-doc.js
 * Output: Report Field Mapping Guide.docx
 */

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageBreak, VerticalAlign,
} = require('docx');
const fs = require('fs');

const PAGE_WIDTH = 11906;
const MARGIN = 1200;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const thin = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: thin, bottom: thin, left: thin, right: thin };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

function hdrCell(text, width) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: { fill: '1B4F72', type: ShadingType.CLEAR },
    margins: cellMargins, verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18, color: 'FFFFFF', font: 'Calibri' })] })],
  });
}

function cell(text, width, opts = {}) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    margins: cellMargins, verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: [new TextRun({ text, size: 17, font: 'Calibri', bold: opts.bold, italics: opts.italic, color: opts.color })],
    })],
  });
}

function sectionTitle(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    children: [new TextRun({ text, bold: true, size: 28, font: 'Calibri', color: '1B4F72' })],
  });
}

function subTitle(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, size: 22, font: 'Calibri' })],
  });
}

function note(text) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text, size: 17, font: 'Calibri', italics: true, color: '666666' })],
  });
}

function fieldTable(rows) {
  const colWidths = [Math.round(CONTENT_WIDTH * 0.25), Math.round(CONTENT_WIDTH * 0.35), Math.round(CONTENT_WIDTH * 0.40)];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({ children: [hdrCell('Field', colWidths[0]), hdrCell('Source Table / Column', colWidths[1]), hdrCell('Notes', colWidths[2])] }),
      ...rows.map(([field, source, notes]) =>
        new TableRow({ children: [cell(field, colWidths[0], { bold: true }), cell(source, colWidths[1], { color: '8B0000' }), cell(notes, colWidths[2])] })
      ),
    ],
  });
}

// ── Field definitions ──

const acbFields = [
  // Cover
  ['Site Name', 'sites.name', 'Joined via acb_tests.site_id → sites.id'],
  ['Site Code', 'sites.code', 'Optional — may be null'],
  ['Tenant / Product Name', 'tenants.name', 'From authenticated user\'s tenant'],
  ['Primary Colour', 'tenants.primary_colour', 'Hex colour for branding'],
  ['Company Name', 'tenant_settings.report_company_name', 'Report settings page'],
  ['Company Address', 'tenant_settings.report_company_address', ''],
  ['ABN', 'tenant_settings.report_company_abn', ''],
  ['Phone', 'tenant_settings.report_company_phone', ''],
  ['Logo', 'tenant_settings.report_logo_url OR media_library', 'Falls back to tenant logo if not set'],
  // Per-breaker
  ['Asset Name', 'assets.name', 'Via acb_tests.asset_id → assets.id'],
  ['Asset Type', 'assets.type', ''],
  ['Location', 'assets.location', 'Physical location string'],
  ['Asset ID / Maximo', 'assets.maximo_id', 'External reference number'],
  ['Job Plan', 'job_plans.name', 'Via assets.job_plan_id → job_plans.id'],
  ['Test Date', 'acb_tests.test_date', 'ISO date'],
  ['Tested By', 'profiles.full_name', 'Via acb_tests.tested_by → profiles.id'],
  ['Test Type', 'acb_tests.test_type', 'e.g. "Annual", "Commissioning"'],
  ['CB Make', 'acb_tests.cb_make', 'Breaker manufacturer (Step 1)'],
  ['CB Model', 'acb_tests.cb_model', 'Breaker model (Step 1)'],
  ['CB Serial', 'acb_tests.cb_serial', 'Serial number (Step 1)'],
  ['Overall Result', 'acb_tests.overall_result', 'Pass / Fail — auto-calculated or manual'],
  ['Notes', 'acb_tests.notes', 'Free text per test'],
  // Readings
  ['Reading Label', 'acb_test_readings.label', 'e.g. "Contact Resistance R", "IR Closed A-B"'],
  ['Reading Value', 'acb_test_readings.value', 'Measured value as string'],
  ['Reading Unit', 'acb_test_readings.unit', 'e.g. µΩ, MΩ, °C'],
  ['Reading Pass/Fail', 'acb_test_readings.is_pass', 'Boolean — null if N/A'],
  // Section toggles
  ['Show Cover Page', 'tenant_settings.report_show_cover_page', 'Boolean toggle'],
  ['Show Contents', 'tenant_settings.report_show_contents', ''],
  ['Show Exec Summary', 'tenant_settings.report_show_executive_summary', ''],
  ['Show Sign-off', 'tenant_settings.report_show_sign_off', ''],
  ['Sign-off Fields', 'tenant_settings.report_sign_off_fields', 'JSON array of strings'],
  ['Header Text', 'tenant_settings.report_header_text', 'Custom report header'],
  ['Footer Text', 'tenant_settings.report_footer_text', 'Custom report footer'],
];

const nsxFields = [
  // Cover — same as ACB
  ['Site Name', 'sites.name', 'Via nsx_tests.site_id → sites.id'],
  ['Site Code', 'sites.code', ''],
  ['Tenant / Product Name', 'tenants.name', ''],
  ['Primary Colour', 'tenants.primary_colour', ''],
  ['Company Name / Address / ABN / Phone', 'tenant_settings.report_company_*', 'Same as ACB report'],
  ['Logo', 'tenant_settings.report_logo_url OR media_library', ''],
  // Per-breaker
  ['Asset Name', 'assets.name', 'Via nsx_tests.asset_id → assets.id'],
  ['Location', 'assets.location', ''],
  ['Asset ID', 'assets.maximo_id', ''],
  ['Test Date', 'nsx_tests.test_date', ''],
  ['Tested By', 'profiles.full_name', 'Via nsx_tests.tested_by'],
  ['Test Type', 'nsx_tests.test_type', ''],
  ['CB Make', 'nsx_tests.cb_make', 'Breaker manufacturer (Step 1)'],
  ['CB Model', 'nsx_tests.cb_model', ''],
  ['CB Serial', 'nsx_tests.cb_serial', ''],
  ['CB Rating', 'nsx_tests.cb_rating_in', 'Nominal current IN'],
  ['CB Poles', 'nsx_tests.cb_poles', '3P, 4P etc'],
  ['Trip Unit', 'nsx_tests.trip_unit_model', 'Trip unit model name'],
  ['Overall Result', 'nsx_tests.overall_result', 'Pass / Fail'],
  ['Notes', 'nsx_tests.notes', ''],
  // Readings
  ['Reading Label', 'nsx_test_readings.label', ''],
  ['Reading Value', 'nsx_test_readings.value', ''],
  ['Reading Unit', 'nsx_test_readings.unit', ''],
  ['Reading Pass/Fail', 'nsx_test_readings.is_pass', ''],
  // Section toggles — same as ACB
  ['Section Toggles', 'tenant_settings.report_show_*', 'Same toggles as ACB'],
  ['Sign-off / Header / Footer', 'tenant_settings.report_sign_off_fields / _header_text / _footer_text', ''],
];

const pmAssetFields = [
  // Cover & site info
  ['Report Title', 'Composed: "{site_code} - {frequency} - {date} - {custom_name}"', 'Built from multiple check fields'],
  ['Site Name', 'sites.name', 'Via maintenance_checks.site_id → sites.id'],
  ['Site Code', 'sites.code', ''],
  ['Site Address', 'sites.address', ''],
  ['Customer Name', 'customers.name', 'Via sites.customer_id → customers.id'],
  ['Supervisor Name', 'profiles.full_name', 'Assigned user on the check'],
  ['Contact Email/Phone', 'tenants contact or report settings', ''],
  ['Start Date', 'maintenance_checks.started_at', 'When check was started'],
  ['Due Date', 'maintenance_checks.due_date', ''],
  ['Completed Date', 'maintenance_checks.completed_at', ''],
  ['Outstanding Assets', 'Calculated', 'Count of check_assets where status != completed'],
  ['Outstanding WOs', 'Calculated', 'Count of check_assets where work_order_number is null'],
  ['Technician Name', 'profiles.full_name', 'Check assignee'],
  ['Reviewer Name', 'May be null', 'Not currently tracked — placeholder'],
  // Branding
  ['Tenant Product Name', 'tenants.name', ''],
  ['Primary Colour', 'tenants.primary_colour', ''],
  ['Logo', 'tenant_settings.report_logo_url / media_library', ''],
  ['Site Photo', 'media_library (category: site_photo)', 'First photo for the site'],
  // Per-asset section
  ['Asset Name', 'assets.name', 'Via check_assets.asset_id → assets.id'],
  ['Asset Maximo ID', 'assets.maximo_id', ''],
  ['Asset Location', 'assets.location', ''],
  ['Job Plan Name', 'job_plans.name + job_plans.type', 'Via assets.job_plan_id'],
  ['Task Description', 'maintenance_check_items.description', 'From job_plan_items template'],
  ['Task Result', 'maintenance_check_items.result', 'pass / fail / na / null'],
  ['Task Notes', 'maintenance_check_items.notes', 'Technician comments'],
  ['Defects Found', 'check_assets.defects_found', 'Placeholder — not yet populated'],
  ['Recommended Action', 'check_assets.recommended_action', 'Placeholder'],
  ['Technician (per asset)', 'profiles.full_name', 'From check assignee'],
  ['Completed Date (per asset)', 'check_assets.completed_at', ''],
  ['Asset Notes', 'check_assets.notes', ''],
  // Section toggles
  // (report_show_site_overview removed 26-Apr-2026 — site overview always rendered.)
  ['Show Cover Page', 'tenant_settings.report_show_cover_page', ''],
  ['Show Contents', 'tenant_settings.report_show_contents', ''],
  ['Show Exec Summary', 'tenant_settings.report_show_executive_summary', ''],
  ['Show Sign-off', 'tenant_settings.report_show_sign_off', ''],
  ['Sign-off Fields', 'tenant_settings.report_sign_off_fields', ''],
  ['Header / Footer Text', 'tenant_settings.report_header_text / _footer_text', ''],
];

const pmCheckFields = [
  ['Check ID', 'maintenance_checks.id', 'UUID'],
  ['Site Name', 'sites.name', 'Via maintenance_checks.site_id'],
  ['Job Plan Name', 'job_plans.name', 'Via maintenance_checks.job_plan_id'],
  ['Check Date', 'maintenance_checks.created_at', ''],
  ['Due Date', 'maintenance_checks.due_date', ''],
  ['Started At', 'maintenance_checks.started_at', ''],
  ['Completed At', 'maintenance_checks.completed_at', ''],
  ['Status', 'maintenance_checks.status', 'scheduled/in_progress/complete/cancelled/overdue'],
  ['Assigned To', 'profiles.full_name', 'Via maintenance_checks.assignee_id'],
  ['Tenant Product Name', 'tenants.name', ''],
  ['Primary Colour', 'tenants.primary_colour', ''],
  // Items
  ['Item Number', 'maintenance_check_items.sort_order', 'Sequential within check'],
  ['Item Description', 'maintenance_check_items.description', 'Task text'],
  ['Item Result', 'maintenance_check_items.result', 'pass / fail / na / null'],
  ['Item Notes', 'maintenance_check_items.notes', 'Technician comments'],
  ['Completed By', 'Not currently tracked per-item', 'Uses check assignee'],
  ['Completed At (item)', 'maintenance_check_items.updated_at', 'Timestamp of last update'],
];

// ── Build document ──

const children = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 1200, after: 200 },
    children: [new TextRun({ text: 'Report Field Mapping Guide', bold: true, size: 44, color: '1B4F72', font: 'Calibri' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: 'EQ Solves — Where Every Report Field Comes From', size: 22, color: '666666', font: 'Calibri' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({ text: `Generated: ${new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })}`, size: 18, color: '999999', font: 'Calibri' })],
  }),
  note('This document maps every dynamic field in each report type to its database source. Use it to understand where data is pulled from and what needs to be populated for complete reports.'),
  new Paragraph({ children: [new PageBreak()] }),

  // ACB
  sectionTitle('1. ACB Test Report'),
  note('Generated from: /api/acb-report — one report per site containing all ACB tests. Covers Asset Collection (Step 1), Visual & Functional (Step 2), and Electrical Testing (Step 3).'),
  subTitle('Cover Page & Branding'),
  fieldTable(acbFields.slice(0, 9)),
  subTitle('Per-Breaker Fields'),
  fieldTable(acbFields.slice(9, 22)),
  subTitle('Reading Values (from acb_test_readings)'),
  fieldTable(acbFields.slice(22, 26)),
  subTitle('Report Section Toggles'),
  fieldTable(acbFields.slice(26)),
  new Paragraph({ children: [new PageBreak()] }),

  // NSX
  sectionTitle('2. NSX / MCCB Test Report'),
  note('Generated from: /api/nsx-report — similar structure to ACB but with NSX-specific fields (rating, poles, trip unit). Steps 2 & 3 are scaffolded pending field-set finalisation.'),
  subTitle('Cover Page & Branding'),
  fieldTable(nsxFields.slice(0, 6)),
  subTitle('Per-Breaker Fields'),
  fieldTable(nsxFields.slice(6, 20)),
  subTitle('Reading Values (from nsx_test_readings)'),
  fieldTable(nsxFields.slice(20, 24)),
  subTitle('Report Section Toggles'),
  fieldTable(nsxFields.slice(24)),
  new Paragraph({ children: [new PageBreak()] }),

  // PM Asset
  sectionTitle('3. PM Asset Report'),
  note('Generated from: /api/pm-asset-report — the most complex report. One report per maintenance check with cover page, site overview, executive summary, per-asset sections with task checklists, and sign-off.'),
  subTitle('Cover Page & Site Information'),
  fieldTable(pmAssetFields.slice(0, 14)),
  subTitle('Branding & Media'),
  fieldTable(pmAssetFields.slice(14, 18)),
  subTitle('Per-Asset Section'),
  fieldTable(pmAssetFields.slice(18, 31)),
  subTitle('Report Section Toggles'),
  fieldTable(pmAssetFields.slice(31)),
  new Paragraph({ children: [new PageBreak()] }),

  // PM Check (called via the Send-Report pipeline; the standalone /api/pm-report
  // route was removed 26-Apr-2026 along with the orphaned CheckHeader UI).
  sectionTitle('4. PM Check Report'),
  note('Generated by lib/reports/pm-check-report.ts via lib/reports/generate-and-store.ts (Send Report pipeline). Simpler check-level report with pass/fail summary and item list. No per-asset breakdown.'),
  subTitle('Check-Level Fields'),
  fieldTable(pmCheckFields.slice(0, 11)),
  subTitle('Check Item Fields'),
  fieldTable(pmCheckFields.slice(11)),
  new Paragraph({ children: [new PageBreak()] }),

  // Compliance
  sectionTitle('5. Compliance Dashboard Report (NEW)'),
  note('Generated from: /api/compliance-report — filterable by customer, site, and date range. Designed for monthly meetings. Aggregates data from maintenance_checks, test_records, acb_tests, nsx_tests, and defects tables.'),
  subTitle('Key Data Sources'),
  fieldTable([
    ['Maintenance Compliance', 'maintenance_checks.status', 'Counts by status: complete/in_progress/scheduled/overdue/cancelled'],
    ['Test Pass Rate', 'test_records.result + acb_tests.overall_result + nsx_tests.overall_result', 'Combined across all 3 test types'],
    ['ACB Progress', 'acb_tests.step1/2/3_status', 'Count of complete vs in-progress vs not started'],
    ['NSX Progress', 'nsx_tests.step1/2/3_status', 'Same as ACB'],
    ['Defects Summary', 'defects.status + defects.severity', 'Open/in_progress/resolved + critical/high/medium/low'],
    ['Compliance by Site', 'maintenance_checks grouped by site_id', 'Top 10 sites by maintenance volume'],
    ['6-Month Trend', 'test_records.test_date + maintenance_checks.due_date', 'Monthly counts over last 6 months'],
    ['Customer Filter', 'sites.customer_id → customers.id', 'Filters all data to sites belonging to selected customer'],
    ['Site Filter', 'Direct site_id match', 'Applied to all queries'],
    ['Date Range', 'due_date / test_date / created_at', 'From/To applied per table\'s date column'],
  ]),
];

const doc = new Document({
  sections: [{
    properties: {
      page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } },
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buffer => {
  const outPath = process.argv[2] || 'Report Field Mapping Guide.docx';
  fs.writeFileSync(outPath, buffer);
  console.log(`Written: ${outPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
});
