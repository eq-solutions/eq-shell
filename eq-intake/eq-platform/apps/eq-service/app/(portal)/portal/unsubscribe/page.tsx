import { processUnsubscribeAction } from './actions'
import { UnsubscribeView } from './UnsubscribeView'

/**
 * /portal/unsubscribe?token=<signed>
 *
 * One-click unsubscribe landing for customer-facing emails. The token
 * carries the customer_contact_id + scope; visiting the URL processes
 * the unsubscribe immediately and shows a confirmation.
 *
 * Listed in PUBLIC_PATHS — no Supabase session required, and shouldn't
 * be. The token signature IS the auth check (see lib/email/unsubscribe-token.ts).
 *
 * AU Spam Act 2003 s18 compliance: functional, fee-free, processed at
 * request time, no auth gate.
 */
export const dynamic = 'force-dynamic'

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const params = await searchParams
  const token = params.token ?? ''
  const result = await processUnsubscribeAction(token)

  return (
    <div className="max-w-md mx-auto py-16">
      <UnsubscribeView result={result} token={token} />
    </div>
  )
}
