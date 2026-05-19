// EQ Intake — mounts @eq/intake-demo's IntakeModule (the user-facing
// surface of EQ Format) inside the shell.
//
// Auth model: the shell's session payload includes a short-lived Supabase
// JWT (signed by the shell-login / verify-shell-session Netlify functions
// using the project's SUPABASE_JWT_SECRET). useSupabaseClient() builds
// a browser Supabase client around that JWT. Tenant scope is enforced by
// RLS on canonical reads and by the eq_intake_commit_batch RPC on writes.

import { IntakeModule } from '@eq/intake-demo';
import '@eq/intake-demo/styles.css';
import { useSession } from '../session';
import { useSupabaseClient } from '../supabase';

// IntakeModule's structural SupabaseLikeClient expects insert(row) to
// return a Promise directly. @supabase/supabase-js returns a thenable
// PostgrestFilterBuilder. Runtime-compatible (both `await` correctly),
// but TS can't unify the types — hence the cast.
type SupabaseLikeClient = NonNullable<Parameters<typeof IntakeModule>[0]['supabase']>;

export default function ShellIntakeModule() {
  const { session } = useSession();
  const supabase = useSupabaseClient();
  return (
    <IntakeModule
      tenantId={session?.tenant.id}
      supabase={supabase as unknown as SupabaseLikeClient | null}
    />
  );
}
