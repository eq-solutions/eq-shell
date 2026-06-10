/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential. All rights reserved.
 */
import { ForgotPasswordForm } from './ForgotPasswordForm'

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-eq-deep bg-eq-ice px-2 py-1 rounded">
          <span className="w-1.5 h-1.5 rounded-full bg-eq-sky" />
          Password reset
        </span>
        <h1 className="text-2xl font-bold text-eq-ink tracking-tight mt-4 leading-tight">
          Reset your password
        </h1>
        <p className="text-sm text-eq-grey mt-2 leading-relaxed">
          Enter your email and we&rsquo;ll send an 8-digit code. You&rsquo;ll
          enter that code on the next screen along with your new password.
        </p>
      </div>
      <ForgotPasswordForm />
    </div>
  )
}
