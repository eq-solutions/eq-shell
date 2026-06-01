// EQ Intake — mounts @eq/intake-demo's IntakeModule inside the shell.
//
// Phase 1.F:
//   - Auth via the new createSupabaseClient() helper from
//     src/lib/supabaseJwt.ts. The helper refreshes the JWT
//     transparently via /.netlify/functions/mint-supabase-jwt
//     before expiry — works for sessions longer than the 15-min
//     Supabase JWT TTL without surprising the user.
//   - Gated by useCan('intake.view'). Specific actions inside
//     IntakeModule (import / commit) are gated by their own
//     useCan() calls — see src/modules/intake/permissions.ts.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { IntakeModule } from '@eq/intake-demo';
import '@eq/intake-demo/styles.css';
import { useSession } from '../../session';
import { Gate } from '../../permissions/Gate';
import { HubLayout } from '../../components/HubLayout';
import { defaultSidebarRecords } from '../../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();
import { createSupabaseClient } from '../../lib/supabaseJwt';

// IntakeModule's structural SupabaseLikeClient expects insert(row) to
// return a Promise directly. @supabase/supabase-js returns a thenable
// PostgrestFilterBuilder. Runtime-compatible (both `await` correctly),
// but TS can't unify the types — hence the cast at the call site.
type SupabaseLikeClient = NonNullable<Parameters<typeof IntakeModule>[0]['supabase']>;

function IntakeShell() {
  const { session } = useSession();
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
    />
  );
}

// Per-domain landing entry points users should discover from here.
const DOMAIN_PIVOTS: { slug: string; label: string; blurb: string }[] = [
  { slug: 'core', label: 'Core', blurb: 'Customers · contacts · sites' },
  { slug: 'field', label: 'Field', blurb: 'Staff · schedules · timesheets · leave' },
  { slug: 'cards', label: 'Cards', blurb: 'Licences · tickets · training' },
  { slug: 'quotes', label: 'Quotes', blurb: 'Scope · rates · history' },
  { slug: 'service', label: 'Service', blurb: 'Serviceable assets' },
];

function IntakePivotBanner() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  return (
    <div className="eq-intake-pivots">
      <div className="eq-intake-pivots__head">
        <p className="eq-intake-pivots__eyebrow">PER-DOMAIN INTAKE</p>
        <h2 className="eq-intake-pivots__title">
          Importing structured data? Use the per-domain importers.
        </h2>
        <p className="eq-intake-pivots__sub">
          The SimPRO surface below is the legacy bundle workflow. For typed
          CSV/XLSX imports across 42 record types, pick a domain:
        </p>
      </div>
      <div className="eq-intake-pivots__grid">
        {DOMAIN_PIVOTS.map((p) => (
          <Link
            key={p.slug}
            to={`/${tenantSlug}/intake/${p.slug}`}
            className="eq-intake-pivot"
          >
            <span className="eq-intake-pivot__label">{p.label}</span>
            <span className="eq-intake-pivot__blurb">{p.blurb}</span>
            <span className="eq-intake-pivot__arrow">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function ShellIntakeModule() {
  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <div className="eq-page__header">
        <h1 className="eq-page__title">Intake</h1>
        <p className="eq-page__lede">
          Drag-drop CSVs and structured exports into your tenant data.
        </p>
      </div>
      <Gate
        perm="intake.view"
        fallback={
          <div className="eq-coming-soon">
            <p>Your role doesn't include Intake access. Ask your manager.</p>
          </div>
        }
      >
        <IntakePivotBanner />
        <section className="eq-section">
          <h2 className="eq-section__heading">Legacy SimPRO bundle</h2>
          <IntakeShell />
        </section>
      </Gate>
    </HubLayout>
  );
}
