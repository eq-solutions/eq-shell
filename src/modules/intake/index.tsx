// EQ Intake — mounts @eq/intake-demo's IntakeModule inside the shell.
//
// Auth via createSupabaseClient() — refreshes the JWT transparently via
// /.netlify/functions/mint-supabase-jwt before expiry.
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
import { createSupabaseClient } from '../../lib/supabaseJwt';

const SIDEBAR_RECORDS = defaultSidebarRecords();

// IntakeModule's structural SupabaseLikeClient expects insert(row) to
// return a Promise directly. @supabase/supabase-js returns a thenable
// PostgrestFilterBuilder. Runtime-compatible (both `await` correctly),
// but TS can't unify the types — hence the cast at the call site.
type SupabaseLikeClient = NonNullable<Parameters<typeof IntakeModule>[0]['supabase']>;

/** Build an AnthropicProvider once per mount. Returns undefined when the API
 *  key env var is absent — IntakeModule degrades gracefully (heuristic-only). */
function useAiProvider(): AIProvider | undefined {
  return useMemo(() => {
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
    if (!apiKey || apiKey.trim().length === 0) return undefined;
    return new AnthropicProvider({ apiKey });
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
        const sb = await createSupabaseClient();
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
      ai={aiProvider}
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
