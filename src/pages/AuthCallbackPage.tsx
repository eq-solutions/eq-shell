// AuthCallbackPage — handles the Supabase magic-link redirect.
//
// Supabase sends the user back to /auth/callback with either:
//   ?code=XXXX  (PKCE flow — supabase-js auto-exchanges via detectSessionInUrl)
//   #access_token=...  (implicit flow — supabase-js reads the fragment)
//
// Either way, getSession() returns the session after detection.
// We then POST the access_token to shell-login-magic-link to mint
// the eq_shell_session cookie and redirect to the tenant hub.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { useSession } from '../session';
import { EqLogo } from '../components/EqLogo';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

function makeCallbackClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: true,
    },
  });
}

type Stage = 'exchanging' | 'signing-in' | 'error';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [stage, setStage] = useState<Stage>('exchanging');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function exchange() {
      const sb = makeCallbackClient();

      // getSession() auto-exchanges the code or reads the fragment.
      // Supabase sets the session internally even with persistSession:false
      // for the duration of this call.
      const { data: { session }, error: sessionErr } = await sb.auth.getSession();

      if (cancelled) return;

      if (sessionErr || !session) {
        setErrMsg('The sign-in link has expired or already been used. Request a new one.');
        setStage('error');
        return;
      }

      setStage('signing-in');

      let res: Response;
      try {
        res = await fetch('/.netlify/functions/shell-login-magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email: session.user.email,
            access_token: session.access_token,
          }),
        });
      } catch {
        if (!cancelled) {
          setErrMsg('Network error — please try again.');
          setStage('error');
        }
        return;
      }

      const body = (await res.json()) as
        | { valid: true; tenant: { slug: string } }
        | { valid: false; error?: string };

      if (cancelled) return;

      if (!body.valid) {
        const code = (body as { error?: string }).error;
        if (code === 'no-account') {
          setErrMsg("Your email isn't linked to an EQ workspace yet. Contact your administrator.");
        } else {
          setErrMsg('Sign-in failed. Try again or contact your administrator.');
        }
        setStage('error');
        return;
      }

      void refresh();
      navigate(`/${body.tenant.slug}`, { replace: true });
    }

    void exchange();
    return () => { cancelled = true; };
  }, [navigate, refresh]);

  return (
    <div className="eq-login-page">
      <div className="eq-login-card-wrap">
        <div className="eq-login-split">
          <div className="eq-login-left">
            <div className="eq-login-left__brand">
              <EqLogo size={28} variant="wordmark" onDark />
            </div>
            <p className="eq-login-left__eyebrow">EQ Solutions</p>
            <h1 className="eq-login-left__heading">
              Your tools.<br /><strong>One sign-in.</strong>
            </h1>
          </div>

          <div className="eq-login-right">
            {stage === 'exchanging' || stage === 'signing-in' ? (
              <>
                <p className="eq-login-right__eyebrow">Signing in</p>
                <h2 className="eq-login-right__title">One moment…</h2>
                <p className="eq-login-right__sub" style={{ color: 'var(--eq-muted)' }}>
                  {stage === 'exchanging' ? 'Verifying your link…' : 'Setting up your session…'}
                </p>
              </>
            ) : (
              <>
                <p className="eq-login-right__eyebrow">Sign in</p>
                <h2 className="eq-login-right__title">Something went wrong.</h2>
                <p className="eq-login-right__sub">{errMsg}</p>
                <a href="/" className="eq-login-submit" style={{ display: 'inline-block', marginTop: 16, textDecoration: 'none', textAlign: 'center' }}>
                  Back to sign in
                </a>
              </>
            )}
          </div>
        </div>

        <p className="eq-login-page__copy">
          © EQ Solutions · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
