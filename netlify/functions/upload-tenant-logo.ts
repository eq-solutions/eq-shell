import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'] as const;
type AllowedMime = (typeof ALLOWED_TYPES)[number];

const EXT_MAP: Record<AllowedMime, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) {
    return jsonResponse(401, { error: 'Unauthorised' });
  }

  if (session.role !== 'manager' && !session.is_platform_admin) {
    return jsonResponse(403, { error: 'forbidden' });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResponse(400, { error: 'invalid-form-data' });
  }

  const file = form.get('file') as File | null;

  if (!file) {
    return jsonResponse(400, { error: 'no-file' });
  }

  if (file.size > 524288) {
    return jsonResponse(400, { error: 'file-too-large' });
  }

  if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return jsonResponse(400, { error: 'invalid-type' });
  }

  const mime = file.type as AllowedMime;
  const ext = EXT_MAP[mime];
  const tenantId = session.active_tenant_id;
  const path = `${tenantId}/logo${ext}`;

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await sb.storage
    .from('tenant-logos')
    .upload(path, arrayBuffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    return jsonResponse(500, { error: uploadError.message });
  }

  const {
    data: { publicUrl },
  } = sb.storage.from('tenant-logos').getPublicUrl(path);

  await sb.from('tenants').update({ brand_logo_url: publicUrl }).eq('id', tenantId);

  void sb.schema('public').rpc('eq_write_audit_log', {
    p_event: 'tenant.logo_upload',
    p_actor_id: session.user_id,
    p_tenant_id: tenantId,
    p_ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
    p_detail: { path },
  });

  return jsonResponse(200, { url: publicUrl });
});
