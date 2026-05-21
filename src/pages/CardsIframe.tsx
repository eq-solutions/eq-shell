// Embeds the EQ Cards Flutter web build as an iframe. Two modes:
//
//   1. PRE-UNIT-4 (today): Cards' own auth boundary; the user signs in
//      via email OTP independently the first time. No token passed.
//
//   2. POST-UNIT-4 (when Cards' Flutter flip ships): we mint a Supabase
//      JWT via /.netlify/functions/mint-cards-iframe-token and pass it
//      via URL hash (#sh=<jwt>). The Cards app reads the hash on load,
//      sets the Supabase session, and is authenticated against
//      canonical with the same tenant + role + platform_admin claims
//      the shell carries.
//
// The mode is controlled by the CARDS_USE_SHELL_SSO compile-time flag.
// When the Flutter flip ships, set CARDS_USE_SHELL_SSO=true (or remove
// the flag and the legacy path entirely).
//
// Spec: eq/cards/canonical-migration/plan.md §Unit 4 + §Unit 5.

import { useEffect, useState } from 'react';
import { Topbar } from '../components/Topbar';

const CARDS_URL = 'https://eq-cards.netlify.app/';

// Cards Unit 4 shipped 2026-05-21: Cards Flutter app reads the
// shell-minted JWT from the iframe URL hash and calls setSession.
// Cards' own email-OTP path is gone.
const CARDS_USE_SHELL_SSO = true;

export default function CardsIframe() {
  const [iframeSrc, setIframeSrc] = useState<string | null>(CARDS_USE_SHELL_SSO ? null : CARDS_URL);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!CARDS_USE_SHELL_SSO) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/mint-cards-iframe-token', {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(`mint-cards-iframe-token returned ${res.status}`);
        }
        const { token } = (await res.json()) as { token: string; exp: number };
        if (cancelled) return;
        // Pass via URL hash — hash never hits the server, so the JWT
        // doesn't appear in any access log. Cards reads window.location.hash
        // on first paint and clears it after setSession.
        setIframeSrc(`${CARDS_URL}#sh=${encodeURIComponent(token)}`);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <>
        <Topbar />
        <div className="eq-error" role="alert" style={{ margin: 28 }}>
          Could not initialise Cards: {err}
        </div>
      </>
    );
  }
  if (!iframeSrc) {
    return (
      <>
        <Topbar />
        <div className="eq-loading">Minting Cards token…</div>
      </>
    );
  }

  return (
    <>
      <Topbar />
      <iframe
        className="eq-cards-frame"
        title="EQ Cards"
        src={iframeSrc}
        sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
        referrerPolicy="no-referrer"
        allow=""
      />
    </>
  );
}
