# Supabase Auth configuration — EQ Solves Service

Everything that has to be set in the Supabase dashboard for the invite / reset /
sign-in flow to work against production (`https://eq-solves-service.netlify.app`).

Project: `urjhmkhbgaxrofurpbgc` (eq-solves-service-dev — treat as prod for now).

> **2026-04-26 — major change. OTP CODES, NOT LINKS.** The invite and recovery
> email templates now carry a typed 8-digit code (`{{ .Token }}`) instead of
> a clickable token URL. Microsoft Defender Safe Links (and Mimecast,
> Proofpoint, Google Workspace's equivalent) pre-fetch every URL in inbound
> mail and burn one-shot Supabase tokens before the user can click them —
> users were getting "invite link expired" on every first-attempt click.
>
> The new flow:
>
>   - Email contains an 8-digit code in the body, plus a tokenless link to
>     `/auth/accept-invite?email=…` (or `/auth/reset-password?email=…`).
>     Defender can pre-fetch the link as much as it likes — there's nothing
>     to burn.
>   - User clicks the link, lands on the page with email pre-filled, types
>     the code from the same email, fills name/password, submits.
>   - Server action calls `supabase.auth.verifyOtp({ type: 'invite' | 'recovery' })`
>     to verify the code, then sets the password via the admin API.
>
> The previous link/`{{ .TokenHash }}` flow is still tolerated by
> `/auth/callback` for stale emails sitting in inboxes — it will redirect
> failed legacy attempts back into the OTP flow rather than leaving users
> stuck on a generic error.

---

## 1. Site URL + Redirect allowlist

Dashboard → **Authentication → URL Configuration**.

### Site URL
```
https://eq-solves-service.netlify.app
```

This is the base URL that gets templated into every `{{ .SiteURL }}` placeholder
in the email templates, and the fallback redirect when `redirectTo` isn't sent.

### Redirect URLs (Additional)
One URL per line — Supabase requires an exact match for any `redirectTo`
passed from the app. The OTP flow uses the page URLs directly (no callback);
`/auth/callback` is kept for OAuth + legacy stale emails.

```
https://eq-solves-service.netlify.app/auth/callback
https://eq-solves-service.netlify.app/auth/accept-invite
https://eq-solves-service.netlify.app/auth/reset-password
https://eq-solves-service.netlify.app/auth/forgot-password
https://eq-solves-service.netlify.app/auth/signin
https://eq-solves-service.netlify.app/auth/mfa
https://eq-solves-service.netlify.app/auth/enroll-mfa
https://*--eq-solves-service.netlify.app/auth/callback
https://*--eq-solves-service.netlify.app/auth/accept-invite
https://*--eq-solves-service.netlify.app/auth/reset-password
http://localhost:3000/auth/callback
http://localhost:3000/auth/accept-invite
http://localhost:3000/auth/reset-password
```

The `*--eq-solves-service.netlify.app` entries cover Netlify deploy-preview
branches. The `localhost` entries let dev builds receive emails — remove them
before going commercial.

Click **Save** at the bottom.

---

## 2. SMTP (Resend)

Dashboard → **Authentication → SMTP Settings** → must be configured for Resend.

If it shows "default provider" the invite emails will be rate-limited to 2/hour
and will not deliver reliably.

---

## 3. Email templates — OTP CODE FORMAT

Dashboard → **Authentication → Email Templates**. Each template has a **Subject**
and a **Body (HTML)** field. Paste exactly as written.

Placeholders:
- `{{ .SiteURL }}` — the Site URL set in §1.
- `{{ .Email }}` — recipient's email (used to pre-fill the form on the landing page).
- `{{ .Token }}` — the 8-digit OTP code the user types. **Critical — do not replace with `{{ .ConfirmationURL }}` or `{{ .TokenHash }}`. The code length (default 6, our project ships 8) is set under Authentication → Settings → Email OTP length.**

All templates use inlined styles (mail clients strip `<style>` blocks) and the
EQ brand tokens: `#3DA8D8` primary, `#2986B4` deep, `#EAF5FB` ice, `#1A1A2E`
ink. Plus Jakarta Sans is loaded with a sans-serif fallback.

---

### 3.1. Invite user

**Subject**
```
You've been invited to EQ Solves Service
```

**Body (HTML)**
```html
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#EAF5FB;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1A1A2E;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EAF5FB;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border:1px solid #E1EDF4;border-radius:8px;max-width:560px;">
            <tr>
              <td style="padding:32px 32px 16px 32px;border-bottom:1px solid #EAF5FB;">
                <div style="font-size:20px;font-weight:600;color:#2986B4;letter-spacing:-0.01em;">EQ Solves Service</div>
                <div style="font-size:13px;color:#6B7A8A;margin-top:2px;">by EQ &middot; CDC Solutions</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:600;color:#1A1A2E;letter-spacing:-0.01em;">You've been invited</h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#1A1A2E;">
                  You&rsquo;ve been invited to <strong>EQ Solves Service</strong> &mdash; the maintenance management platform for electrical contractors.
                </p>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.55;color:#1A1A2E;">
                  To finish setting up your account, open the invitation page and enter the code below.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px;" align="center">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background-color:#3DA8D8;border-radius:6px;">
                      <a href="{{ .SiteURL }}/auth/accept-invite?email={{ .Email }}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">Open invitation page</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;" align="center">
                <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;letter-spacing:0.1em;color:#6B7A8A;text-transform:uppercase;">Your 8-digit code</p>
                <div style="display:inline-block;padding:14px 24px;background-color:#EAF5FB;border:1px solid #C9DFEC;border-radius:6px;font-size:28px;font-weight:700;color:#1A1A2E;letter-spacing:8px;font-family:'Plus Jakarta Sans',monospace;">{{ .Token }}</div>
                <p style="margin:12px 0 0 0;font-size:13px;line-height:1.5;color:#6B7A8A;">
                  Type this code on the invitation page. It expires in 1 hour.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 28px 32px;">
                <p style="margin:0 0 6px 0;font-size:13px;line-height:1.5;color:#6B7A8A;">
                  Or copy this URL into your browser:
                </p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#2986B4;word-break:break-all;">
                  {{ .SiteURL }}/auth/accept-invite?email={{ .Email }}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background-color:#F7FBFD;border-top:1px solid #EAF5FB;border-radius:0 0 8px 8px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#6B7A8A;">
                  If you weren't expecting this invite, you can ignore this email &mdash; no account will be created without you entering the code above.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:11px;line-height:1.5;color:#8A96A3;max-width:560px;">
            &copy; EQ &middot; CDC Solutions Pty Ltd &middot; ABN 40 651 962 935 &middot; All rights reserved.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
```

---

### 3.2. Reset password

**Subject**
```
Reset your EQ Solves Service password
```

**Body (HTML)**
```html
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#EAF5FB;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1A1A2E;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EAF5FB;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border:1px solid #E1EDF4;border-radius:8px;max-width:560px;">
            <tr>
              <td style="padding:32px 32px 16px 32px;border-bottom:1px solid #EAF5FB;">
                <div style="font-size:20px;font-weight:600;color:#2986B4;letter-spacing:-0.01em;">EQ Solves Service</div>
                <div style="font-size:13px;color:#6B7A8A;margin-top:2px;">by EQ &middot; CDC Solutions</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:600;color:#1A1A2E;letter-spacing:-0.01em;">Reset your password</h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#1A1A2E;">
                  We received a request to reset the password for <strong>{{ .Email }}</strong>.
                </p>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.55;color:#1A1A2E;">
                  Open the reset page and enter the code below to choose a new password.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px;" align="center">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background-color:#3DA8D8;border-radius:6px;">
                      <a href="{{ .SiteURL }}/auth/reset-password?email={{ .Email }}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">Open reset page</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;" align="center">
                <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;letter-spacing:0.1em;color:#6B7A8A;text-transform:uppercase;">Your 8-digit code</p>
                <div style="display:inline-block;padding:14px 24px;background-color:#EAF5FB;border:1px solid #C9DFEC;border-radius:6px;font-size:28px;font-weight:700;color:#1A1A2E;letter-spacing:8px;font-family:'Plus Jakarta Sans',monospace;">{{ .Token }}</div>
                <p style="margin:12px 0 0 0;font-size:13px;line-height:1.5;color:#6B7A8A;">
                  Type this code on the reset page. It expires in 1 hour.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 28px 32px;">
                <p style="margin:0 0 6px 0;font-size:13px;line-height:1.5;color:#6B7A8A;">
                  Or copy this URL into your browser:
                </p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#2986B4;word-break:break-all;">
                  {{ .SiteURL }}/auth/reset-password?email={{ .Email }}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background-color:#F7FBFD;border-top:1px solid #EAF5FB;border-radius:0 0 8px 8px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#6B7A8A;">
                  If you didn't request a password reset, you can ignore this email &mdash; your password won't change without the code above.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:11px;line-height:1.5;color:#8A96A3;max-width:560px;">
            &copy; EQ &middot; CDC Solutions Pty Ltd &middot; ABN 40 651 962 935 &middot; All rights reserved.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
```

---

### 3.3. Magic Link (optional)

Not used by the current app flow. Leave on default. If we ever turn on
magic-link sign-in, mirror the Reset template and use `{{ .Token }}` with
a safe `/auth/signin?email=…` landing URL — same pattern, never put a
one-shot token in the URL.

---

### 3.4. Confirm signup / Change email

Same OTP pattern, same frame. If/when needed, clone §3.2 and swap heading +
body copy. Use `{{ .Token }}`, never `{{ .ConfirmationURL }}` or
`{{ .TokenHash }}`.

---

## 4. After changing config — smoke test

1. `/admin/users` → invite a fresh test user (e.g. `royce+test@eq.solutions`).
2. Open the email. The body must contain a visible 8-digit code in a
   bordered box, AND a button labelled "Open invitation page" pointing at
   `https://eq-solves-service.netlify.app/auth/accept-invite?email=...`
   (no `token_hash`, no `code`, just the email).
3. Click the link. You should land on `/auth/accept-invite` with the
   email pre-filled (read-only) and the 3-step rail.
4. Type the code from the email + your name + a 10+ char password.
   Submit. You should be signed in and redirected to `/dashboard`.
5. Sign out. Click "Forgot password" on the sign-in page. Enter the email.
   The page should swap to "We sent an 8-digit code to..." with code +
   new password fields.
6. Open the email. Same shape as step 2 but with "reset" copy. Type the
   code + new password into the page from step 5. Submit. You should be
   redirected to `/auth/signin?reset=ok`.
7. Sign in with the new password. Done.

If a test fails:
- "Code is incorrect" on a fresh code → check the template uses `{{ .Token }}`,
  not `{{ .TokenHash }}`. The code-entry endpoint expects the 8-digit form.
- Email never arrives → check Resend dashboard (status: Sent → Delivered).
  If stuck on Sent for >2 min, Defender / scanner is still processing it
  (see §5).
- Lands on `/auth/signin?error=link_expired` → user clicked an OLD email
  from before this migration. Send them a fresh invite.

---

## 5. Why OTP codes, not links

Microsoft Defender Safe Links (M365), Mimecast URL Defense, Proofpoint URL
Defense, and Google Workspace's equivalent all do the same thing: when an
email arrives in a corporate inbox, the security tooling pre-fetches every
URL in the body to scan it for malware. If that URL contains a one-shot
auth token, the scanner's GET request burns the token before the human
ever clicks the link — the user then sees "invalid or expired" on their
first real click.

Workarounds we considered and rejected:
- **Whitelist Supabase + Resend domains in Defender** — works for SKS users,
  but breaks again the moment we bring on Equinix or any other corporate
  customer. Not scalable for a multi-tenant SaaS.
- **Confirmation interstitial** ("click to confirm") — partial mitigation,
  scanners that follow a single redirect still burn the token.
- **PKCE flow with code_verifier** — the verifier is in the original tab,
  but Outlook's Safe Links opens the URL in a fresh window that has no
  verifier, so this still fails for many corporate users.

Typed OTP codes are the only flow that survives every scanner because
nothing in the email is consumable on its own — the token is just six
digits in plain text that a human has to copy.
