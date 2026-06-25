/**
 * Central label registry for canonical entity and field names.
 *
 * entityLabel() — plural display name for a canonical entity.
 * fieldLabel()  — human-readable label for a DB column key.
 *                 Falls back to auto-casing for unknown keys so nothing
 *                 shows raw snake_case in the UI.
 */

import type { CanonicalEntity } from "../canonical/commit-canonical.js";

// ── Entity labels ─────────────────────────────────────────────────────────────

const ENTITY_MAP: Record<string, string> = {
  // singular canonical keys
  customer:  "Customers",
  site:      "Sites",
  contact:   "Contacts",
  staff:     "Staff",
  licence:   "Licences",
  asset:     "Assets",
  // plural variants (returned by health-score / tidy modules)
  customers: "Customers",
  sites:     "Sites",
  contacts:  "Contacts",
  licences:  "Licences",
  assets:    "Assets",
};

export function entityLabel(entity: CanonicalEntity | string): string {
  return ENTITY_MAP[entity] ?? String(entity);
}

// ── Field labels ──────────────────────────────────────────────────────────────

// Known acronyms — always rendered uppercased regardless of position.
const ACRONYMS = new Set(["abn", "acn", "tfn", "id", "abr", "gst", "dob", "url"]);

/**
 * Convert a snake_case key to a readable label.
 * Specific entries override the generic auto-casing.
 */
function autoLabel(key: string): string {
  return key
    .split("_")
    .map((word) =>
      ACRONYMS.has(word)
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

const FIELD_MAP: Record<string, string> = {
  // ── Identity ────────────────────────────────────────────────────────────────
  id:               "ID",
  first_name:       "First Name",
  last_name:        "Last Name",
  full_name:        "Full Name",
  preferred_name:   "Preferred Name",
  date_of_birth:    "Date of Birth",
  gender:           "Gender",

  // ── Organisation ────────────────────────────────────────────────────────────
  company_name:     "Company",
  trading_name:     "Trading Name",
  abn:              "ABN",
  acn:              "ACN",
  tfn:              "TFN",

  // ── Contact ─────────────────────────────────────────────────────────────────
  email:            "Email",
  phone:            "Phone",
  mobile:           "Mobile",
  fax:              "Fax",
  website:          "Website",
  job_title:        "Job Title",
  department:       "Department",
  contact_name:     "Contact Name",

  // ── Address ─────────────────────────────────────────────────────────────────
  address:          "Address",
  address_line_1:   "Address Line 1",
  address_line_2:   "Address Line 2",
  suburb:           "Suburb",
  city:             "City",
  state:            "State",
  postcode:         "Postcode",
  country:          "Country",

  // ── Site ────────────────────────────────────────────────────────────────────
  site_name:        "Site Name",
  site_code:        "Site Code",
  site_type:        "Site Type",

  // ── Asset / plant ───────────────────────────────────────────────────────────
  asset_name:       "Asset Name",
  asset_type:       "Asset Type",
  serial_number:    "Serial No.",
  plant_number:     "Plant No.",
  make:             "Make",
  model:            "Model",
  year:             "Year",
  registration:     "Registration",
  odometer:         "Odometer",
  engine_number:    "Engine No.",

  // ── Licence ─────────────────────────────────────────────────────────────────
  licence_number:   "Licence No.",
  licence_type:     "Licence Type",
  licence_class:    "Licence Class",
  driver_license:   "Driver Licence",
  driver_licence:   "Driver Licence",
  expiry_date:      "Expiry Date",
  issue_date:       "Issue Date",
  issued_by:        "Issued By",
  conditions:       "Conditions",

  // ── Staff ────────────────────────────────────────────────────────────────────
  staff_id:         "Staff ID",
  employee_id:      "Employee ID",
  start_date:       "Start Date",
  end_date:         "End Date",
  employment_type:  "Employment Type",
  pay_rate:         "Pay Rate",
  trade:            "Trade",
  classification:   "Classification",

  // ── Common metadata ─────────────────────────────────────────────────────────
  status:           "Status",
  category:         "Category",
  notes:            "Notes",
  description:      "Description",
  is_active:        "Active",
  active:           "Active",
  created_at:       "Created",
  updated_at:       "Updated",
  tenant_id:        "Tenant ID",
};

export function fieldLabel(key: string): string {
  return FIELD_MAP[key] ?? autoLabel(key);
}
