/**
 * Built-in destination templates. Each is a one-file definition that
 * shows up in the picker automatically.
 *
 * Adding a new pre-built route is one TS object: name + required source
 * roles + ordered output columns + per-column value function. The engine
 * (`renderTemplate`) handles everything else.
 *
 * Pre-built templates:
 *   1. SimPRO customer rollup (SharePoint paste) — the original
 *   2. Xero ContactsImport.csv — Xero's documented import shape
 *   3. MYOB AccountRight Card File import
 *   4. Outlook contacts (CSV from Outlook desktop)
 *
 * User-supplied templates are constructed at runtime from a CSV the user
 * drops in (see RollupDropZone). Same engine, same output shape.
 */

import type { DestinationTemplate } from "./template.js";
import {
  field,
  staticValue,
  siteCount,
  siteRollup,
  contactCount,
  contactRollup,
  defaultContactField,
  site,
  siteAddress,
  linkedCustomerIds,
  linkedCustomerNames,
} from "./template.js";

// ============================================================================
// SimPRO customer rollup → SharePoint paste (the original)
// ============================================================================

const SIMPRO_CUSTOMER_ROLLUP: DestinationTemplate = {
  id: "simpro-customer-rollup",
  name: "SimPRO customer rollup → SharePoint paste",
  description:
    "One row per customer. Sites and contacts concatenated into pipe-separated cells. Designed for pasting into a SharePoint list.",
  destinationLabel: "SharePoint",
  requiredRoles: ["customer", "contact", "site"],
  origin: "builtin",
  columns: [
    { name: "simPRO Customer ID", value: field("simPRO Customer ID") },
    { name: "Company Name",      value: field("Company Name") },
    { name: "Customer Type",     value: field("Type") },
    { name: "ABN",               value: field("ABN") },
    { name: "Street Address",    value: field("Street Address") },
    { name: "Suburb",            value: field("Suburb") },
    { name: "State",             value: field("State") },
    { name: "Postcode",          value: field("Postcode") },
    { name: "Primary Phone",     value: field("Primary Phone") },
    { name: "Mobile Phone",      value: field("Mobile Phone") },
    { name: "Email",             value: field("Email") },
    { name: "Website",           value: field("Website") },
    { name: "Customer Group",    value: field("Customer Group") },
    { name: "Account Manager",   value: field("Account Manager") },
    { name: "Default Quote Method", value: field("Default Quote Method") },
    { name: "Notes",             value: field("Notes") },
    { name: "Create Date",       value: field("Create Date") },
    { name: "Site Count",        value: siteCount() },
    { name: "Sites",             value: siteRollup() },
    { name: "Contact Count",     value: contactCount() },
    { name: "Contacts",          value: contactRollup() },
  ],
};

// ============================================================================
// SimPRO → Xero ContactsImport.csv
// Documented Xero contacts import format. Pulls primary phone/email from
// the default-quote-contact when one exists, falls back to customer record.
// ============================================================================

const XERO_CONTACTS_IMPORT: DestinationTemplate = {
  id: "xero-contacts-import",
  name: "SimPRO customers → Xero ContactsImport.csv",
  description:
    "One row per customer in Xero's documented Contacts import shape. Pulls primary contact details from the customer's default-quote contact when available.",
  destinationLabel: "Xero",
  requiredRoles: ["customer"],
  origin: "builtin",
  columns: [
    { name: "*ContactName",                value: field("Company Name") },
    { name: "AccountNumber",               value: field("simPRO Customer ID") },
    { name: "EmailAddress",                value: ({ customer, contacts }) => {
      const def = contacts.find((c) => isTruthy(c["Is Default Invoice Contact"]));
      const fromContact = def ? str(def["Contact Email"]) : "";
      return fromContact || str(customer["Email"]);
    } },
    { name: "FirstName",                   value: defaultContactField("Contact First Name", "Is Default Invoice Contact") },
    { name: "LastName",                    value: defaultContactField("Contact Last Name", "Is Default Invoice Contact") },
    { name: "POAttentionTo",               value: () => "" },
    { name: "POAddressLine1",              value: field("Postal Address") },
    { name: "POAddressLine2",              value: () => "" },
    { name: "POAddressLine3",              value: () => "" },
    { name: "POAddressLine4",              value: () => "" },
    { name: "POCity",                      value: field("Postal Suburb") },
    { name: "PORegion",                    value: field("Postal State") },
    { name: "POPostalCode",                value: field("Postal Postcode") },
    { name: "POCountry",                   value: field("Postal Country") },
    { name: "SAAttentionTo",               value: () => "" },
    { name: "SAAddressLine1",              value: field("Street Address") },
    { name: "SAAddressLine2",              value: () => "" },
    { name: "SAAddressLine3",              value: () => "" },
    { name: "SAAddressLine4",              value: () => "" },
    { name: "SACity",                      value: field("Suburb") },
    { name: "SARegion",                    value: field("State") },
    { name: "SAPostalCode",                value: field("Postcode") },
    { name: "SACountry",                   value: field("Country") },
    { name: "PhoneNumber",                 value: field("Primary Phone") },
    { name: "FaxNumber",                   value: field("Company Fax") },
    { name: "MobileNumber",                value: field("Mobile Phone") },
    { name: "DDINumber",                   value: () => "" },
    { name: "SkypeName",                   value: () => "" },
    { name: "BankAccountName",             value: () => "" },
    { name: "BankAccountNumber",           value: () => "" },
    { name: "BankAccountParticulars",      value: () => "" },
    { name: "TaxNumber",                   value: field("ABN") },
    { name: "AccountsReceivableTaxCodeName", value: () => "" },
    { name: "AccountsPayableTaxCodeName",  value: () => "" },
    { name: "Website",                     value: field("Website") },
    { name: "Discount",                    value: () => "" },
    { name: "DefaultSalesAccount",         value: () => "" },
    { name: "DefaultPurchasesAccount",     value: () => "" },
    { name: "DefaultSalesTrackingName1",   value: () => "" },
    { name: "DefaultSalesTrackingOption1", value: () => "" },
    { name: "DefaultSalesTrackingName2",   value: () => "" },
    { name: "DefaultSalesTrackingOption2", value: () => "" },
    { name: "DefaultPurchasesTrackingName1", value: () => "" },
    { name: "DefaultPurchasesTrackingOption1", value: () => "" },
    { name: "DefaultPurchasesTrackingName2", value: () => "" },
    { name: "DefaultPurchasesTrackingOption2", value: () => "" },
    { name: "SalesInvoicesDueDateBillingTerm", value: () => "" },
    { name: "SalesInvoicesDueDateBillingDay",  value: () => "" },
    { name: "BillsDueDateBillingTerm",     value: () => "" },
    { name: "BillsDueDateBillingDay",      value: () => "" },
  ],
};

// ============================================================================
// SimPRO → MYOB AccountRight Card File
// ============================================================================

const MYOB_CARD_FILE: DestinationTemplate = {
  id: "myob-card-file",
  name: "SimPRO customers → MYOB Card File",
  description:
    "MYOB AccountRight customer card import shape. Pipe-separated where MYOB expects multi-line addresses inside one cell.",
  destinationLabel: "MYOB",
  requiredRoles: ["customer"],
  origin: "builtin",
  columns: [
    { name: "Co./Last Name",        value: field("Company Name") },
    { name: "First Name",           value: field("First Name") },
    { name: "Card ID*",             value: field("simPRO Customer ID") },
    { name: "Card Status",          value: staticValue("Active") },
    { name: "Currency Code",        value: ({ customer }) => str(customer["Currency"]) || "AUD" },
    { name: "Addr 1 - Line 1",      value: field("Street Address") },
    { name: "Addr 1 - City",        value: field("Suburb") },
    { name: "Addr 1 - State",       value: field("State") },
    { name: "Addr 1 - Postcode",    value: field("Postcode") },
    { name: "Addr 1 - Country",     value: field("Country") },
    { name: "Addr 1 - Phone No. 1", value: field("Primary Phone") },
    { name: "Addr 1 - Phone No. 2", value: field("Alt. Phone") },
    { name: "Addr 1 - Phone No. 3", value: field("Mobile Phone") },
    { name: "Addr 1 - Fax",         value: field("Company Fax") },
    { name: "Addr 1 - Email",       value: field("Email") },
    { name: "Addr 1 - WWW",         value: field("Website") },
    { name: "Addr 1 - Contact",     value: ({ customer, contacts }) => {
      const def = contacts.find((c) => isTruthy(c["Is Default Invoice Contact"])) ?? contacts[0];
      if (def) {
        return [str(def["Contact First Name"]), str(def["Contact Last Name"])]
          .filter(Boolean).join(" ");
      }
      return [str(customer["First Name"]), str(customer["Last Name"])].filter(Boolean).join(" ");
    } },
    { name: "Addr 1 - Salutation",  value: field("Title") },
    { name: "Inactive Card",        value: staticValue("N") },
    { name: "A.B.N.",               value: field("ABN") },
    { name: "A.B.N. Branch",        value: staticValue("000") },
    { name: "Tax ID No.",           value: () => "" },
    { name: "Tax Code",             value: () => "" },
    { name: "Freight Tax Code",     value: () => "" },
    { name: "Notes",                value: field("Notes") },
  ],
};

// ============================================================================
// SimPRO → Outlook contacts CSV (Outlook desktop export shape)
// One row per customer's primary contact. Customers with no contact are skipped
// (caller can toggle skipEmpty in render options).
// ============================================================================

const OUTLOOK_CONTACTS: DestinationTemplate = {
  id: "outlook-contacts",
  name: "SimPRO contacts → Outlook contacts.csv",
  description:
    "Outlook desktop's documented contacts CSV format. One row per SimPRO contact, with the parent customer's company name + address joined in.",
  destinationLabel: "Outlook",
  requiredRoles: ["customer", "contact"],
  origin: "builtin",
  columns: [
    // Note: This template walks the CONTACTS file (one row per contact), not
    // one-row-per-customer. The engine's customer loop still applies but each
    // customer with N contacts produces N rows via the multi-row formatter
    // below. (Future: switch the engine to support 'one-per-contact' shape
    // directly. For now we emit primary contact only — most common case.)
    { name: "First Name",     value: defaultContactField("Contact First Name") },
    { name: "Last Name",      value: defaultContactField("Contact Last Name") },
    { name: "Middle Name",    value: () => "" },
    { name: "Title",          value: defaultContactField("Contact Title") },
    { name: "Suffix",         value: () => "" },
    { name: "Company",        value: field("Company Name") },
    { name: "Department",     value: defaultContactField("Contact Department") },
    { name: "Job Title",      value: defaultContactField("Contact Position") },
    { name: "Business Street",   value: field("Street Address") },
    { name: "Business City",     value: field("Suburb") },
    { name: "Business State",    value: field("State") },
    { name: "Business Postal Code", value: field("Postcode") },
    { name: "Business Country",  value: field("Country") },
    { name: "Business Phone",    value: defaultContactField("Contact Work Phone") },
    { name: "Business Fax",      value: defaultContactField("Contact Fax") },
    { name: "Mobile Phone",      value: defaultContactField("Contact Mobile Phone") },
    { name: "E-mail Address",    value: defaultContactField("Contact Email") },
    { name: "E-mail Display Name", value: ({ contacts }) => {
      const def = contacts.find((c) => isTruthy(c["Is Default Quote Contact"])) ?? contacts[0];
      if (!def) return "";
      const name = [str(def["Contact First Name"]), str(def["Contact Last Name"])].filter(Boolean).join(" ");
      const email = str(def["Contact Email"]);
      return name && email ? `${name} <${email}>` : name || email;
    } },
    { name: "Web Page",       value: field("Website") },
    { name: "Notes",          value: ({ customer, contacts }) => {
      const def = contacts.find((c) => isTruthy(c["Is Default Quote Contact"])) ?? contacts[0];
      const cNotes = def ? str(def["Contact Notes"]) : "";
      const custNotes = str(customer["Notes"]);
      return [cNotes, custNotes].filter(Boolean).join(" — ");
    } },
  ],
};

// ============================================================================
// Primary-contact picker
//
// SimPRO often doesn't have `Is Default Quote Contact` flagged. The naive
// fallback "first contact in the file" is wrong surprisingly often — the
// first contact is sometimes an internal SKS person who got added during
// project handover (e.g. Royce as account manager appearing as a "contact"
// on Schneider Electric's record).
//
// Better fallback chain:
//   1. Contact explicitly flagged Is Default Quote Contact = Y
//   2. Contact whose Position matches a quoting-relevant title (procurement,
//      purchasing, accounts, project manager, director, owner)
//   3. First contact whose name doesn't match the customer's Account Manager
//      (so we don't recommend an internal SKS person as the customer's primary)
//   4. First contact in the file (final fallback — flag as uncertain)
//
// `pickResult.certain` is false when no Is Default Quote Contact was flagged.
// Templates can show "(no default contact set)" suffix to alert the quoter.
// ============================================================================

const QUOTE_RELEVANT_POSITIONS = [
  "procurement",
  "purchasing",
  "accounts",
  "project manager",
  "construction manager",
  "director",
  "owner",
  "operations",
  "estimating",
];

interface PrimaryContactPick {
  contact: Record<string, unknown> | undefined;
  /** "certain" when SimPRO had an explicit flag on a non-AM contact. */
  certain: boolean;
  /** "internal" when the only contact is the customer's Account Manager. */
  internalOnly: boolean;
  reason:
    | "default-flag-nonam"
    | "default-flag-am"
    | "position-match"
    | "non-account-manager"
    | "internal-fallback"
    | "first-contact"
    | "none";
}

function pickPrimaryContact(
  contacts: Record<string, unknown>[],
  customer: Record<string, unknown>,
): PrimaryContactPick {
  if (contacts.length === 0) {
    return { contact: undefined, certain: false, internalOnly: false, reason: "none" };
  }

  // AM-skip is a first-class filter applied at every step. Internal SKS
  // people sometimes get added as contacts on a customer record (e.g. as
  // project-handover contacts) and SimPRO sometimes flags them as the
  // default-quote contact. Surfacing the Account Manager as the customer's
  // primary contact is always wrong in a quoting context.
  const am = str(customer["Account Manager"]).trim().toLowerCase();
  const isAm = (c: Record<string, unknown>): boolean => {
    if (!am) return false;
    const fullName = [str(c["Contact First Name"]), str(c["Contact Last Name"])]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toLowerCase();
    return !!fullName && namesMatch(fullName, am);
  };
  const nonAmContacts = contacts.filter((c) => !isAm(c));

  // 1a. Explicit flag on a NON-AM contact — high confidence, no suffix.
  const flaggedNonAm = nonAmContacts.find((c) =>
    isTruthy(c["Is Default Quote Contact"]),
  );
  if (flaggedNonAm) {
    return { contact: flaggedNonAm, certain: true, internalOnly: false, reason: "default-flag-nonam" };
  }

  // 2. Quoting-relevant position among non-AM contacts
  const positionMatch = nonAmContacts.find((c) => {
    const pos = str(c["Contact Position"]).toLowerCase();
    return pos && QUOTE_RELEVANT_POSITIONS.some((t) => pos.includes(t));
  });
  if (positionMatch) {
    return { contact: positionMatch, certain: false, internalOnly: false, reason: "position-match" };
  }

  // 3. First non-AM contact
  if (nonAmContacts.length > 0) {
    return { contact: nonAmContacts[0], certain: false, internalOnly: false, reason: "non-account-manager" };
  }

  // 4. Every contact matches the AM. Fall back, but flag as internal-only.
  // 4a. Prefer an explicitly flagged AM contact over a random one (SimPRO
  //     "thought" they were default-quote, even though we know they're AM).
  const flaggedAm = contacts.find((c) => isTruthy(c["Is Default Quote Contact"]));
  if (flaggedAm) {
    return { contact: flaggedAm, certain: false, internalOnly: true, reason: "default-flag-am" };
  }
  return { contact: contacts[0], certain: false, internalOnly: true, reason: "internal-fallback" };
}

/** Compare two names loosely — handles "Royce" matching "Royce Milmlow" etc. */
function namesMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const aParts = a.split(/\s+/).filter(Boolean);
  const bParts = b.split(/\s+/).filter(Boolean);
  // Match if first name + last name agree (or if one is a strict substring of the other)
  if (aParts.length > 0 && bParts.length > 0) {
    if (aParts[0] === bParts[0] && aParts[aParts.length - 1] === bParts[bParts.length - 1]) {
      return true;
    }
  }
  return a.includes(b) || b.includes(a);
}

// ============================================================================
// SimPRO bundle → EQ Quotes (site-centric)
//
// One row per site, with the parent customer + that customer's default-quote
// contact denormalised onto each row. Matches the quoting flow:
//   pick a site → see its customer → see the primary contact → quote
// Orphan sites (customer ID not in the customer export) are dropped — you
// can't quote without a customer.
// ============================================================================

const SIMPRO_QUOTES_BY_SITE: DestinationTemplate = {
  id: "simpro-quotes-by-site",
  name: "SimPRO bundle → EQ Quotes (row per site)",
  description:
    "One row per site, with parent customer + primary contact denormalised. Drop the three SimPRO files, output is the quotable-site list EQ Quotes ingests.",
  destinationLabel: "EQ Quotes",
  requiredRoles: ["customer", "contact", "site"],
  origin: "builtin",
  iterationMode: "site",
  columns: [
    // Site identity
    { name: "Site ID",                value: site("simPRO Site ID"),
      description: "Source-system Site ID. Stable key." },
    { name: "Site Name",              value: site("Site Name") },
    { name: "Site Address",           value: siteAddress(),
      description: "Street, Suburb, State, Postcode joined into one line." },

    // Customer link (denormalised onto every site row for picker display).
    // The site's `simPRO Customer ID` cell can carry a comma-separated list
    // (e.g. "31, 32, 208" — multi-tenant data-centre sites). The engine
    // splits the list and joins the row to the FIRST listed customer; we
    // emit that customer's ID here so the cell is a clean single ID. The
    // remaining customers are surfaced via Linked Customer ID/Name columns
    // at the bottom of the row.
    { name: "Customer ID",            value: ({ customer }) => str(customer["simPRO Customer ID"]) },
    { name: "Customer Name",          value: field("Company Name") },
    { name: "Customer Type",          value: field("Type") },
    { name: "Customer Group",         value: field("Customer Group") },
    { name: "Account Manager",        value: field("Account Manager") },
    { name: "Customer ABN",           value: field("ABN") },

    // Primary contact — picked via the smart fallback chain (see
    // pickPrimaryContact above). Two kinds of suffix:
    //   "(no default contact set)" — SimPRO didn't flag anyone explicitly
    //     as the default quote contact. Quoter should verify before sending.
    //   "(matches your Account Manager — verify)" — every contact on this
    //     customer's record matches your AM's name. Usually means an
    //     internal SKS person got added as a "contact" on the customer.
    //     The quoter definitely needs to add a real customer contact in
    //     SimPRO before sending.
    { name: "Primary Contact Name",   value: ({ contacts, customer }) => {
      const pick = pickPrimaryContact(contacts, customer);
      if (!pick.contact) return "";
      const name = [str(pick.contact["Contact First Name"]), str(pick.contact["Contact Last Name"])]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (pick.certain) return name;
      if (pick.internalOnly) return `${name} (matches your Account Manager — verify)`;
      return `${name} (no default contact set)`;
    } },
    { name: "Primary Contact Email",  value: ({ contacts, customer }) => {
      const pick = pickPrimaryContact(contacts, customer);
      return pick.contact ? str(pick.contact["Contact Email"]) : "";
    } },
    { name: "Primary Contact Phone",  value: ({ contacts, customer }) => {
      const pick = pickPrimaryContact(contacts, customer);
      if (!pick.contact) return "";
      const mobile = str(pick.contact["Contact Mobile Phone"]).trim();
      const work = str(pick.contact["Contact Work Phone"]).trim();
      return mobile || work;
    } },
    { name: "Primary Contact Position", value: ({ contacts, customer }) => {
      const pick = pickPrimaryContact(contacts, customer);
      return pick.contact ? str(pick.contact["Contact Position"]) : "";
    } },

    // Fallback — full contact list for this customer (so quoter can pick someone else)
    { name: "All Customer Contacts",  value: contactRollup(),
      description: "All contacts for this customer, pipe-separated. Use when the primary contact isn't the right recipient for a specific quote." },

    // Quote-relevant customer defaults
    { name: "Customer Default Quote Method", value: field("Default Quote Method"),
      description: "Print / Email — defaults the delivery mode on a new quote." },
    { name: "Customer Notes",         value: field("Notes"),
      description: "Free-text context (e.g. \"always wants 30-day terms\")." },
    { name: "Currency",               value: ({ customer }) => str(customer["Currency"]) || "AUD" },

    // Multi-tenant sites — SimPRO models a co-owned site by writing a
    // comma-separated list of customer IDs into the site's "simPRO Customer
    // ID" cell (e.g. "31, 32, 208" for data-centre tenants). The engine
    // joins the row to the first listed customer; these two columns surface
    // the others so the quoter can see every legal entity attached to the
    // site. Empty for single-customer sites.
    { name: "Linked Customer IDs",    value: linkedCustomerIds(),
      description: "Extra customer IDs (besides the primary Customer ID) attached to this site. Empty for normal single-customer sites." },
    { name: "Linked Customer Names",  value: linkedCustomerNames(),
      description: "Company Names matching the Linked Customer IDs, pipe-separated." },
  ],
};

// ============================================================================
// REGISTRY
// ============================================================================

export const BUILTIN_TEMPLATES: DestinationTemplate[] = [
  SIMPRO_CUSTOMER_ROLLUP,
  SIMPRO_QUOTES_BY_SITE,
  XERO_CONTACTS_IMPORT,
  MYOB_CARD_FILE,
  OUTLOOK_CONTACTS,
];

/**
 * Build a destination template from a user-supplied sample CSV.
 * The user picks a canonical-field for each target column via the UI;
 * this function turns that mapping into a working DestinationTemplate.
 *
 * The canonicalFieldMap maps the target column name to the SOURCE column
 * name to read from the customer row (e.g. "Account No." → "simPRO Customer ID").
 * Unmapped columns emit empty strings.
 */
export function buildUserTemplate(opts: {
  id: string;
  name: string;
  destinationLabel?: string;
  columnNames: string[];
  canonicalFieldMap: Record<string, string | null>;
}): DestinationTemplate {
  return {
    id: opts.id,
    name: opts.name,
    description: "Custom template built from your destination's column headers.",
    destinationLabel: opts.destinationLabel ?? "Custom destination",
    requiredRoles: ["customer"],
    origin: "user",
    columns: opts.columnNames.map((target) => ({
      name: target,
      value: (() => {
        const source = opts.canonicalFieldMap[target];
        if (!source) return () => "";
        return field(source);
      })(),
    })),
  };
}

// ============================================================================
// LOCAL HELPERS
// ============================================================================

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function isTruthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    return t === "true" || t === "yes" || t === "y" || t === "1";
  }
  return false;
}
