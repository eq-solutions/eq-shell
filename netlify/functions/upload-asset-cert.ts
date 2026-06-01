// POST /.netlify/functions/upload-asset-cert  (multipart/form-data, field: file)
//
// Uploads a calibration / compliance certificate for a plant & equipment item
// to the public `asset-certs` bucket and returns its URL. The caller stores
// that URL in app_data.assets.cert_url (via asset-calibration). Mirrors
// upload-tenant-logo.ts.
//
// Auth: eq_shell_session cookie. Gated to manager / supervisor / platform_admin
// (the equipment.edit permission). Files are scoped to the tenant's folder.
//
// These are not treated as confidential (calibration certs for meters etc.), so
// the bucket is public-read and the URL opens directly — keeping the UX simple.

import { randomUUID } from 'node:crypto';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const BUCKET = 'asset-certs';

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
    return json(403, { ok: false, error: 'forbidden', detail: 'Uploading certificates requires manager or supervisor.' });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { ok: false, error: 'invalid_form_data' });
  }

  const file = form.get('file');
  if (!(file instanceof File)) return json(400, { ok: false, error: 'no_file' });
  if (file.size > MAX_BYTES) return json(400, { ok: false, error: 'file_too_large', detail: 'Maximum 10 MB.' });
  if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return json(400, { ok: false, error: 'invalid_type', detail: 'PDF or image (PNG/JPEG/WebP) only.' });
  }

  const baseName = (file.name || 'certificate').split(/[\\/]/).pop() || 'certificate';
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `${session.active_tenant_id}/${randomUUID()}-${safeName}`;

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return json(500, { ok: false, error: 'server_misconfigured', detail: (e as Error).message });
  }

  const buffer = await file.arrayBuffer();
  const { error: uploadError } = await sb.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error('[upload-asset-cert] upload failed', { tenant: session.active_tenant_id, error: uploadError.message });
    return json(500, { ok: false, error: 'upload_failed', detail: uploadError.message });
  }

  const { data: { publicUrl } } = sb.storage.from(BUCKET).getPublicUrl(path);
  return json(200, { ok: true, url: publicUrl });
});
