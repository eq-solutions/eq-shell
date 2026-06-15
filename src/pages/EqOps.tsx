import { useSession, moduleEnabled } from '../session';
import { HubLayout } from '../components/HubLayout';
import QuotesNative from './QuotesNative';

// EQ Ops (route /ops) — the in-shell build that will replace the standalone EQ
// Quotes tool. It renders the same module as /quotes, but lives on its own route.
// Access is gated on the per-tenant `ops` module entitlement (enabled for SKS so
// the team can test it), plus platform admins everywhere for debugging. When EQ
// Ops is ready to take over fully, enable the `ops` entitlement per tenant and
// retire the external EQ Quotes redirect.
export default function EqOps() {
  const { session } = useSession();
  if (!session) return null;

  // Gated to tenants with EQ Ops switched on (entitlement) + platform admins.
  if (!moduleEnabled(session, 'ops') && !session.user.is_platform_admin) {
    return (
      <HubLayout>
        <div className="eq-page__header">
          <h1 className="eq-page__title">EQ Ops</h1>
          <p className="eq-page__lede">This area isn't available yet.</p>
        </div>
      </HubLayout>
    );
  }

  return <QuotesNative />;
}
