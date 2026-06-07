#!/usr/bin/env node
// scripts/apply-auth-email-template.mjs
//
// Apply the unified EQ "Magic Link" email template to the shared canonical Auth
// project (jvkn / eq-canonical) so Shell's Email-link door sends a sign-in LINK
// while EQ Cards keeps getting its CODE — both from the one shared template slot.
// See docs/runbooks/auth-email-templates.md for the why.
//
// The template HTML is the single source in scripts/auth-templates/magic-link.html.
// It carries BOTH {{ .ConfirmationURL }} (link, Shell) and {{ .Token }} (code, Cards).
//
// This touches PRODUCTION auth config on a shared project Cards depends on, so it
// is BACKUP-FIRST and DRY-RUN by default. Nothing is written without --commit.
//
// Subcommands:
//   verify   GET current config; report subject + whether ConfirmationURL/Token
//            are present + the redirect (uri_allow_list) entries. Read-only.
//   backup   GET current config; save subject + template + uri_allow_list to a
//            timestamped JSON so the change is restorable. Read-only.
//   apply    Show the diff (subject, template, redirect URLs to add). With
//            --commit, PATCH the config. Always writes a backup first.
//
// Usage:
//   export SUPABASE_ACCESS_TOKEN=sbp_...      # https://supabase.com/dashboard/account/tokens
//   node scripts/apply-auth-email-template.mjs verify
//   node scripts/apply-auth-email-template.mjs apply            # dry-run (prints diff)
//   node scripts/apply-auth-email-template.mjs apply --commit   # writes (backup first)
//
// Restore (if ever needed):
//   node scripts/apply-auth-email-template.mjs restore --file=scripts/auth-templates/backup-<ts>.json --commit
//
// Flags:
//   --ref=<projectRef>   default jvknxcmbtrfnxfrwfimn (eq-canonical control plane)
//   --redirect=<url>     repeatable; redirect URLs to ensure in the allowlist.
//                        Defaults: core.eq.solutions + deploy-preview wildcard.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { requireAccessToken } from './_mgmt.mjs';

const MGMT = 'https://api.supabase.com/v1';
const DEFAULT_REF = 'jvknxcmbtrfnxfrwfimn'; // eq-canonical (shared Shell + Cards auth)
const SUBJECT = 'Sign in to EQ';
const DEFAULT_REDIRECTS = [
  'https://core.eq.solutions/auth/callback',
  'https://deploy-preview-*--eq-shell.netlify.app/auth/callback',
];

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(here, 'auth-templates', 'magic-link.html');

function parseArgs(argv) {
  const out = { _: [], redirect: [], commit: false };
  for (const a of argv) {
    if (a === '--commit') out.commit = true;
    else if (a.startsWith('--redirect=')) out.redirect.push(a.slice('--redirect='.length));
    else if (a.startsWith('--ref=')) out.ref = a.slice('--ref='.length);
    else if (a.startsWith('--file=')) out.file = a.slice('--file='.length);
    else if (!a.startsWith('--')) out._.push(a);
  }
  return out;
}

async function getAuthConfig(ref) {
  const res = await fetch(`${MGMT}/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${requireAccessToken()}` },
  });
  if (!res.ok) {
    throw new Error(`GET config/auth failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  }
  return res.json();
}

async function patchAuthConfig(ref, body) {
  const res = await fetch(`${MGMT}/projects/${ref}/config/auth`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${requireAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PATCH config/auth failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  }
  return res.json();
}

// uri_allow_list is a comma-separated string. Merge in the wanted URLs, keep order/dedup.
function mergeAllowList(current, wanted) {
  const have = String(current ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const set = new Set(have);
  const added = [];
  for (const w of wanted) {
    if (!set.has(w)) {
      have.push(w);
      set.add(w);
      added.push(w);
    }
  }
  return { value: have.join(','), added };
}

function summarizeTemplate(html) {
  return {
    hasLink: html.includes('{{ .ConfirmationURL }}'),
    hasCode: html.includes('{{ .Token }}'),
    bytes: html.length,
  };
}

function tsStamp() {
  // ISO without ms/colons — filesystem-safe.
  return new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
}

async function cmdVerify(ref) {
  const cfg = await getAuthConfig(ref);
  const cur = cfg.mailer_templates_magic_link_content ?? '';
  const s = summarizeTemplate(cur);
  console.log(`Project ............ ${ref}`);
  console.log(`Magic Link subject . ${cfg.mailer_subjects_magic_link ?? '(unset)'}`);
  console.log(`Template has LINK .. ${s.hasLink ? 'yes' : 'NO'}  (Shell needs this)`);
  console.log(`Template has CODE .. ${s.hasCode ? 'yes' : 'NO'}  (Cards needs this)`);
  console.log(`Template bytes ..... ${s.bytes}`);
  console.log('Redirect allowlist (uri_allow_list):');
  for (const u of String(cfg.uri_allow_list ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    console.log(`  - ${u}`);
  }
  const verdict = s.hasLink && s.hasCode ? 'UNIFIED (link+code) ✓' : 'NOT unified — Shell or Cards is broken';
  console.log(`Verdict ............ ${verdict}`);
}

async function cmdBackup(ref) {
  const cfg = await getAuthConfig(ref);
  const snap = {
    saved_at: new Date().toISOString(),
    ref,
    mailer_subjects_magic_link: cfg.mailer_subjects_magic_link ?? null,
    mailer_templates_magic_link_content: cfg.mailer_templates_magic_link_content ?? null,
    uri_allow_list: cfg.uri_allow_list ?? null,
  };
  const path = join(here, 'auth-templates', `backup-${tsStamp()}.json`);
  writeFileSync(path, JSON.stringify(snap, null, 2));
  console.log(`Backed up current Magic Link config to:\n  ${path}`);
  return path;
}

async function cmdApply(ref, redirects, commit) {
  const html = readFileSync(TEMPLATE_PATH, 'utf8');
  const s = summarizeTemplate(html);
  if (!s.hasLink || !s.hasCode) {
    throw new Error(`Refusing to apply: ${TEMPLATE_PATH} must contain BOTH {{ .ConfirmationURL }} and {{ .Token }}`);
  }
  const cfg = await getAuthConfig(ref);
  const { value: allowList, added } = mergeAllowList(cfg.uri_allow_list, redirects);

  console.log(`Project ................ ${ref}`);
  console.log(`Subject ... ${cfg.mailer_subjects_magic_link ?? '(unset)'}  ->  ${SUBJECT}`);
  console.log(`Template .. ${summarizeTemplate(cfg.mailer_templates_magic_link_content ?? '').bytes} bytes  ->  ${s.bytes} bytes (link+code)`);
  console.log(`Redirect URLs to add ... ${added.length ? added.join(', ') : '(none — already present)'}`);

  if (!commit) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to apply (a backup is taken first).');
    return;
  }

  await cmdBackup(ref);
  await patchAuthConfig(ref, {
    mailer_subjects_magic_link: SUBJECT,
    mailer_templates_magic_link_content: html,
    uri_allow_list: allowList,
  });
  console.log('\nApplied ✓  — verifying:');
  await cmdVerify(ref);
  console.log('\nNow confirm EQ Cards email-OTP still works (same shared template), then the');
  console.log('Shell Email-link click-through end to end. See docs/runbooks/auth-email-templates.md.');
}

async function cmdRestore(ref, file, commit) {
  if (!file) throw new Error('restore needs --file=<backup.json>');
  const snap = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`Restoring Magic Link config on ${ref} from ${file} (saved ${snap.saved_at})`);
  if (!commit) {
    console.log('DRY RUN — re-run with --commit to write.');
    return;
  }
  await patchAuthConfig(ref, {
    mailer_subjects_magic_link: snap.mailer_subjects_magic_link,
    mailer_templates_magic_link_content: snap.mailer_templates_magic_link_content,
    uri_allow_list: snap.uri_allow_list,
  });
  console.log('Restored ✓');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ref = args.ref ?? DEFAULT_REF;
  const cmd = args._[0] ?? 'verify';
  const redirects = args.redirect.length ? args.redirect : DEFAULT_REDIRECTS;

  switch (cmd) {
    case 'verify': return cmdVerify(ref);
    case 'backup': return void (await cmdBackup(ref));
    case 'apply': return cmdApply(ref, redirects, args.commit);
    case 'restore': return cmdRestore(ref, args.file, args.commit);
    default:
      console.error(`Unknown command "${cmd}". Use: verify | backup | apply | restore`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\nFAILED: ${e.message}`);
  process.exit(1);
});
