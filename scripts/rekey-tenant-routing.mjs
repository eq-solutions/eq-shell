/**
 * rekey-tenant-routing.mjs
 *
 * Fixes a TENANT_ROUTING_MASTER_KEY mismatch by:
 *   1. Fetching the real service-role key for the tenant's data-plane project
 *      via the Supabase Management API
 *   2. Generating a fresh AES-256-GCM master key (or accepting one via --master-key=)
 *   3. Re-encrypting and writing the new ciphertext to shell_control.tenant_routing
 *   4. Printing the new TENANT_ROUTING_MASTER_KEY to stdout — set this on Netlify
 *      then trigger a redeploy
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... \
 *   node scripts/rekey-tenant-routing.mjs --slug=core
 *
 * Optional flags:
 *   --master-key=<64-char hex>   Use an existing key instead of generating a new one
 *   --dry-run                    Print SQL without writing to DB
 *
 * Required env vars:
 *   SUPABASE_ACCESS_TOKEN   — Personal access token with project read access
 *
 * Everything else (control-plane URL, service key, data-plane project ref)
 * is resolved automatically via the Management API + tenant_routing table.
 */

import { createCipheriv, randomBytes } from 'node:crypto';

// ── Constants ────────────────────────────────────────────────────────────────

const CONTROL_PROJECT_REF = 'jvknxcmbtrfnxfrwfimn'; // eq-canonical
const MGMT_BASE = 'https://api.supabase.com/v1';
const ALGORITHM = 'aes-256-gcm';

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
);

const slug = args['slug'];
if (!slug) {
  console.error('Usage: node scripts/rekey-tenant-routing.mjs --slug=<tenant-slug>');
  process.exit(1);
}

const dryRun = args['dry-run'] === true;
const providedKey = args['master-key'];

// ── Token ────────────────────────────────────────────────────────────────────

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN env var is required');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function mgmt(path) {
  const res = await fetch(`${MGMT_BASE}${path}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Management API ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function getServiceRoleKey(projectRef) {
  // Management API: GET /v1/projects/{ref}/api-keys
  const keys = await mgmt(`/projects/${projectRef}/api-keys`);
  const srk = keys.find(k => k.name === 'service_role');
  if (!srk) throw new Error(`No service_role key found for project ${projectRef}`);
  return srk.api_key;
}

function encryptSecret(plaintext, masterKeyHex) {
  const key = Buffer.from(masterKeyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n🔑  Re-keying tenant_routing for slug="${slug}"`);

  // 1. Get the control-plane service role key (to write to DB)
  console.log('  → Fetching control-plane service role key...');
  const controlServiceKey = await getServiceRoleKey(CONTROL_PROJECT_REF);

  // 2. Query tenant_routing for the slug to get data-plane project ref
  console.log('  → Resolving tenant data-plane project ref...');
  const controlUrl = `https://${CONTROL_PROJECT_REF}.supabase.co`;
  const routingRes = await fetch(
    `${controlUrl}/rest/v1/rpc/dummy`, // We'll use PostgREST directly
  ).catch(() => null);

  // Use Management API to run the query instead (avoids needing anon key)
  const routingQuery = await mgmt(
    `/projects/${CONTROL_PROJECT_REF}/database/query`
  ).catch(async () => {
    // Fallback: use PostgREST with service key
    const r = await fetch(
      `${controlUrl}/rest/v1/tenants?slug=eq.${encodeURIComponent(slug)}&select=id`,
      { headers: { Authorization: `Bearer ${controlServiceKey}`, apikey: controlServiceKey } }
    );
    if (!r.ok) throw new Error(`Failed to query tenants: ${r.status}`);
    return null; // handled below
  });

  // Actually, the cleanest path: query via PostgREST with service key
  const tenantsRes = await fetch(
    `${controlUrl}/rest/v1/tenants?slug=eq.${encodeURIComponent(slug)}&select=id`,
    {
      headers: {
        Authorization: `Bearer ${controlServiceKey}`,
        apikey: controlServiceKey,
      },
    }
  );
  if (!tenantsRes.ok) {
    throw new Error(`Failed to query tenants table: ${tenantsRes.status} ${await tenantsRes.text()}`);
  }
  // Need to use schema header for shell_control
  const tenantsResSc = await fetch(
    `${controlUrl}/rest/v1/tenants?slug=eq.${encodeURIComponent(slug)}&select=id`,
    {
      headers: {
        Authorization: `Bearer ${controlServiceKey}`,
        apikey: controlServiceKey,
        'Accept-Profile': 'shell_control',
      },
    }
  );
  if (!tenantsResSc.ok) {
    throw new Error(`Failed to query shell_control.tenants: ${tenantsResSc.status} ${await tenantsResSc.text()}`);
  }
  const tenants = await tenantsResSc.json();
  if (!tenants || tenants.length === 0) {
    throw new Error(`No tenant found with slug="${slug}" in eq-canonical`);
  }
  const tenantId = tenants[0].id;
  console.log(`  → Tenant ID: ${tenantId}`);

  // 3. Get tenant_routing row to find data-plane project ref
  const routingRowRes = await fetch(
    `${controlUrl}/rest/v1/tenant_routing?tenant_id=eq.${tenantId}&select=supabase_project_ref,supabase_url`,
    {
      headers: {
        Authorization: `Bearer ${controlServiceKey}`,
        apikey: controlServiceKey,
        'Accept-Profile': 'shell_control',
      },
    }
  );
  if (!routingRowRes.ok) {
    throw new Error(`Failed to query tenant_routing: ${routingRowRes.status} ${await routingRowRes.text()}`);
  }
  const routingRows = await routingRowRes.json();
  if (!routingRows || routingRows.length === 0) {
    throw new Error(`No routing row found for tenant_id=${tenantId}`);
  }
  const dataPlaneRef = routingRows[0].supabase_project_ref;
  console.log(`  → Data-plane project ref: ${dataPlaneRef}`);

  // 4. Get the service role key for the data-plane project
  console.log('  → Fetching data-plane service role key...');
  const dataPlaneServiceKey = await getServiceRoleKey(dataPlaneRef);
  console.log('  → Service role key retrieved ✓ (not shown)');

  // 5. Generate or use provided master key
  const masterKeyHex = providedKey
    ? providedKey.trim()
    : randomBytes(32).toString('hex');

  if (providedKey) {
    console.log('  → Using provided master key');
  } else {
    console.log('  → Generated new master key');
  }

  // 6. Encrypt
  const encrypted = encryptSecret(dataPlaneServiceKey, masterKeyHex);
  console.log('  → Encrypted service role key ✓');

  if (dryRun) {
    console.log('\n── DRY RUN — SQL to execute manually ──');
    console.log(`UPDATE shell_control.tenant_routing`);
    console.log(`SET`);
    console.log(`  service_role_key_ciphertext = '${encrypted.ciphertext}',`);
    console.log(`  service_role_key_iv         = '${encrypted.iv}',`);
    console.log(`  service_role_key_tag        = '${encrypted.tag}'`);
    console.log(`WHERE tenant_id = '${tenantId}';`);
  } else {
    // 7. Update DB via PostgREST PATCH
    console.log('  → Writing new ciphertext to tenant_routing...');
    const patchRes = await fetch(
      `${controlUrl}/rest/v1/tenant_routing?tenant_id=eq.${tenantId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${controlServiceKey}`,
          apikey: controlServiceKey,
          'Content-Profile': 'shell_control',
          'Prefer': 'return=minimal',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          service_role_key_ciphertext: encrypted.ciphertext,
          service_role_key_iv: encrypted.iv,
          service_role_key_tag: encrypted.tag,
        }),
      }
    );
    if (!patchRes.ok) {
      const body = await patchRes.text().catch(() => '');
      throw new Error(`Failed to update tenant_routing: ${patchRes.status} ${body}`);
    }
    console.log('  → DB updated ✓');
  }

  // 8. Print the new key
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('  ACTION REQUIRED: Set this Netlify env var, then redeploy');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`\n  TENANT_ROUTING_MASTER_KEY=${masterKeyHex}\n`);
  console.log('  Netlify → Site → Environment variables → TENANT_ROUTING_MASTER_KEY');
  console.log('  Then: Deploys → Trigger deploy → Deploy site');
  console.log('════════════════════════════════════════════════════════════════\n');
})().catch(err => {
  console.error('\n✗ Error:', err.message);
  process.exit(1);
});
