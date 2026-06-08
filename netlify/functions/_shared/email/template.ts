// Branded HTML email template for EQ Solutions transactional emails.
//
// Usage:
//   import { emailHtml } from './_shared/email/template.js';
//   sendEmail({ ..., html: emailHtml({ heading, body, ctaLabel, ctaUrl }) })
//
// Always include a `text` fallback alongside `html` — clients that strip HTML
// (or screen readers) need it.

export interface EmailTemplateOptions {
  /** Pre-header preview text (shown in inbox before email opens). */
  preheader?: string;
  /** Headline inside the white card. */
  heading: string;
  /** Body content — can include simple HTML like <strong>, <a>, <br>. */
  body: string;
  /** Optional CTA button label. Omit to render a text-only email. */
  ctaLabel?: string;
  /** Required when ctaLabel is set. */
  ctaUrl?: string;
  /** Footer note beneath the button. Defaults to standard sign-off. */
  footerNote?: string;
}

const SKY   = '#3DA8D8';
const INK   = '#1A1A2E';
const ICE   = '#EAF5FB';
const GREY  = '#6B7280';
const BGOUT = '#F5F4F0';
const WHITE = '#ffffff';

// Inline font stack — Plus Jakarta Sans won't load in most email clients;
// the stack falls back gracefully to system sans-serif.
const FONT = "'-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue', 'Arial', sans-serif";

export function emailHtml(opts: EmailTemplateOptions): string {
  const { preheader = '', heading, body, ctaLabel, ctaUrl, footerNote } = opts;

  const ctaBlock = ctaLabel && ctaUrl ? `
    <tr>
      <td align="center" style="padding: 8px 0 28px;">
        <a href="${ctaUrl}"
           target="_blank"
           style="display:inline-block;background:${SKY};color:${WHITE};font-family:${FONT};font-size:14px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;text-decoration:none;border-radius:6px;padding:13px 32px;line-height:1;">
          ${ctaLabel}
        </a>
        <p style="margin:12px 0 0;font-size:12px;color:${GREY};font-family:${FONT};">
          Or copy this link into your browser:<br>
          <a href="${ctaUrl}" style="color:${SKY};word-break:break-all;">${ctaUrl}</a>
        </p>
      </td>
    </tr>` : '';

  const footer = footerNote ?? 'If you weren\'t expecting this email you can ignore it — nothing will change.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>EQ Solutions</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:${BGOUT};font-family:${FONT};">

  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;color:${BGOUT};">${preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>` : ''}

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BGOUT};padding:40px 20px;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;">

          <!-- Header -->
          <tr>
            <td style="background:${INK};border-radius:12px 12px 0 0;padding:28px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <!-- Wordmark: "eq" circle + "EQ Solutions" text -->
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:32px;height:32px;background:${SKY};border-radius:50%;text-align:center;vertical-align:middle;">
                          <span style="color:${WHITE};font-size:13px;font-weight:800;font-family:${FONT};line-height:32px;">eq</span>
                        </td>
                        <td style="padding-left:10px;vertical-align:middle;">
                          <span style="color:${WHITE};font-size:15px;font-weight:700;font-family:${FONT};letter-spacing:-0.01em;">EQ Solutions</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:${WHITE};padding:40px 40px 8px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${INK};letter-spacing:-0.02em;font-family:${FONT};line-height:1.3;">
                ${heading}
              </h1>
              <div style="font-size:14px;color:#374151;line-height:1.6;font-family:${FONT};">
                ${body}
              </div>
            </td>
          </tr>

          <!-- CTA -->
          ${ctaBlock ? `<tr><td style="background:${WHITE};padding:0 40px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${ctaBlock}</table></td></tr>` : ''}

          <!-- Divider + footer note -->
          <tr>
            <td style="background:${ICE};border:1px solid #e5e7eb;border-top:1px solid #d1e9f5;border-radius:0 0 12px 12px;padding:20px 40px;">
              <p style="margin:0;font-size:12px;color:${GREY};line-height:1.5;font-family:${FONT};">
                ${footer}
              </p>
            </td>
          </tr>

          <!-- Outer footer -->
          <tr>
            <td align="center" style="padding:20px 0 0;">
              <p style="margin:0;font-size:11px;color:#9ca3af;font-family:${FONT};">
                © EQ Solutions &nbsp;·&nbsp;
                <a href="https://eq.solutions" style="color:#9ca3af;text-decoration:underline;">eq.solutions</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}
