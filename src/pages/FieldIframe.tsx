import { useEffect, useState } from 'react';
import { Topbar } from '../components/Topbar';

// Embeds the existing EQ Field deploy as an iframe. The shell mints
// a 60s HMAC handoff token, passes it via URL hash (NOT query —
// Field clears the hash on consume so the token doesn't end up in
// history/screenshots). See Phase 1.C, PR #106 on eq-field-app/demo
// for the Field-side consumer.

const FIELD_URL = 'https://eq-solves-field.netlify.app/';

export default function FieldIframe() {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/mint-iframe-token', {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) {
          setErr('Could not authorise the EQ Field handoff. Try signing in again.');
          return;
        }
        const body = (await res.json()) as { token: string };
        if (!cancelled) setSrc(`${FIELD_URL}#sh=${encodeURIComponent(body.token)}`);
      } catch {
        if (!cancelled) setErr('Network error reaching the EQ Field handoff endpoint.');
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
        <div className="eq-field-frame-loading" role="alert">{err}</div>
      </>
    );
  }
  if (!src) {
    return (
      <>
        <Topbar />
        <div className="eq-field-frame-loading">Loading EQ Field…</div>
      </>
    );
  }
  return (
    <>
    <Topbar />
    <iframe
      className="eq-field-frame"
      title="EQ Field"
      src={src}
      // Allow same-origin so Field's existing IndexedDB / cookies
      // continue to work; allow scripts; allow forms (PIN gate
      // submit in the no-shell-token fallback path); allow downloads
      // for CSV exports. allow-popups was previously here but no
      // Field surface opens new windows in the iframe flow — removed
      // to tighten the sandbox.
      sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
      // referrerPolicy="no-referrer" — don't leak the parent
      // (<tenant>.eq.solutions) URL via Referer header when Field
      // makes outbound requests. The iframe handoff token in the URL
      // hash already isn't sent as Referer (hashes aren't sent), but
      // this stops any path-based info from leaking to e.g. PostHog.
      referrerPolicy="no-referrer"
      // Camera/mic/etc not needed in Phase 1.B — extend later.
      allow=""
    />
    </>
  );
}
