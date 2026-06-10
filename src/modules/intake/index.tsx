// EQ Intake — mounts @eq/intake-demo's IntakeModule inside the shell.
//
// Auth via createSKSSupabaseClient() — mints a short-lived JWT for
// sks-canonical via /.netlify/functions/mint-sks-jwt and refreshes
// transparently before expiry. Entity data lives on sks-canonical
// (not eq-canonical), so the client is pointed there.
// Gated by useCan('intake.view'). Actions inside IntakeModule are gated
// by their own useCan() calls — see src/modules/intake/permissions.ts.

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { IntakeModule } from '@eq/intake-demo';
import '@eq/intake-demo/styles.css';
import { AnthropicProvider } from '@eq/ai';
import type { AIProvider } from '@eq/ai';
import { useSession } from '../../session';
import { Gate } from '../../permissions/Gate';
import { HubLayout } from '../../components/HubLayout';
import { defaultSidebarRecords } from '../../lib/sidebarConfig';
import { createSKSSupabaseClient } from '../../lib/sksSupabaseClient';

const SIDEBAR_RECORDS = defaultSidebarRecords();

// IntakeModule's structural SupabaseLikeClient expects insert(row) to
// return a Promise directly. @supabase/supabase-js returns a thenable
// PostgrestFilterBuilder. Runtime-compatible (both `await` correctly),
// but TS can't unify the types — hence the cast at the call site.
type SupabaseLikeClient = NonNullable<Parameters<typeof IntakeModule>[0]['supabase']>;

/**
 * Build an AnthropicProvider once per mount. Routes through the
 * /.netlify/functions/anthropic-proxy server-side proxy so the real API key
 * is never exposed to the browser (Anthropic blocks direct browser calls).
 *
 * Falls back to undefined (heuristic-only mode) when the env var is absent.
 */
function useAiProvider(): AIProvider | undefined {
  return useMemo(() => {
    // A placeholder key is fine — the proxy injects the real key server-side.
    // We still check for a non-empty env var so heuristic-only mode works
    // in environments where the proxy is not configured.
    const apiKey = (import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined) ?? 'proxy';
    if (!apiKey || apiKey.trim().length === 0) return undefined;
    return new AnthropicProvider({
      apiKey,
      baseUrl: '/api/anthropic-proxy',
    });
  }, []);
}

function IntakeShell() {
  const { session } = useSession();
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const aiProvider = useAiProvider();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = await createSKSSupabaseClient();
        if (!cancelled) setClient(sb);
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
      <div className="eq-loading" role="alert">
        Could not connect to Supabase: {err}
      </div>
    );
  }
  if (!client) {
    return <div className="eq-loading">Loading Intake…</div>;
  }

  return (
    <IntakeModule
      tenantId={session?.tenant.id}
      supabase={client as unknown as SupabaseLikeClient}
      ai={(aiProvider ?? null) as unknown as Parameters<typeof IntakeModule>[0]['ai']}
    />
  );
}

export default function ShellIntakeModule() {
  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <Gate
        perm="intake.view"
        fallback={
          <div className="eq-coming-soon">
            <p>Your role doesn't include Intake access. Ask your manager.</p>
          </div>
        }
      >
        <IntakeShell />
      </Gate>
    </HubLayout>
  );
}
