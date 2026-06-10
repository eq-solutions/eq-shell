import { EnrollMfaFlow } from './EnrollMfaFlow'

export default function EnrollMfaPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-eq-ink">Set up two-factor auth</h1>
        <p className="text-sm text-eq-grey mt-1">
          Scan the QR code with Google Authenticator or Microsoft Authenticator, then enter the 6-digit code to confirm.
        </p>
      </div>
      <EnrollMfaFlow />
    </div>
  )
}
