import { SignInForm } from './SignInForm'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams
  const next = params.next || '/dashboard'
  const initialError = resolveInitialError(params.error)

  return <SignInForm next={next} initialError={initialError} />
}

function resolveInitialError(error: string | undefined): string | undefined {
  if (!error) return undefined
  switch (error) {
    case 'deactivated':
      return 'Your account has been deactivated. Contact an administrator.'
    case 'demo_unavailable':
      return 'Demo is temporarily unavailable. Please try again shortly.'
    case 'invite_link_missing_token':
      return 'That invite link looks incomplete - ask your administrator to resend it.'
    case 'link_expired':
      return 'That link can no longer be used. Request a fresh code from Forgot password, or ask your administrator to resend the invite.'
    case 'callback':
      return 'That link could not be used. Ask your administrator to resend the invite.'
    default:
      return error.slice(0, 200)
  }
}
