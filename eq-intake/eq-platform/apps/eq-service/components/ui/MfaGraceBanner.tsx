import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { MFA_GRACE_DAYS } from '@/proxy'

/**
 * Visible reminder during the MFA grace window (PR J, audit §B.1 / §5.4).
 *
 * Shown on every protected page when the user is signed in, has NO MFA
 * factor enrolled, AND is still within the N-day grace window since
 * `profiles.mfa_grace_started_at`. After the grace window expires the
 * proxy redirects to `/auth/enroll-mfa` and this banner never renders
 * (no protected page loads to show it).
 *
 * Renders nothing when the props don't match the in-grace state — keeps
 * the layout free of conditional wrappers.
 */
export interface MfaGraceBannerProps {
  /** ISO timestamp of `profiles.mfa_grace_started_at`. */
  graceStartedAt: string | null
  /** Whether the user has a factor enrolled (AAL nextLevel === 'aal2'). */
  hasFactor: boolean
}

export function MfaGraceBanner({ graceStartedAt, hasFactor }: MfaGraceBannerProps) {
  // No banner if the user already has a factor (their AAL gate is separate),
  // or if the grace timer hasn't been stamped yet (defensive — should never
  // happen post-migration 0103 because of DEFAULT now()).
  if (hasFactor || !graceStartedAt) return null

  const elapsedMs = Date.now() - new Date(graceStartedAt).getTime()
  const totalMs = MFA_GRACE_DAYS * 24 * 60 * 60 * 1000
  const remainingMs = totalMs - elapsedMs

  // Beyond the grace window the proxy redirects to /auth/enroll-mfa so
  // this banner won't render in practice. Defensive: still hide it.
  if (remainingMs <= 0) return null

  const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
  const isUrgent = remainingDays <= 3

  return (
    <div
      role="status"
      className={`w-full px-4 py-2 text-sm flex items-center gap-3 ${
        isUrgent
          ? 'bg-red-50 text-red-800 border-b border-red-200'
          : 'bg-amber-50 text-amber-800 border-b border-amber-200'
      }`}
    >
      <ShieldAlert className={`w-4 h-4 shrink-0 ${isUrgent ? 'text-red-600' : 'text-amber-600'}`} aria-hidden="true" />
      <span className="flex-1 min-w-0">
        Set up two-factor authentication —{' '}
        <strong>
          {remainingDays === 1 ? 'today' : `${remainingDays} days left`}
        </strong>
        . After that, you&apos;ll be required to enroll before continuing.
      </span>
      <Link
        href="/auth/enroll-mfa"
        className={`inline-flex items-center min-h-[36px] px-3 py-1 text-xs font-semibold rounded transition-colors touch-manipulation ${
          isUrgent
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'bg-amber-600 text-white hover:bg-amber-700'
        }`}
      >
        Set it up now →
      </Link>
    </div>
  )
}
