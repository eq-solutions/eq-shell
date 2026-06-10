import Link from 'next/link'
import { AcceptInviteForm } from './AcceptInviteForm'

/**
 * Invite acceptance page - single-shot OTP flow. The user lands here from
 * their invite email. The email no longer carries a clickable token URL
 * (Defender Safe Links would burn the token before the user could click it);
 * instead it carries an 8-digit code that the user types here.
 * Email may be pre-filled via ?email= query param.
 */
export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const { email } = await searchParams
  const initialEmail = email?.trim() || ''

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-eq-deep bg-eq-ice px-2 py-1 rounded">
          <span className="w-1.5 h-1.5 rounded-full bg-eq-sky" />
          Invitation
        </span>
        <h1 className="text-2xl font-bold text-eq-ink tracking-tight mt-4 leading-tight">
          Welcome to EQ Solves Service
        </h1>
        <p className="text-sm text-eq-grey mt-2 leading-relaxed">
          Enter the 8-digit code from your invitation email along with your
          name and a new password. You will be signed in straight after.
        </p>
      </div>

      <StepRail />

      <AcceptInviteForm initialEmail={initialEmail} />

      <p className="text-[11px] text-eq-grey leading-relaxed border-t border-gray-100 pt-4">
        Codes expire 1 hour after the invitation is sent. If yours has
        expired, ask the person who invited you to resend it. We use a
        typed code instead of a link so corporate email scanners cannot
        accidentally use it before you do.
      </p>

      <p className="text-center">
        <Link
          href="/auth/signin"
          className="text-sm text-eq-deep hover:text-eq-sky transition-colors"
        >
          Already have an account? Sign in
        </Link>
      </p>
    </div>
  )
}

function StepRail() {
  const steps = [
    { n: 1, label: 'Enter your 8-digit code' },
    { n: 2, label: 'Set a password' },
    { n: 3, label: 'Enter the platform' },
  ]
  return (
    <ol className="flex items-center gap-0 text-[11px] font-medium text-eq-grey">
      {steps.map((s, i) => (
        <li key={s.n} className="flex items-center gap-2 flex-1">
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-eq-ice text-eq-deep text-[10px] font-bold">
            {s.n}
          </span>
          <span className="whitespace-nowrap">{s.label}</span>
          {i < steps.length - 1 && (
            <span className="flex-1 h-px bg-gray-200 ml-1" />
          )}
        </li>
      ))}
    </ol>
  )
}
