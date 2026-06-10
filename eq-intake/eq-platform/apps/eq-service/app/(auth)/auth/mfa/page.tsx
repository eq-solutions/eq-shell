import { MfaChallengeForm } from './MfaChallengeForm'

export default function MfaChallengePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-eq-ink">Two-factor verification</h1>
        <p className="text-sm text-eq-grey mt-1">
          Enter the 6-digit code from your authenticator app.
        </p>
      </div>
      <MfaChallengeForm />
    </div>
  )
}
