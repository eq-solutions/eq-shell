'use client';

import posthog from 'posthog-js';

type IdentifyProps = {
  userId: string;
  tenantId: string;
  role: string;
  appVersion: string;          // matches Field — enables cross-app version filtering
  analyticsEnabled?: boolean;
};

export function identify(props: IdentifyProps) {
  // Tenant opt-out: disable all capturing for this user.
  if (props.analyticsEnabled === false) {
    posthog.opt_out_capturing();
    if (typeof window !== 'undefined' && typeof (window as any).clarity === 'function') {
      (window as any).clarity('consent', false);
    }
    return;
  }

  posthog.identify(props.userId, {
    tenant_id: props.tenantId,
    role: props.role,
    app_version: props.appVersion,
  });
  posthog.group('tenant', props.tenantId);

  if (typeof window !== 'undefined' && typeof (window as any).clarity === 'function') {
    (window as any).clarity('identify', props.userId, undefined, undefined, props.tenantId);
    (window as any).clarity('set', 'role', props.role);
    (window as any).clarity('set', 'tenant', props.tenantId);
    (window as any).clarity('set', 'app_version', props.appVersion);
  }
}

export function track(event: string, props: Record<string, any> = {}) {
  posthog.capture(event, props);
}

export function trackError(
  context: string,
  message: string,
  extra: Record<string, any> = {}
) {
  track('error_thrown', { context, message, ...extra });
}

export function reset() {
  posthog.reset();
}

// -----------------------------------------------------------------------------
// Day-one event helpers for EQ Service.
// See EQ_Analytics_Install_Plan_v2.md §5.2. 11 events. Don't add more without
// updating the plan.
// -----------------------------------------------------------------------------

export const events = {
  sessionStarted: (p: { device_type: string }) =>
    track('session_started', p),

  dashboardViewed: (p: { site_count: number; open_checks_count: number }) =>
    track('dashboard_viewed', p),

  checkCreated: (p: { check_type: string; asset_type: string }) =>
    track('check_created', p),

  checkCompleted: (p: {
    check_type: string;
    duration_seconds: number;
    defects_found: number;
  }) => track('check_completed', p),

  deltaImportStarted: () => track('delta_import_started'),

  deltaImportCommitted: (p: {
    rows_linked: number;
    rows_created: number;
    rows_skipped: number;
  }) => track('delta_import_committed', p),

  reportGenerated: (p: { report_type: string; asset_count: number }) =>
    track('report_generated', p),

  mediaUploaded: (p: { media_type: string; file_size_mb: number }) =>
    track('media_uploaded', p),

  portalViewed: (p: { portal_type: string }) => track('portal_viewed', p),

  archivedCheckToggled: (p: { new_state: boolean }) =>
    track('archived_check_toggled', p),

  // ─── Supervisor digest (admin-triggered from /calendar) ───
  // `supervisor_digest_previewed` fires on the admin Preview button; no
  // email is sent. `supervisor_digest_sent` fires on the manual Send Now
  // button and reflects the per-supervisor delivery status reported by
  // Resend. The daily cron run also writes to supervisor_digests in
  // Postgres, so these events capture the admin surface only.
  supervisorDigestPreviewed: (p: {
    supervisor_count: number
    total_entries: number
    with_entries_count: number
  }) => track('supervisor_digest_previewed', p),

  supervisorDigestSent: (p: {
    supervisor_count: number
    sent_count: number
    skipped_count: number
    errored_count: number
  }) => track('supervisor_digest_sent', p),
};
