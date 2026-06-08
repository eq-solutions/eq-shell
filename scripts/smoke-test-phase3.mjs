import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jvknxcmbtrfnxfrwfimn.supabase.co';
const SERVICE_KEY  = process.env.SVC_KEY;
const SHELL_URL    = 'https://core.eq.solutions';

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Step 1: Generate a magic link for dev@eq.solutions
const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
  type: 'magiclink',
  email: 'dev@eq.solutions',
});
if (linkErr || !linkData) {
  console.error('generateLink failed:', linkErr?.message);
  process.exit(2);
}

const hashedToken = linkData.properties?.hashed_token;
console.log('Step 1: Generated magic link OK (type:', linkData.properties?.verification_type ?? 'magiclink', ')');

// Step 2: Exchange hashed_token for a Supabase session via verifyOtp
if (!hashedToken) { console.error('No hashed_token in generateLink response'); process.exit(2); }

const { data: sessionData, error: verifyErr } = await sb.auth.verifyOtp({
  token_hash: hashedToken,
  type: 'email',
});
if (verifyErr || !sessionData?.session) {
  console.error('verifyOtp failed:', verifyErr?.message, JSON.stringify(sessionData));
  process.exit(2);
}
const accessToken = sessionData.session.access_token;
console.log('Step 2: Got Supabase access_token OK');

// Step 3: Call shell-login-magic-link
const shellResp = await fetch(SHELL_URL + '/.netlify/functions/shell-login-magic-link', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'dev@eq.solutions', access_token: accessToken }),
});
const shellBody = await shellResp.json();
console.log('Step 3: shell-login-magic-link ->', JSON.stringify({
  valid: shellBody.valid,
  user_role: shellBody.user?.role,
  tenant_slug: shellBody.tenant?.slug,
  has_supabase_jwt: !!shellBody.supabase_jwt,
}));
if (!shellBody.valid) { console.error('Shell login failed:', JSON.stringify(shellBody)); process.exit(1); }

// Step 4: Extract session cookie and call token-exchange for field
const setCookie = shellResp.headers.get('set-cookie') ?? '';
const cookieVal = setCookie.match(/eq_shell_session=([^;]+)/)?.[1];
if (!cookieVal) { console.error('No shell session cookie returned'); process.exit(1); }

const fieldResp = await fetch(SHELL_URL + '/.netlify/functions/token-exchange', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': 'eq_shell_session=' + cookieVal },
  body: JSON.stringify({ aud: 'field', tenant_slug: 'sks' }),
});
const fieldBody = await fieldResp.json();
console.log('Step 4: token-exchange(field) ->', JSON.stringify({ has_token: !!fieldBody.token, exp: fieldBody.exp }));

// Step 5: token-exchange for service
const svcResp = await fetch(SHELL_URL + '/.netlify/functions/token-exchange', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': 'eq_shell_session=' + cookieVal },
  body: JSON.stringify({ aud: 'service' }),
});
const svcBody = await svcResp.json();
console.log('Step 5: token-exchange(service) ->', JSON.stringify({ has_token: !!svcBody.token, exp: svcBody.exp }));

if (fieldBody.token && svcBody.token) {
  console.log('\n--- PASSED: magic-link login + token-exchange for field + service ---\n');
  process.exit(0);
} else {
  console.log('\n--- FAILED ---\n');
  process.exit(1);
}
