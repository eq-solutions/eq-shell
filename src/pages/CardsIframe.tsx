// Embeds the existing EQ Cards Flutter web build as an iframe. Unlike
// the Field iframe (which mints a shell→Field handoff token), Cards
// keeps its own auth boundary for v1 — the user signs into Cards
// independently via email OTP the first time they open this surface,
// and the browser remembers the Supabase session for subsequent
// loads. SSO via the §18 share/redeem protocol (see
// C:\Projects\eq-cards\ARCHITECTURE.md) is deferred to Phase 2+.
//
// The Cards Netlify site at eq-cards.netlify.app must be deployed
// with the relaxed CSP frame-ancestors header (https://*.eq.solutions)
// for this iframe to render — see C:\Projects\eq-cards\web\_headers.
// Until that redeploy lands, this page renders an X-Frame-Options /
// CSP block in the dev console and an empty frame.
//
// The custom domain cards.eq.solutions is the eventual production
// target; until it's wired (Netlify custom domain + DNS), the
// netlify.app URL is canonical.

const CARDS_URL = 'https://eq-cards.netlify.app/';

export default function CardsIframe() {
  return (
    <iframe
      className="eq-cards-frame"
      title="EQ Cards"
      src={CARDS_URL}
      // allow-same-origin — Cards needs its own origin's localStorage
      // and IndexedDB for the Supabase session.
      // allow-scripts — Flutter web bundle.
      // allow-forms — email OTP entry + verify.
      // allow-downloads — Cards may export QR images or licence
      // photos in future; cheap to allow now.
      sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
      // Don't leak the parent tenant URL via Referer when Cards makes
      // outbound calls (PostHog EU, Sentry, Supabase). Cards's CSP
      // already restricts these origins; this just adds defence in
      // depth.
      referrerPolicy="no-referrer"
      // No camera / mic / geolocation needed — Cards's web path
      // already degrades OCR to file-picker per ARCHITECTURE §11.5.
      allow=""
    />
  );
}
