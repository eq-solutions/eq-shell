// netlify/functions/licence-expiry-scheduler.ts
//
// Scheduled Function — fires daily at 22:00 UTC (08:00 AEST).
//
// For each active tenant:
//   1. Sends a 30-day expiry warning email to each worker whose licence
//      expires in exactly 30 days (one email per worker, all licences listed).
//   2. Sends a 7-day expiry warning email to each worker whose licence
//      expires in exactly 7 days.
//   3. On Mondays: sends a weekly admin digest to each org admin listing
//      everything expiring in the next 30 days.
//
// Using exact-day triggers (= TODAY + 30 / + 7) means each licence gets
// at most two worker emails regardless of how many times the scheduler runs.
// No notifications table needed.
//
// Env vars:
//   SCHEDULER_TENANT_SLUGS — comma-separated active tenant slugs (default: "sks")
//   EQ_EMAIL_PROVIDER      — "resend" to send, unset = log-only dev mode
//   RESEND_API_KEY         — required when provider is "resend"

import type { Config } from '@netlify/functions';
import {
  getTenantRpcClient,
  TenantNotFoundError,
  TenantNotActiveError,
} from './_shared/tenant-routing.js';
import { sendEmail } from './_shared/email.js';
import { emailHtml } from './_shared/email/template.js';
import { withSentry, captureServerError } from './_shared/sentry.js';

export const config: Config = {
  schedule: '0 22 * * *',
};

// ── Types matching the RPC return shapes ──────────────────────────────────────

interface ExpiringLicenceRow {
  licence_id: string;
  licence_type: string;
  licence_number: string | null;
  expiry_date: string;           // ISO date string "YYYY-MM-DD"
  worker_user_id: string;
  worker_first_name: string;
  worker_last_name: string;
  worker_email: string | null;
  worker_phone: string | null;
}

interface OrgAdminRow {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  // "2026-08-14" → "14 August 2026"
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(y, m - 1, d));
}

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isMonday(): boolean {
  return new Date().getDay() === 1;
}

// ── Email builders ─────────────────────────────────────────────────────────────

function buildWorkerEmail(
  firstName: string,
  daysLeft: number,
  licences: ExpiringLicenceRow[],
): { subject: string; text: string; html: string } {
  const urgency = daysLeft <= 7 ? '⚠️ Action required — ' : '';
  const subject = `${urgency}Licence${licences.length > 1 ? 's' : ''} expiring in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`;

  const licenceLines = licences.map(l => {
    const type = l.licence_type ?? 'Licence';
    const num  = l.licence_number ? ` (${l.licence_number})` : '';
    const exp  = fmtDate(l.expiry_date);
    return `  • ${type}${num} — expires ${exp}`;
  });

  const text = [
    `Hi ${firstName},`,
    '',
    `This is a reminder that the following licence${licences.length > 1 ? 's' : ''} in your EQ wallet ${daysLeft === 1 ? 'expire tomorrow' : `expire${licences.length > 1 ? '' : 's'} in ${daysLeft} days`}:`,
    '',
    ...licenceLines,
    '',
    'Please renew before the expiry date to stay compliant.',
    '',
    'Open your EQ wallet at cards.eq.solutions',
    '',
    '— EQ Solutions',
  ].join('\n');

  const licenceTable = licences.map(l => {
    const type = l.licence_type ?? 'Licence';
    const num  = l.licence_number ? `<br><span style="font-size:12px;color:#6B7280;">${esc(l.licence_number)}</span>` : '';
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#1A1A2E;line-height:1.4;">
          <strong>${esc(type)}</strong>${num}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#1A1A2E;text-align:right;white-space:nowrap;">
          ${esc(fmtDate(l.expiry_date))}
        </td>
      </tr>`;
  }).join('');

  const daysLabel = daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
  const body = `
    <p>Hi ${esc(firstName)},</p>
    <p>The following licence${licences.length > 1 ? 's' : ''} in your EQ wallet ${licences.length > 1 ? 'expire' : 'expires'} <strong>${daysLabel}</strong>. Please renew before the expiry date to stay compliant.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:20px 0;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="text-align:left;font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Licence</th>
          <th style="text-align:right;font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Expiry</th>
        </tr>
      </thead>
      <tbody>${licenceTable}</tbody>
    </table>
    <p>Tap the button below to open your wallet and check your licences.</p>
  `;

  const html = emailHtml({
    preheader: `Your licence${licences.length > 1 ? 's' : ''} ${licences.length > 1 ? 'expire' : 'expires'} ${daysLabel} — open EQ to check.`,
    heading: `Licence expiry reminder`,
    body,
    ctaLabel: 'Open EQ Wallet',
    ctaUrl: 'https://cards.eq.solutions',
    footerNote: 'You\'re receiving this because you have an EQ Cards wallet. Visit cards.eq.solutions to manage your licences.',
  });

  return { subject, text, html };
}

function buildAdminDigestEmail(
  orgName: string,
  adminFirstName: string,
  licences: ExpiringLicenceRow[],
): { subject: string; text: string; html: string } {
  const subject = `Compliance digest — ${licences.length} licence${licences.length !== 1 ? 's' : ''} expiring in the next 30 days`;

  const sorted = [...licences].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));

  const workerLines = sorted.map(l => {
    const name = `${l.worker_first_name} ${l.worker_last_name}`;
    const type = l.licence_type ?? 'Licence';
    const num  = l.licence_number ? ` (${l.licence_number})` : '';
    return `  • ${name} — ${type}${num} — ${fmtDate(l.expiry_date)}`;
  });

  const text = [
    `Hi ${adminFirstName},`,
    '',
    `Here's your weekly compliance digest for ${orgName}.`,
    '',
    `${licences.length} licence${licences.length !== 1 ? 's' : ''} expiring in the next 30 days:`,
    '',
    ...workerLines,
    '',
    'View the full compliance matrix at core.eq.solutions',
    '',
    '— EQ Solutions',
  ].join('\n');

  const tableRows = sorted.map(l => {
    const name = `${esc(l.worker_first_name)} ${esc(l.worker_last_name)}`;
    const type = l.licence_type ?? 'Licence';
    const num  = l.licence_number ? ` <span style="color:#6B7280;">(${esc(l.licence_number)})</span>` : '';
    const daysLeft = Math.round(
      (new Date(l.expiry_date).getTime() - Date.now()) / 86_400_000
    );
    const urgency = daysLeft <= 7
      ? 'color:#dc2626;font-weight:700;'
      : daysLeft <= 14
        ? 'color:#d97706;font-weight:600;'
        : 'color:#1A1A2E;';
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#1A1A2E;">${name}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#1A1A2E;">${esc(type)}${num}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:13px;${urgency}text-align:right;white-space:nowrap;">${esc(fmtDate(l.expiry_date))}</td>
      </tr>`;
  }).join('');

  const body = `
    <p>Hi ${esc(adminFirstName)},</p>
    <p>Here's your weekly compliance digest for <strong>${esc(orgName)}</strong>. The following ${licences.length} licence${licences.length !== 1 ? 's' : ''} will expire in the next 30 days.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:20px 0;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="text-align:left;font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Worker</th>
          <th style="text-align:left;font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Licence</th>
          <th style="text-align:right;font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Expiry</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
    <p style="font-size:12px;color:#6B7280;">Red = expiring ≤ 7 days &nbsp;·&nbsp; Amber = expiring ≤ 14 days</p>
  `;

  const html = emailHtml({
    preheader: `${licences.length} licence${licences.length !== 1 ? 's' : ''} expiring in the next 30 days for ${orgName}.`,
    heading: 'Weekly compliance digest',
    body,
    ctaLabel: 'View Staff Compliance',
    ctaUrl: 'https://core.eq.solutions/staff',
    footerNote: `You're receiving this as an admin of ${orgName} on EQ Solutions.`,
  });

  return { subject, text, html };
}

// ── Per-tenant processing ──────────────────────────────────────────────────────

interface TenantResult {
  slug: string;
  worker_emails_sent: number;
  admin_emails_sent: number;
  error?: string;
}

async function processTenant(slug: string): Promise<TenantResult> {
  const supabase = await getTenantRpcClient(slug);

  // Resolve org_id from slug.
  const { data: orgRow, error: orgErr } = await supabase
    .from('organisations')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle<{ id: string; name: string }>();

  if (orgErr || !orgRow) {
    const msg = orgErr?.message ?? `no organisation row for slug "${slug}"`;
    console.warn(`[licence-expiry-scheduler] ${slug}: ${msg}`);
    return { slug, worker_emails_sent: 0, admin_emails_sent: 0, error: msg };
  }

  const orgId   = orgRow.id;
  const orgName = orgRow.name;

  // ── Worker emails: 30-day and 7-day exact-match ────────────────────────────

  const today       = new Date();
  const date30      = new Date(today); date30.setDate(today.getDate() + 30);
  const date7       = new Date(today); date7.setDate(today.getDate() + 7);
  const toISO       = (d: Date) => d.toISOString().slice(0, 10);

  const workerEmailsSent: number[] = [];

  for (const { days, targetDate } of [
    { days: 30, targetDate: toISO(date30) },
    { days: 7,  targetDate: toISO(date7)  },
  ]) {
    const { data: rows, error } = await supabase.rpc('eq_get_licences_expiring_on', {
      p_org_id:      orgId,
      p_target_date: targetDate,
    }) as { data: ExpiringLicenceRow[] | null; error: { message: string } | null };

    if (error) {
      console.error(`[licence-expiry-scheduler] ${slug} rpc error (${days}d):`, error.message);
      continue;
    }
    if (!rows || rows.length === 0) continue;

    // Group by worker — one email per worker listing all their licences.
    const byWorker = new Map<string, { row: ExpiringLicenceRow; licences: ExpiringLicenceRow[] }>();
    for (const row of rows) {
      if (!row.worker_email) continue;
      const key = row.worker_email.toLowerCase();
      if (!byWorker.has(key)) byWorker.set(key, { row, licences: [] });
      byWorker.get(key)!.licences.push(row);
    }

    let sent = 0;
    for (const { row, licences } of byWorker.values()) {
      const { subject, text, html } = buildWorkerEmail(row.worker_first_name, days, licences);
      const result = await sendEmail({ to: row.worker_email!, subject, text, html });
      if (result.delivered) sent++;
      console.log(`[licence-expiry-scheduler] worker ${days}d → ${row.worker_email}: delivered=${result.delivered}`);
    }
    workerEmailsSent.push(sent);
  }

  const totalWorkerEmails = workerEmailsSent.reduce((a, b) => a + b, 0);

  // ── Admin digest: send on Mondays only ────────────────────────────────────

  let adminEmailsSent = 0;

  if (isMonday()) {
    const { data: expiring, error: expErr } = await supabase.rpc('eq_get_licences_expiring_within', {
      p_org_id:     orgId,
      p_days_ahead: 30,
    }) as { data: ExpiringLicenceRow[] | null; error: { message: string } | null };

    if (expErr) {
      console.error(`[licence-expiry-scheduler] ${slug} admin digest rpc error:`, expErr.message);
    } else {
      const { data: admins, error: admErr } = await supabase.rpc('eq_get_org_admins', {
        p_org_id: orgId,
      }) as { data: OrgAdminRow[] | null; error: { message: string } | null };

      if (admErr) {
        console.error(`[licence-expiry-scheduler] ${slug} admin rpc error:`, admErr.message);
      } else if (admins && admins.length > 0) {
        const allExpiring = expiring ?? [];

        if (allExpiring.length === 0) {
          console.log(`[licence-expiry-scheduler] ${slug} admin digest: nothing expiring — skipping`);
        } else {
          for (const admin of admins) {
            const { subject, text, html } = buildAdminDigestEmail(orgName, admin.first_name, allExpiring);
            const result = await sendEmail({ to: admin.email, subject, text, html });
            if (result.delivered) adminEmailsSent++;
            console.log(`[licence-expiry-scheduler] admin digest → ${admin.email}: delivered=${result.delivered}`);
          }
        }
      }
    }
  }

  console.log(`[licence-expiry-scheduler] ${slug}: worker_emails=${totalWorkerEmails} admin_emails=${adminEmailsSent}`);
  return { slug, worker_emails_sent: totalWorkerEmails, admin_emails_sent: adminEmailsSent };
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default withSentry(async (): Promise<Response> => {
  const slugsRaw = process.env.SCHEDULER_TENANT_SLUGS ?? 'sks';
  const slugs    = slugsRaw.split(',').map((s) => s.trim()).filter(Boolean);

  const results: TenantResult[] = await Promise.all(
    slugs.map(async (slug) => {
      try {
        return await processTenant(slug);
      } catch (e) {
        if (e instanceof TenantNotFoundError || e instanceof TenantNotActiveError) {
          console.warn(`[licence-expiry-scheduler] ${slug}: not found or inactive — skipping`);
          return { slug, worker_emails_sent: 0, admin_emails_sent: 0, error: 'tenant_not_active' };
        }
        captureServerError(e, { context: 'licence-expiry-scheduler', slug });
        console.error(`[licence-expiry-scheduler] ${slug} unexpected error:`, e);
        return { slug, worker_emails_sent: 0, admin_emails_sent: 0, error: String(e) };
      }
    }),
  );

  const anyError = results.some((r) => r.error && r.error !== 'tenant_not_active');
  return new Response(JSON.stringify({ ok: !anyError, results }), {
    status: anyError ? 207 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
