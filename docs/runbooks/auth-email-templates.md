# Auth email templates — shared "Magic Link" on jvkn

## Why this exists

EQ Shell and EQ Cards share one Supabase Auth project (`jvknxcmbtrfnxfrwfimn`,
eq-canonical). Both call `signInWithOtp({ email })`:

- **Shell** wants a **sign-in link** — it passes `emailRedirectTo: …/auth/callback`
  and the user clicks the link to land back signed in
  ([`src/pages/LoginPage.tsx`](../../src/pages/LoginPage.tsx) `onSendLink`).
- **Cards** wants a **6-digit code** — the Flutter web app prompts the user to
  type it back in.

Hosted Supabase has **one** "Magic Link" template slot, used by *both* flows.
Link-vs-code is decided purely by which variable the template contains:

| Variable | Renders as |
|---|---|
| `{{ .ConfirmationURL }}` | a clickable sign-in **link** (Shell uses this) |
| `{{ .Token }}` | a 6-digit **code** (Cards uses this) |

There is no per-app template on hosted Supabase. Before this change the template
held only `{{ .Token }}`, branded for Cards — so Shell's "Email link" door sent a
Cards-branded **code** email instead of a sign-in **link**. That's why the
Email-link door was held back for launch.

## The fix — one unified template carrying both

Resolution agreed 2026-06-06 (Royce): a single EQ-branded Magic Link template
that contains **both** a sign-in button (`ConfirmationURL`, for Shell) **and** an
"or enter this code" line (`Token`, for Cards). Each app's own UI tells the user
which to use; the email itself is neutral EQ branding and works for both.

This is config-only — there is no `supabase/config.toml` in this repo, so the
template lives in the Supabase dashboard / Management API, not in code. It is an
**auth-surface change**: do not apply to production without Royce's sign-off.

## Turnkey apply (recommended) — one command, backup-first

The template HTML is committed at
[`scripts/auth-templates/magic-link.html`](../../scripts/auth-templates/magic-link.html)
(single source — carries both `{{ .ConfirmationURL }}` and `{{ .Token }}`).
[`scripts/apply-auth-email-template.mjs`](../../scripts/apply-auth-email-template.mjs)
applies it via the Management API. It is **dry-run by default** and **backs up the
current config first**, so it's fully reversible.

```bash
# Token = personal access token, https://supabase.com/dashboard/account/tokens
# (same one the onboarding runbook uses). It is NOT stored in the repo.
export SUPABASE_ACCESS_TOKEN=sbp_...

node scripts/apply-auth-email-template.mjs verify          # read-only: shows current state
node scripts/apply-auth-email-template.mjs apply           # dry-run: prints the diff
node scripts/apply-auth-email-template.mjs apply --commit   # writes (backup saved first)
```

`apply --commit` sets the unified template + subject **and** merges
`core.eq.solutions/auth/callback` plus the deploy-preview wildcard into the
redirect allowlist (see below) in one go. To undo:

```bash
node scripts/apply-auth-email-template.mjs restore \
  --file=scripts/auth-templates/backup-<timestamp>.json --commit
```

The exact subject + HTML the script applies are reproduced below for review /
manual dashboard entry.

### Subject

```
Sign in to EQ
```

### Body (paste into Auth → Email Templates → Magic Link → Message body)

```html
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"
       style="background:#EAF5FB;padding:32px 0;font-family:'Plus Jakarta Sans',-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table width="440" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#ffffff;border:1px solid #d7e7f2;border-radius:12px;padding:36px;">
        <tr>
          <td style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#2986B4;font-weight:700;">
            EQ Solutions
          </td>
        </tr>
        <tr>
          <td style="padding-top:8px;font-size:22px;font-weight:700;color:#1A1A2E;">
            Sign in to EQ
          </td>
        </tr>
        <tr>
          <td style="padding-top:16px;font-size:15px;line-height:1.5;color:#1A1A2E;">
            Click the button below to sign in. No password needed.
          </td>
        </tr>
        <tr>
          <td style="padding-top:24px;">
            <a href="{{ .ConfirmationURL }}"
               style="display:inline-block;background:#3DA8D8;color:#ffffff;text-decoration:none;
                      font-size:15px;font-weight:700;padding:13px 28px;border-radius:8px;">
              Sign in &rarr;
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding-top:28px;font-size:14px;line-height:1.5;color:#4a4a63;">
            Or enter this code where prompted:
          </td>
        </tr>
        <tr>
          <td style="padding-top:8px;font-size:30px;font-weight:700;letter-spacing:.18em;color:#1A1A2E;">
            {{ .Token }}
          </td>
        </tr>
        <tr>
          <td style="padding-top:28px;font-size:13px;line-height:1.5;color:#7a7a90;">
            This link and code expire shortly. If you didn't ask to sign in,
            you can ignore this email.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

> Brand: Plus Jakarta Sans, `#3DA8D8` sky / `#2986B4` deep / `#EAF5FB` ice /
> `#1A1A2E` ink. No gradients, no shadows — per global house style. (Most mail
> clients won't load the web font; the `-apple-system`/Segoe/Roboto fallback
> stack keeps it clean everywhere.)

### Apply via Management API (alternative to the dashboard)

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/jvknxcmbtrfnxfrwfimn/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "mailer_subjects_magic_link": "Sign in to EQ",
        "mailer_templates_magic_link_content": "<...HTML above, escaped...>"
      }'
```

`SUPABASE_ACCESS_TOKEN` is the personal access token from
https://supabase.com/dashboard/account/tokens (same one the onboarding runbook
uses). The token is account-scoped — keep it out of the repo and out of CI logs.

## Redirect URL allowlist — required for the link to work

Supabase only honours `emailRedirectTo` values that are in **Auth → URL
Configuration → Redirect URLs**. Without the callback URL allowlisted, the link
errors instead of signing in.

| Context | URL to allowlist |
|---|---|
| Production | `https://core.eq.solutions/auth/callback` (confirm it's present) |
| Deploy preview | `https://deploy-preview-*--eq-shell.netlify.app/auth/callback` (wildcard), or the specific preview URL for a one-off smoke |

The deploy-preview entry is what lets you click-test the magic link end-to-end on
a PR preview — see [`deploy-preview-env.md`](./deploy-preview-env.md) for the
matching env-var scoping.

## Verifying after the change

1. **Cards (code) still works** — from the Cards web app, request an email sign-in
   code, confirm the email arrives with the EQ-branded code and that typing it
   back signs you in. The `{{ .Token }}` line is unchanged in substance, so this
   should be unaffected; verify anyway since it's the same shared template.
2. **Shell (link) works** — at the Shell login, pick **Email link**, enter your
   email, click the link in the email → it should land on `/auth/callback`,
   exchange the session, and drop you on your tenant hub.
3. Both emails are the *same* template now: each carries a link **and** a code.
   That's intended — Cards users use the code, Shell users use the link.

## What this does NOT change

- No repo code is required for the template itself — it's Supabase Auth config.
- `shell-login-magic-link.ts`, `AuthCallbackPage.tsx`, and the `onSendLink` flow
  are already built and unchanged.
- The other five template slots (Confirm signup, Invite, Change Email, Reset
  Password, Reauthentication) are untouched.
