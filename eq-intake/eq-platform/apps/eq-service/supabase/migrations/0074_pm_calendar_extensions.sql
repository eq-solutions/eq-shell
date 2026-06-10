-- ============================================================
-- Migration 0070: PM Calendar — scope linkage, tech briefing, customer approval
--
-- Findings driving this (audit 2026-04-27):
--
--   - Calendar entries are ATTENDANCE markers, not labour records. The 8hr
--     "Q1 Maintenance" row at SY3 doesn't carry the labour for all the JPs
--     touched that quarter — Royce confirmed it's just "we'll be on site
--     this date."  The labour cost lives in contract_scopes.year_totals.
--   - One contract_scopes row can be satisfied by N calendar entries
--     (e.g. SY9 ACBs annual = Oct + Nov split delivery).
--   - Calendar Description column today carries tribal-knowledge tech
--     briefing data (DALI computer creds, contractor mobiles, special
--     access notes). Royce wants this as a structured "tech briefing"
--     field that helps the technician on the day.
--   - PM dates require Equinix written approval before delivery (Schedule
--     B2). EQ Service should record approver + date so we can prove it.
--
-- All additive + nullable. Existing pm_calendar rows still validate.
-- ============================================================

ALTER TABLE public.pm_calendar
  -- Link calendar entry to a specific contract scope row. Nullable for the
  -- "we just need to be on site" attendance markers that don't tie to one JP.
  ADD COLUMN IF NOT EXISTS contract_scope_id uuid REFERENCES public.contract_scopes(id) ON DELETE SET NULL,
  -- Period type / label split (resolved 2026-04-27):
  --   period_type  -> enum drives how UI renders the calendar
  --                    quarter   = SY3 / SY7 style Q1-Q4 attendance markers
  --                    month     = monthly cadence (M14.29 LCP, Jemena Nov visit)
  --                    wo_named  = SY9 "Feb WO" / "May WO" style entries
  --                    custom    = ad-hoc, ungrouped (anything that doesn't fit)
  --   period_label -> the displayed string ("Q1", "Feb WO", "May visit")
  ADD COLUMN IF NOT EXISTS period_type text
    CHECK (period_type IN ('quarter', 'month', 'wo_named', 'custom')),
  -- For attendance-marker rows, the period this covers (e.g. 'Q1', 'Feb', 'May').
  ADD COLUMN IF NOT EXISTS period_label text,
  -- Tech briefing — structured fields the technician sees when they tap the entry
  ADD COLUMN IF NOT EXISTS tech_notes text,                                                -- rich-text instructions / context
  ADD COLUMN IF NOT EXISTS contractor_coordination jsonb DEFAULT '[]'::jsonb,
    -- Shape: [{"role": "Thermal scanning", "company": "Thermal Insight",
    --          "contact": "office@thermalinsight.com.au", "mobile": "0411..."}]
  ADD COLUMN IF NOT EXISTS site_access_notes text,                                         -- gate codes, badge requirements, escort, special start times
  ADD COLUMN IF NOT EXISTS scope_in_words text,                                             -- structured restatement of "Annual ACB's, Annual switchboards (R BLOCK ONLY)"
  ADD COLUMN IF NOT EXISTS contractor_materials_breakdown jsonb DEFAULT '[]'::jsonb,
    -- Shape: [{"item": "Thermal scan", "company": "Thermal Insight", "cost": 4500}]
  -- Customer approval (per Schedule B2 written approval requirement)
  ADD COLUMN IF NOT EXISTS customer_approved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS customer_approver_name    text,
  ADD COLUMN IF NOT EXISTS customer_approver_email   text,
  ADD COLUMN IF NOT EXISTS customer_approved_via_import_id uuid,                            -- bootstrap loader run id (0071 staging tables superseded; this stays as opaque uuid for traceability)
  -- Block / zone metadata (e.g. SY9 R Block partial scheduling)
  ADD COLUMN IF NOT EXISTS block_or_zone text,
  -- Origin tracking (which bootstrap / xlsx import this entry came from)
  ADD COLUMN IF NOT EXISTS source_import_id uuid;                                           -- bootstrap loader run id; opaque uuid for traceability

CREATE INDEX IF NOT EXISTS pm_calendar_scope_idx
  ON public.pm_calendar(contract_scope_id) WHERE contract_scope_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pm_calendar_source_import_idx
  ON public.pm_calendar(source_import_id) WHERE source_import_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pm_calendar_unapproved_idx
  ON public.pm_calendar(tenant_id, customer_approved_at)
  WHERE customer_approved_at IS NULL AND is_active = true;

COMMENT ON COLUMN public.pm_calendar.contract_scope_id IS
  'Links calendar entry to the contract_scopes row it satisfies. NULL for generic attendance markers (Q1 Maintenance) that don''t tie to one JP.';

COMMENT ON COLUMN public.pm_calendar.tech_notes IS
  'Rich-text tech briefing visible to the on-site technician — context, special instructions, what to take, who to coordinate with. NOT for credentials (those go in site_credentials with stricter RLS).';

COMMENT ON COLUMN public.pm_calendar.contractor_coordination IS
  'Structured contractor contacts for this visit (subbies, 3rd parties). Shape: [{role, company, contact, mobile, email, notes}].';

COMMENT ON COLUMN public.pm_calendar.customer_approved_at IS
  'When the customer approved this entry. Required by Schedule B2 before SKS attends. UI surfaces unapproved entries via the pm_calendar_unapproved_idx-backed view; coverage check on commit is warn-only (resolved 2026-04-27), not blocking.';

COMMENT ON COLUMN public.pm_calendar.block_or_zone IS
  'Site sub-zone this entry covers (e.g. "R Block" at SY9). NULL = whole site.';

COMMENT ON COLUMN public.pm_calendar.period_type IS
  'Drives how the UI renders the calendar entry. quarter = Q1-Q4 attendance markers (SY3); month = monthly cadence (LCP, Jemena Nov); wo_named = month-named WO entries (SY9 "Feb WO"); custom = ungrouped.';

COMMENT ON COLUMN public.pm_calendar.period_label IS
  'Free-text displayed string for the period ("Q1", "Feb WO", "May visit"). Pair with period_type which says how to render.';

CREATE INDEX IF NOT EXISTS pm_calendar_period_type_idx
  ON public.pm_calendar(tenant_id, period_type)
  WHERE period_type IS NOT NULL AND is_active = true;
-- pm_calendar has no customer_id column; customer is resolved via site_id -> sites.customer_id.
