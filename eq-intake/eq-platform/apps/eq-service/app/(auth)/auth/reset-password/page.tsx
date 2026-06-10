import Link from 'next/link'
import { ForgotPasswordForm } from '../forgot-password/ForgotPasswordForm'

/**
 * /auth/reset-password - OTP code + new password entry. Reset emails carry
 * an 8-digit code (not a clickable token URL - Defender Safe Links would
 * burn the token before the user could click it). Users can either land
 * here directly from the email's safe tokenless link with ?email= filled,
 * or land here without ?email and type their address before the code.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const { email } = await searchParams
  const initialEmail = email?.trim() || undefined

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-eq-deep bg-eq-ice px-2 py-1 rounded">
          <span className="w-1.5 h-1.5 rounded-full bg-eq-sky" />
          Password reset
        </span>
        <h1 className="text-2xl font-bold text-eq-ink tracking-tight mt-4 leading-tight">
          {initialEmail ? 'Enter your reset code' : 'Reset your password'}
        </h1>
        <p className="text-sm text-eq-grey mt-2 leading-relaxed">
          {initialEmail ? (
            <>
              We have emailed an 8-digit code to your inbox. Enter it below
              with your new password.
            </>
          ) : (
            <>
              Enter your email and we will send an 8-digit code to reset
              your password.
            </>
          )}
        </p>
      </div>

      <ForgotPasswordForm initialEmail={initialEmail} />

      <p className="text-[11px] text-eq-grey leading-relaxed border-t border-gray-100 pt-4">
        Once your password is updated you will be signed out everywhere and
        asked to sign back in. If your account has 2FA enabled, you will
        also need to enter your authenticator code.
      </p>

      <p className="text-center">
        <Link
          href="/auth/signin"
          className="text-sm text-eq-deep hover:text-eq-sky transition-colors"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
