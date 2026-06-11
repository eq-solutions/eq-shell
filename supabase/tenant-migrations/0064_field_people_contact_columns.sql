-- Migration: 0064_field_people_contact_columns
-- Target:    every tenant data-plane project (ehowgjardagevnrluult + zaapmfdkgedqupfjtchl)
-- Purpose:   Extend the field_people view to include phone and email.
--
--            The legacy Field app (eq-solves-field) displays and matches on
--            {name, phone, email, group} per person. Without phone + email the
--            canonical Field console can't show contact info or cross-reference
--            identity with the legacy app during the transition period.
--
--            phone / email come from app_data.staff where they already live.
--            No new data — just surfacing columns the view was already omitting.
--
--            The view's existing filter (field_approved IS TRUE OR NULL, active
--            IS NOT FALSE) is unchanged.

CREATE OR REPLACE VIEW app_data.field_people AS
SELECT
  staff_id                                                     AS id,
  tenant_id,
  COALESCE(preferred_name, (first_name || ' ' || last_name))   AS name,
  employment_type                                              AS "group",
  trade,
  email,
  phone,
  field_approved,
  active,
  created_at,
  updated_at
FROM app_data.staff
WHERE (field_approved IS TRUE OR field_approved IS NULL)
  AND active IS NOT FALSE;
