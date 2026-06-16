// /:tenantSlug/settings/profile — self-serve profile edit.
//
// Any signed-in user can change their own display name here. POSTs to
// /.netlify/functions/update-profile (which writes shell_control.users.name
// for the session user only), then refreshes the session so the sidebar /
// account menu picks up the new name immediately.

import { useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Button } from '@eq-solutions/ui';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { useSession } from '../session';

const SIDEBAR_RECORDS = defaultSidebarRecords();

export default function ProfileSettings() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session, refresh } = useSession();

  // `null` = untouched (show the session name); a string = user has edited the
  // field. This avoids seeding via an effect (which races session hydration and
  // trips react-hooks/set-state-in-effect) — the displayed value falls back to
  // the session name until the user types.
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const name = draft ?? session?.user.name ?? '';
  const setName = (v: string) => setDraft(v);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaved(false);
    const trimmed = name.trim();
    if (!trimmed) {
      setErr('Enter your name.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/.netlify/functions/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: trimmed }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) {
        const map: Record<string, string> = {
          'unauthorized': 'Sign in again to update your profile.',
          'bad-name': 'Enter your name (up to 120 characters).',
          'server-error': 'Something went wrong server-side — try again.',
        };
        setErr(map[body.error ?? ''] ?? 'Save failed. Try again.');
        setBusy(false);
        return;
      }
      // Re-hydrate the session so the sidebar + account menu show the new name.
      await refresh();
      setDraft(null); // field now tracks the refreshed session name
      setSaved(true);
    } catch {
      setErr('Network error — please try again.');
    }
    setBusy(false);
  }

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <div style={{ maxWidth: 540, margin: '0 auto' }}>
        <p style={{ marginBottom: 16 }}>
          <Link to={`/${tenantSlug ?? ''}`} style={{ fontSize: 13 }}>
            ← Back to hub
          </Link>
        </p>

        <div className="eq-page__header">
          <h1 className="eq-page__title">Your profile</h1>
          <p className="eq-page__lede">
            This is the name shown across EQ — in the sidebar, on rosters, and
            anywhere your account appears.
          </p>
        </div>

        <form onSubmit={onSubmit} style={{ marginTop: 24, maxWidth: 480 }}>
          <label
            htmlFor="profile-name"
            style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--eq-grey)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}
          >
            Display name
          </label>
          <input
            id="profile-name"
            type="text"
            autoComplete="name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
            disabled={busy}
            style={{
              width: '100%',
              height: 40,
              padding: '0 12px',
              border: '1px solid var(--gray-300)',
              borderRadius: 6,
              marginBottom: 20,
              background: 'var(--eq-bg)',
              color: 'var(--eq-ink)',
            }}
          />

          {session?.user.email && (
            <p style={{ fontSize: 12, color: 'var(--eq-grey)', marginTop: -8, marginBottom: 20 }}>
              Signed in as {session.user.email}
            </p>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Button type="submit" variant="primary" disabled={busy || !name.trim()} style={{ padding: '0 20px' }}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            {saved && (
              <span style={{ fontSize: 13, color: 'var(--eq-grey)' }}>Saved.</span>
            )}
          </div>

          {err && (
            <div className="eq-err" role="alert" style={{ marginTop: 16 }}>
              {err}
            </div>
          )}
        </form>
      </div>
    </HubLayout>
  );
}
