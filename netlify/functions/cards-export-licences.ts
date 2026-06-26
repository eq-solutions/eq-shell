// GET /.netlify/functions/cards-export-licences
//
// Returns a ZIP containing:
//   register.csv          — all connected workers + licences, one row per licence
//   {Worker_Name}/        — one folder per worker
//     {Worker_Name}_{Licence_Type}_{Number}_front.jpg
//     {Worker_Name}_{Licence_Type}_{Number}_back.jpg
//
// Manager + platform_admin only. Photos are served from the private
// licence-photos bucket via service role — no signed URLs exposed.

import type { Context } from '@netlify/functions';
import JSZip from 'jszip';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

interface WorkerRow {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
}

interface LicRow {
  id: string;
  user_id: string;
  licence_type: string;
  licence_number: string | null;
  expiry_date: string | null;
  photo_front_url: string | null;
  photo_back_url: string | null;
  never_expires: boolean;
}

function slugify(s: string): string {
  return s.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function csvCell(v: string | null | undefined): string {
  if (!v) return '';
  return v.includes(',') || v.includes('"') || v.includes('\n')
    ? `"${v.replace(/"/g, '""')}"`
    : v;
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET' && req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  if (!can(session, 'admin.review_cards')) {
    return new Response(JSON.stringify({ error: 'Manager access required' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Optional staff_ids filter (POST body) — limits export to the given app_data.staff IDs
  let staffIds: string[] | null = null;
  if (req.method === 'POST') {
    try {
      const body = (await req.json()) as { staff_ids?: string[] };
      if (Array.isArray(body.staff_ids) && body.staff_ids.length > 0) {
        staffIds = body.staff_ids;
      }
    } catch { /* no body — export all */ }
  }

  const sb = getServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbPublic = sb.schema('public') as any;
  const tenantId = session.tenant_id;

  // Resolve org
  const { data: orgRow } = (await sbPublic
    .from('organisations')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .maybeSingle()) as { data: { id: string; name: string } | null };

  if (!orgRow) {
    return new Response(JSON.stringify({ error: 'Organisation not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // When staff_ids filter is provided, resolve to canonical user_ids via workers.staff_id
  let filteredUserIds: string[] | null = null;
  if (staffIds) {
    const { data: linkedWorkers } = (await sbPublic
      .from('workers')
      .select('user_id')
      .in('staff_id', staffIds)) as { data: Array<{ user_id: string }> | null };
    filteredUserIds = (linkedWorkers ?? []).map((w) => w.user_id).filter(Boolean);
    if (filteredUserIds.length === 0) {
      return new Response(JSON.stringify({ workers: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Active workers connected to this org (optionally filtered to resolved user_ids)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let memberQuery: any = sbPublic
    .from('org_memberships')
    .select('user_id')
    .eq('org_id', orgRow.id)
    .eq('status', 'active');
  if (filteredUserIds) memberQuery = memberQuery.in('user_id', filteredUserIds);
  const { data: members } = (await memberQuery) as { data: Array<{ user_id: string }> | null };

  const userIds = (members ?? []).map((m) => m.user_id);
  if (userIds.length === 0) {
    return new Response(JSON.stringify({ workers: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Worker profiles
  const { data: workers } = (await sbPublic
    .from('workers')
    .select('id, user_id, first_name, last_name, phone, email')
    .in('user_id', userIds)) as { data: WorkerRow[] | null };

  const workerMap = new Map<string, WorkerRow>();
  for (const w of workers ?? []) workerMap.set(w.user_id, w);

  // Licences from canonical (public.licences) — the single source of truth
  const { data: allLics } = (await sbPublic
    .from('licences')
    .select(
      'id, user_id, licence_type, licence_number, expiry_date, ' +
      'photo_front_url, photo_back_url, never_expires',
    )
    .in('user_id', userIds)
    .is('deleted_at', null)
    // Honour the worker's privacy toggle — a licence marked private is hidden from
    // the roster/staff reads (staff-org-roster, staff-canonical-licences) and must
    // be excluded from the compliance export (number + ID photos) too.
    .eq('is_private', false)) as { data: LicRow[] | null };

  const licsByUser = new Map<string, LicRow[]>();
  for (const l of allLics ?? []) {
    const list = licsByUser.get(l.user_id) ?? [];
    list.push(l);
    licsByUser.set(l.user_id, list);
  }

  // Download a single photo from the private bucket. Returns null on any error.
  async function fetchPhoto(path: string): Promise<ArrayBuffer | null> {
    try {
      const { data } = await sb.storage.from('licence-photos').download(path);
      return data ? await data.arrayBuffer() : null;
    } catch {
      return null;
    }
  }

  // Assemble ZIP
  const zip = new JSZip();
  const csvRows: string[] = [
    [
      'Worker Name', 'Phone', 'Email',
      'Licence Type', 'Licence Number',
      'Expiry Date', 'Never Expires',
      'Photo Front', 'Photo Back',
    ].join(','),
  ];

  // Parallel photo downloads per worker to stay within function timeout
  await Promise.all(
    Array.from(workerMap.values()).map(async (worker) => {
      const fullName = [worker.first_name, worker.last_name].filter(Boolean).join(' ') || 'Unknown';
      // Cap the name slug so an unusually long legal name can't push a zip entry
      // path past filesystem limits once it's extracted into a nested folder.
      const nameSlug = slugify(fullName).slice(0, 40).replace(/_+$/, '') || 'Unknown';
      const folder = nameSlug;
      const lics = licsByUser.get(worker.user_id) ?? [];

      if (lics.length === 0) {
        csvRows.push([
          csvCell(fullName), csvCell(worker.phone), csvCell(worker.email),
          '', '', '', '', '', '',
        ].join(','));
        return;
      }

      await Promise.all(
        lics.map(async (l) => {
          const typeSlug = slugify(l.licence_type);
          // Lead each filename with the worker name so a photo stays
          // self-describing once dragged out of its folder, and include the
          // licence number (or a short id fallback) so two same-type licences
          // — e.g. an old card kept alongside its renewal — can't overwrite
          // each other inside the zip.
          const numSlug = l.licence_number ? slugify(l.licence_number) : '';
          const uniqSlug = numSlug || l.id.slice(0, 8);
          const stem = `${nameSlug}_${typeSlug}_${uniqSlug}`;
          let frontFile = '';
          let backFile = '';

          const [frontBuf, backBuf] = await Promise.all([
            l.photo_front_url ? fetchPhoto(l.photo_front_url) : Promise.resolve(null),
            l.photo_back_url  ? fetchPhoto(l.photo_back_url)  : Promise.resolve(null),
          ]);

          if (frontBuf) {
            frontFile = `${folder}/${stem}_front.jpg`;
            zip.file(frontFile, frontBuf);
          }
          if (backBuf) {
            backFile = `${folder}/${stem}_back.jpg`;
            zip.file(backFile, backBuf);
          }

          const neverExpires = l.never_expires || l.expiry_date === '9999-12-31';
          csvRows.push([
            csvCell(fullName),
            csvCell(worker.phone),
            csvCell(worker.email),
            csvCell(l.licence_type),
            csvCell(l.licence_number),
            neverExpires ? 'Never' : csvCell(l.expiry_date),
            neverExpires ? 'Yes' : 'No',
            frontFile ? 'Yes' : 'No',
            backFile  ? 'Yes' : 'No',
          ].join(','));
        }),
      );
    }),
  );

  zip.file('register.csv', csvRows.join('\r\n'));

  const today = new Date().toISOString().slice(0, 10);
  const orgSlug = slugify(orgRow.name);
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });

  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${orgSlug}_Compliance_${today}.zip"`,
      'Cache-Control': 'no-store',
      'Content-Length': String(buf.length),
    },
  });
});
