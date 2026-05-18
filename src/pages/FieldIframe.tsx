import { useEffect, useState } from 'react';

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
    return <div className="eq-field-frame-loading" role="alert">{err}</div>;
  }
  if (!src) {
    return <div className="eq-field-frame-loading">Loading EQ Field…</div>;
  }
  return (
    <iframe
      className="eq-field-frame"
      title="EQ Field"
      src={src}
      // Allow same-origin so Field's existing IndexedDB / cookies
      // continue to work; allow scripts; allow forms (PIN gate
      // submit in the no-shell-token fallback path).
      sandbox="allow-same-origin allow-scripts allow-forms allow-downloads allow-popups"
      // Camera/mic/etc not needed in Phase 1.B — extend later.
      allow=""
    />
  );
}
