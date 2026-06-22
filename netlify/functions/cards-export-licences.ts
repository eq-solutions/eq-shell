// GET /.netlify/functions/cards-export-licences
//
// Returns a ZIP containing:
//   register.csv          — all connected workers + licences, one row per licence
//   {Worker_Name}/        — one folder per worker
//     {Licence_Type}_front.jpg
//     {Licence_Type}_back.jpg
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

interface CredRow {
  id: string;
  worker_id: string;
  credential_type: string;
  licence_number: string | null;
  issuing_body: string | null;
  state_territory: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  photo_front_path: string | null;
  photo_back_path: string | null;
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
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  if (!can(session, 'admin.review_cards')) {
    return new Response(JSON.stringify({ error: 'Manager access required' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
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

  // All active workers connected to this org
  const { data: members } = (await sbPublic
    .from('org_memberships')
    .select('user_id')
    .eq('org_id', orgRow.id)
    .eq('status', 'active')) as { data: Array<{ user_id: string }> | null };

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
  const workerIds = (workers ?? []).map((w) => w.id);

  // Credentials
  let allCreds: CredRow[] = [];
  if (workerIds.length > 0) {
    const { data: creds } = (await sbPublic
      .from('worker_credentials')
      .select(
        'id, worker_id, credential_type, licence_number, issuing_body, ' +
        'state_territory, issue_date, expiry_date, photo_front_path, photo_back_path, never_expires',
      )
      .in('worker_id', workerIds)
      .is('deleted_at', null)
      .eq('status', 'active')) as { data: CredRow[] | null };
    allCreds = creds ?? [];
  }

  const credsByWorker = new Map<string, CredRow[]>();
  for (const c of allCreds) {
    const list = credsByWorker.get(c.worker_id) ?? [];
    list.push(c);
    credsByWorker.set(c.worker_id, list);
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
      'Licence Type', 'Licence Number', 'Issuing Body', 'State',
      'Issue Date', 'Expiry Date', 'Never Expires',
      'Photo Front', 'Photo Back',
    ].join(','),
  ];

  // Parallel photo downloads per worker to stay within function timeout
  await Promise.all(
    Array.from(workerMap.values()).map(async (worker) => {
      const fullName = [worker.first_name, worker.last_name].filter(Boolean).join(' ') || 'Unknown';
      const folder = slugify(fullName);
      const creds = credsByWorker.get(worker.id) ?? [];

      if (creds.length === 0) {
        csvRows.push([
          csvCell(fullName), csvCell(worker.phone), csvCell(worker.email),
          '', '', '', '', '', '', '', '', '',
        ].join(','));
        return;
      }

      await Promise.all(
        creds.map(async (c) => {
          const typeSlug = slugify(c.credential_type);
          let frontFile = '';
          let backFile = '';

          const [frontBuf, backBuf] = await Promise.all([
            c.photo_front_path ? fetchPhoto(c.photo_front_path) : Promise.resolve(null),
            c.photo_back_path  ? fetchPhoto(c.photo_back_path)  : Promise.resolve(null),
          ]);

          if (frontBuf) {
            frontFile = `${folder}/${typeSlug}_front.jpg`;
            zip.file(frontFile, frontBuf);
          }
          if (backBuf) {
            backFile = `${folder}/${typeSlug}_back.jpg`;
            zip.file(backFile, backBuf);
          }

          csvRows.push([
            csvCell(fullName),
            csvCell(worker.phone),
            csvCell(worker.email),
            csvCell(c.credential_type),
            csvCell(c.licence_number),
            csvCell(c.issuing_body),
            csvCell(c.state_territory),
            csvCell(c.issue_date),
            c.never_expires ? 'Never' : csvCell(c.expiry_date),
            c.never_expires ? 'Yes' : 'No',
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
