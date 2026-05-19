// EQ Intake — mounts @eq/intake-demo's IntakeModule (the user-facing
// surface of EQ Format) inside the shell.
//
// Today: Supabase is NOT passed down. The shell's session is cookie-based
// against Netlify functions; there is no browser-side Supabase client yet.
// IntakeModule renders the rollup + quick-export flows; the canonical-commit
// section shows its built-in "Configure Supabase to enable" disabled state.
// Wiring a browser-side authenticated Supabase client is a separate task —
// it depends on how we want to model browser auth (Supabase JWT vs the
// current shell cookie + per-request mint).

import { IntakeModule } from '@eq/intake-demo';
import '@eq/intake-demo/styles.css';
import { useSession } from '../session';

export default function ShellIntakeModule() {
  const { session } = useSession();
  return <IntakeModule tenantId={session?.tenant.id} />;
}
