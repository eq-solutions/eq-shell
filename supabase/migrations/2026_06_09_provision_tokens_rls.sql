-- Enable RLS on shell_control.provision_tokens.
-- Only Netlify functions touch this table via the service_role key, which
-- bypasses RLS entirely. No permissive policies are needed; this blocks
-- any anon/authenticated access that would otherwise reach the table.

ALTER TABLE shell_control.provision_tokens ENABLE ROW LEVEL SECURITY;
