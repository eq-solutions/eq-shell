/**
 * IntakeModule — the production-mount entry-point for EQ Intake.
 *
 * Host app (the EQ Shell) imports this and mounts it at /intake.
 *
 * Renders two parallel flows:
 *   1. RollupDropZone — drop the SimPRO bundle, pick a destination template
 *      (Xero / MYOB / SharePoint rollup / etc.), download the reshape-out
 *      CSV. Doesn't write to canonical.
 *   2. CanonicalCommitSection — drop the same bundle, validate against the
 *      canonical schemas, write via eq_intake_commit_batch. Disabled when
 *      Supabase isn't configured.
 *
 * Both flows use the same SimPRO classification (customer / contact / site).
 * The bookkeeper drops files twice today — once per flow — because the
 * rollup engine is mid-refactor in a sibling branch and we don't want to
 * couple state across both flows yet. When the refactor settles, lifting
 * shared classification state up into IntakeModule is the next step.
 *
 * Routes log to `eq-intake:routes` in localStorage by default. Host can
 * override via the onDestinationChange prop.
 */

import { useMemo, type JSX } from "react";
import { QuickExportSection } from "../quick-export/QuickExportSection.js";
import { RollupDropZone } from "../rollup/RollupDropZone.js";
import { CanonicalCommitSection } from "../canonical/CanonicalCommitSection.js";
import type { SupabaseLikeClient } from "../canonical/commit-canonical.js";

export interface IntakeModuleProps {
  /**
   * Authenticated Supabase client. Passed by the EQ Shell via getSupabase().
   * When omitted, the canonical-commit section renders in a disabled state
   * with a "Configure Supabase to enable" hint. The standalone Vite demo
   * playground always renders disabled.
   */
  supabase?: SupabaseLikeClient | null;
  /**
   * Tenant ID for canonical commits. In the per-tenant Supabase model the
   * shell reads this from env (VITE_TENANT_ID) and passes it down. Default
   * keeps the demo working in isolation.
   */
  tenantId?: string;
  /**
   * Optional callback fired when the user picks a destination in the
   * "Where is this going?" prompt. Defaults to a localStorage logger
   * keyed `eq-intake:routes`.
   */
  onDestinationChange?: (
    value: string | undefined,
    source: "suggested" | "free_text",
  ) => void;
}

const ROUTE_LOG_KEY = "eq-intake:routes";

function defaultRouteLogger(
  value: string | undefined,
  source: "suggested" | "free_text",
): void {
  if (!value) return;
  try {
    const existing = localStorage.getItem(ROUTE_LOG_KEY);
    const log: Array<{ at: string; destination: string; source: string }> = existing
      ? JSON.parse(existing)
      : [];
    log.push({ at: new Date().toISOString(), destination: value, source });
    const trimmed = log.slice(-200);
    localStorage.setItem(ROUTE_LOG_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full / disabled — silently skip
  }
}

export function IntakeModule(props: IntakeModuleProps): JSX.Element {
  const onDestinationChange = useMemo(
    () => props.onDestinationChange ?? defaultRouteLogger,
    [props.onDestinationChange],
  );

  // RollupDropZone today doesn't take onDestinationChange (the destination
  // prompt is built into the per-file confirm flow, not the bundle flow).
  // Leaving the prop here for forward compatibility — when the bundle flow
  // gains its own destination prompt, this will plug in.
  void onDestinationChange;

  return (
    <div className="eq-intake-module">
      <QuickExportSection />
      <RollupDropZone />
      <CanonicalCommitSection
        supabase={props.supabase}
        tenantId={props.tenantId}
      />
    </div>
  );
}
