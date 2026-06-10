-- ============================================================
-- 0041_address_corrections.sql
--
-- Fix address fields on Royce's tenant sites. Corrects
-- mislabelled cities (all were set to "Sydney" regardless of
-- actual suburb), normalises address strings, and populates
-- postcodes for all known Equinix / Digital Realty / Metronode
-- sites. Also populates the `code` column to match the site
-- name (historically used, currently null on every active row).
--
-- Source of truth:
--   - Royce's notes: SY7 Unanderra = Wollongong (not Sydney)
--   - Publicly documented Equinix / Digital Realty AU addresses
--     for every other site in the tenant
--   - St George Private Hospital = 1 South St, Kogarah NSW 2217
--
-- No data destruction — this is a field-normalisation pass.
-- Every update scoped by `name` and `is_active = true` so it
-- can be safely re-run on a branch.
-- ============================================================

-- CA1 — Equinix Australia National, 51 Dacre St, Mitchell ACT 2911
update public.sites
   set code = 'CA1',
       address = '51 Dacre St',
       city = 'Mitchell',
       state = 'ACT',
       postcode = '2911',
       updated_at = now()
 where name = 'CA1' and is_active = true;

-- SY1 — Equinix Australia Pty Ltd, 639 Gardeners Rd, Mascot NSW 2020
update public.sites
   set code = 'SY1',
       address = '639 Gardeners Rd',
       city = 'Mascot',
       state = 'NSW',
       postcode = '2020',
       updated_at = now()
 where name = 'SY1' and is_active = true;

-- SY2 — Equinix Australia Pty Ltd, 639 Gardeners Rd, Mascot NSW 2020
update public.sites
   set code = 'SY2',
       address = '639 Gardeners Rd',
       city = 'Mascot',
       state = 'NSW',
       postcode = '2020',
       updated_at = now()
 where name = 'SY2' and is_active = true;

-- SY3 — Equinix Australia Pty Ltd, 47 Bourke Rd, Alexandria NSW 2015
update public.sites
   set code = 'SY3',
       address = '47 Bourke Rd',
       city = 'Alexandria',
       state = 'NSW',
       postcode = '2015',
       updated_at = now()
 where name = 'SY3' and is_active = true;

-- SY4 — Equinix Australia Pty Ltd, 200 Bourke Rd, Alexandria NSW 2015
update public.sites
   set code = 'SY4',
       address = '200 Bourke Rd',
       city = 'Alexandria',
       state = 'NSW',
       postcode = '2015',
       updated_at = now()
 where name = 'SY4' and is_active = true;

-- SY5 — Equinix Australia Pty Ltd, B/200 Bourke Rd, Alexandria NSW 2015
update public.sites
   set code = 'SY5',
       address = 'B/200 Bourke Rd',
       city = 'Alexandria',
       state = 'NSW',
       postcode = '2015',
       updated_at = now()
 where name = 'SY5' and is_active = true;

-- SY6 — Metronode NSW Pty Ltd, 8 Egerton St, Silverwater NSW 2128
update public.sites
   set code = 'SY6',
       address = '8 Egerton St',
       city = 'Silverwater',
       state = 'NSW',
       postcode = '2128',
       updated_at = now()
 where name = 'SY6' and is_active = true;

-- SY7 — Metronode NSW Pty Ltd, Lathe Place, Unanderra NSW 2526
-- Royce's correction: this is Wollongong, not Sydney.
update public.sites
   set code = 'SY7',
       address = 'Lathe Place, Unanderra',
       city = 'Wollongong',
       state = 'NSW',
       postcode = '2526',
       updated_at = now()
 where name = 'SY7' and is_active = true;

-- SY9 — Equinix Hyperscale, 8 Grand Avenue, Camellia NSW 2142
update public.sites
   set code = 'SY9',
       address = '8 Grand Avenue',
       city = 'Camellia',
       state = 'NSW',
       postcode = '2142',
       updated_at = now()
 where name = 'SY9' and is_active = true;

-- SYD10 — Digital Realty, 1-11 Templar Rd, Erskine Park NSW 2759
update public.sites
   set code = 'SYD10',
       address = '1-11 Templar Rd',
       city = 'Erskine Park',
       state = 'NSW',
       postcode = '2759',
       updated_at = now()
 where name = 'SYD10' and is_active = true;

-- SYD11 — Digital Realty, 13-23 Templar Rd, Erskine Park NSW 2759
update public.sites
   set code = 'SYD11',
       address = '13-23 Templar Rd',
       city = 'Erskine Park',
       state = 'NSW',
       postcode = '2759',
       updated_at = now()
 where name = 'SYD11' and is_active = true;

-- St George Private Hospital — Ramsay Health, 1 South St, Kogarah NSW 2217
update public.sites
   set code = 'STG',
       address = '1 South St',
       city = 'Kogarah',
       state = 'NSW',
       postcode = '2217',
       updated_at = now()
 where name = 'St George Private Hospital' and is_active = true;

-- Sanity: no active site in Royce's tenant should have null code,
-- null city, or null postcode after this migration.
do $$
declare
  n_null_code bigint;
  n_null_city bigint;
  n_null_postcode bigint;
begin
  select count(*) into n_null_code
    from public.sites
   where tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
     and is_active = true
     and (code is null or code = '');

  select count(*) into n_null_city
    from public.sites
   where tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
     and is_active = true
     and (city is null or city = '');

  select count(*) into n_null_postcode
    from public.sites
   where tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
     and is_active = true
     and (postcode is null or postcode = '');

  if n_null_code + n_null_city + n_null_postcode > 0 then
    raise exception
      'Migration 0041: post-state has null code=%, city=%, postcode=%',
      n_null_code, n_null_city, n_null_postcode;
  end if;
end $$;
