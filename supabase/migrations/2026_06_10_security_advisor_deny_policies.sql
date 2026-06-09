-- Migration: 2026_06_10_security_advisor_deny_policies
-- Target:    eq-canonical (jvknxcmbtrfnxfrwfimn) only
-- Purpose:   Add explicit DENY ALL RLS policies to shell_control tables and
--            public.tenants to silence rls_enabled_no_policy INFO advisories.
--            REVOKE was applied in 2026_06_10_security_advisor_control;
--            this adds the deny policy so the advisor sees a defined posture.
--            service_role bypasses RLS so these policies do not affect it.

-- public.tenants
DROP POLICY IF EXISTS deny_all ON public.tenants;
CREATE POLICY deny_all ON public.tenants USING (false) WITH CHECK (false);

-- shell_control tables
DROP POLICY IF EXISTS deny_all ON shell_control.audit_log;
CREATE POLICY deny_all ON shell_control.audit_log USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON shell_control.cards_field_approvals;
CREATE POLICY deny_all ON shell_control.cards_field_approvals USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON shell_control.pin_reset_tokens;
CREATE POLICY deny_all ON shell_control.pin_reset_tokens USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON shell_control.platform_config;
CREATE POLICY deny_all ON shell_control.platform_config USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON shell_control.provision_tokens;
CREATE POLICY deny_all ON shell_control.provision_tokens USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON shell_control.rate_limit_buckets;
CREATE POLICY deny_all ON shell_control.rate_limit_buckets USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON shell_control.security_group_perms;
CREATE POLICY deny_all ON shell_control.security_group_perms USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON shell_control.security_groups;
CREATE POLICY deny_all ON shell_control.security_groups USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON shell_control.tenant_config;
CREATE POLICY deny_all ON shell_control.tenant_config USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON shell_control.tenant_role_overrides;
CREATE POLICY deny_all ON shell_control.tenant_role_overrides USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON shell_control.tenant_routing;
CREATE POLICY deny_all ON shell_control.tenant_routing USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON shell_control.user_security_groups;
CREATE POLICY deny_all ON shell_control.user_security_groups USING (false) WITH CHECK (false);
