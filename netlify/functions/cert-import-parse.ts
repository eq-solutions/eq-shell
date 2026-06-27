// POST /.netlify/functions/cert-import-parse  (multipart/form-data, field: files)
//
// Reads one or more calibration-certificate PDFs with vision, matches each
// against the tenant's plant & equipment register, and returns the proposed
// update / confirm / create rows for the import review panel. This endpoint
// does NOT write — the panel commits accepted rows via asset-calibration
// (+ upload-asset-cert for the PDF). Keeping the parse server-side means the
// Anthropic key never reaches the browser.
//
// Auth: eq_shell_session cookie, equipment.edit permission.

import { AnthropicProvider } from '@eq/ai';
import { parseCalibrationCerts, type CanonicalAssetRef } from '@eq/intake';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

const MAX_FILES = 40;
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per PDF

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'not_signed_in' });
  if (!can(session, 'equipment.edit')) {
    return json(403, {
      ok: false,
      error: 'forbidden',
      detail: 'Importing certificates requires manager or supervisor.',
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(503, { ok: false, error: 'ai_unavailable', detail: 'Anthropic API key not configured on server.' });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { ok: false, error: 'invalid_form_data' });
  }

  const uploads = form.getAll('files').filter((f): f is File => f instanceof File);
  if (uploads.length === 0) {
    return json(400, { ok: false, error: 'no_files', detail: 'Attach one or more certificate PDFs under "files".' });
  }
  if (uploads.length > MAX_FILES) {
    return json(400, { ok: false, error: 'too_many_files', detail: `Maximum ${MAX_FILES} files per import.` });
  }
  for (const f of uploads) {
    if (f.size > MAX_BYTES) {
      return json(400, { ok: false, error: 'file_too_large', detail: `${f.name}: maximum 15 MB per file.` });
    }
  }

  // Tenant data plane (service-role, scoped to this tenant).
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = tenantDb as any;

  // The register to match against — internal plant & equipment only.
  const { data: assetRows, error: assetErr } = await db
    .schema('app_data')
    .from('assets')
    .select('asset_id, name, serial_number, external_id, make, model')
    .eq('tenant_id', session.tenant_id)
    .eq('asset_type', 'plant_equipment');

  if (assetErr) {
    console.error('[cert-import-parse] asset fetch failed', { tenant: session.tenant_id, error: assetErr.message });
    return json(500, { ok: false, error: 'db_error', detail: assetErr.message });
  }

  const canonicalAssets = (assetRows ?? []) as CanonicalAssetRef[];

  // Vision extraction via the AnthropicProvider. Timeout must be under the
  // Netlify function limit (26s); retries disabled so parallel files don't
  // compound. Escalation to Opus also disabled (too slow for a 26s budget).
  const ai = new AnthropicProvider({
    apiKey,
    timeoutMs: 22_000,
    maxRetries: 0,
    extractEscalationModel: 'claude-sonnet-4-5',
  });

  const files = await Promise.all(
    uploads.map(async (f) => ({ bytes: await f.arrayBuffer(), fileName: f.name })),
  );

  let result;
  try {
    result = await parseCalibrationCerts({ files, ai, canonicalAssets });
  } catch (e) {
    console.error('[cert-import-parse] parse failed', { tenant: session.tenant_id, error: (e as Error).message });
    return json(502, { ok: false, error: 'parse_failed', detail: (e as Error).message });
  }

  return json(200, {
    ok: true,
    summary: result.summary,
    rows: result.rows,
    warnings: result.warnings,
  });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return json(500, { ok: false, error: 'tenant_not_provisioned', detail: e.identifier });
  }
  if (e instanceof TenantNotActiveError) {
    return json(503, { ok: false, error: 'tenant_inactive', detail: e.status });
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[cert-import-parse] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[cert-import-parse] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
