-- 2026_06_04_seed_default_security_groups.sql
-- Control-plane migration (jvknxcmbtrfnxfrwfimn shell_control schema).
--
-- Backfill the canonical DEFAULT security-group templates into every EXISTING
-- tenant. New tenants are seeded at creation time by
-- netlify/functions/_shared/seed-default-groups.ts (called from admin-tenants.ts);
-- this closes the same gap for tenants that already existed before that shipped.
--
-- Templates mirror @eq-solutions/roles v2.2.0 DEFAULT_GROUPS — keep in sync with
-- netlify/functions/_shared/default-groups.ts (scripts/check-perm-sync.mjs guards
-- that mirror against the package). Groups are system-seeded (created_by NULL);
-- managers assign members later. We do NOT touch user_security_groups, so this
-- grants no one any extra permission until a manager adds members.
--
-- Idempotent: ON CONFLICT DO NOTHING on the (tenant_id, name) and
-- (group_id, perm_key) keys, so re-running is a no-op and it never clobbers a
-- tenant's own custom group of the same name.
--
-- NOT YET APPLIED — pending explicit go-ahead from Royce (production data write).

-- 1. Ensure each template group exists for every tenant.
INSERT INTO shell_control.security_groups (tenant_id, name, description, created_by)
SELECT t.id, tmpl.name, tmpl.description, NULL
FROM shell_control.tenants t
CROSS JOIN (VALUES
  ('Equipment editors',
   'Edit the plant & equipment list and calibration details. Add people here who maintain equipment but whose role normally only lets them view it.'),
  ('Report viewers',
   'View GM reports without being made a manager. Add supervisors or leads here who need to read reports.')
) AS tmpl(name, description)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 2. Ensure each template group's perms exist (resolve group id by tenant+name).
INSERT INTO shell_control.security_group_perms (group_id, perm_key)
SELECT sg.id, p.perm_key
FROM shell_control.security_groups sg
JOIN (VALUES
  ('Equipment editors', 'equipment.view'),
  ('Equipment editors', 'equipment.edit'),
  ('Report viewers',    'reports.view')
) AS p(name, perm_key) ON p.name = sg.name
ON CONFLICT (group_id, perm_key) DO NOTHING;
