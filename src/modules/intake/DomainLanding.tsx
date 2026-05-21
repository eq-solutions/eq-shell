// DomainLanding — Unit 7 scaffold. Registry-driven landing pages for
// per-module intake. Lists every entity registered in
// shell_control.eq_schema_registry for the given module (via the
// eq_list_module_entities RPC), with a "drop CSV" affordance per
// entity that's currently disabled — wiring the generic
// ParserDropZone is the next step.
//
// Plan: eq/canonical-readiness/plan.md §Unit 7.

import { useEffect, useState } from 'react';
import { useSession } from '../../session';
import { createSupabaseClient } from '../../lib/supabaseJwt';
import { Gate } from '../../permissions/Gate';
import { EntityImportPanel, WIRED_ENTITY_NAMES } from './EntityImportPanel';

type ModuleSlug = 'core' | 'field' | 'cards' | 'quotes' | 'service';

// Entities with wired ParserDropZone — driven by EntityImportPanel's
// ENTITY_MAP. 20 of 42 wired today (Core + Cards + Service + Quotes +
// 8 Field entities). The remaining 22 Field entities are registry
// placeholders — add JSON schemas + ENTITY_MAP entries to wire.
const WIRED_ENTITIES = new Set(WIRED_ENTITY_NAMES);

interface RegistryEntity {
  entity: string;
  version: string;
  description: string;
}

interface DomainLandingProps {
  module: ModuleSlug;
  title: string;
  description: string;
}

function DomainLanding({ module, title, description }: DomainLandingProps) {
  const { session } = useSession();
  const [entities, setEntities] = useState<RegistryEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [activeEntity, setActiveEntity] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = await createSupabaseClient();
        const { data, error } = await sb.rpc('eq_list_module_entities', { p_module: module });
        if (cancelled) return;
        if (error) {
          setErr(error.message);
        } else {
          setEntities((data as RegistryEntity[]) || []);
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [module]);

  if (!session) return null;

  return (
    <div className="domain-landing">
      <header className="domain-landing__header">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>

      {loading && <div className="eq-loading">Loading entities…</div>}
      {err && (
        <div className="eq-error" role="alert">
          Could not load entities: {err}
        </div>
      )}

      {!loading && !err && entities.length === 0 && (
        <div className="eq-coming-soon">
          <p>No entities registered for this module yet.</p>
        </div>
      )}

      {!loading && !err && entities.length > 0 && (
        <div className="entity-grid">
          {entities.map((e) => {
            const wired = WIRED_ENTITIES.has(e.entity);
            const isOpen = activeEntity === e.entity;
            return (
              <article key={e.entity} className="entity-card">
                <header>
                  <h3>{e.entity}</h3>
                  <small>v{e.version}</small>
                </header>
                <p>{e.description}</p>
                <button
                  type="button"
                  className="entity-import-btn"
                  disabled={!wired}
                  onClick={() => wired && setActiveEntity(isOpen ? null : e.entity)}
                  title={
                    wired
                      ? 'Open a ParserDropZone to import a CSV/XLSX for this entity.'
                      : 'Schema wiring lands in S2 (this entity is registered but not yet hooked to a ParserDropZone).'
                  }
                >
                  {wired
                    ? isOpen
                      ? 'Hide importer'
                      : 'Import CSV / XLSX'
                    : 'Import (S2)'}
                </button>
                {isOpen && wired && (
                  <div className="entity-card__panel">
                    <EntityImportPanel
                      entity={e.entity}
                      onClose={() => setActiveEntity(null)}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GatedDomainLanding(props: DomainLandingProps) {
  return (
    <Gate
      perm="intake.view"
      fallback={
        <div className="eq-coming-soon">
          <h2>Intake — {props.title}</h2>
          <p>Your role doesn't include Intake access. Ask your manager.</p>
        </div>
      }
    >
      <DomainLanding {...props} />
    </Gate>
  );
}

export function CoreIntakeLanding() {
  return (
    <GatedDomainLanding
      module="core"
      title="Core intake"
      description="Import customers, contacts, and sites — the shared-root entities used by every other module."
    />
  );
}

export function FieldIntakeLanding() {
  return (
    <GatedDomainLanding
      module="field"
      title="Field intake"
      description="Import staff, schedules, timesheets, leave, tenders, site reports, and apprentice records."
    />
  );
}

export function QuotesIntakeLanding() {
  return (
    <GatedDomainLanding
      module="quotes"
      title="Quotes intake"
      description="Import scope templates, rate libraries, and historical quote data."
    />
  );
}

export function CardsIntakeLanding() {
  return (
    <GatedDomainLanding
      module="cards"
      title="Cards intake"
      description="Bulk-import licences and tickets from training registers or HR systems."
    />
  );
}

export function ServiceIntakeLanding() {
  return (
    <GatedDomainLanding
      module="service"
      title="Service intake"
      description="Import serviceable assets from existing registers."
    />
  );
}
