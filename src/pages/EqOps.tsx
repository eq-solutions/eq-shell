import { Link } from 'react-router-dom';
import { useSession, moduleEnabled } from '../session';
import { HubLayout } from '../components/HubLayout';
import { Skeleton } from '../components/Skeleton';
import QuotesNative from './QuotesNative';

// EQ Ops (route /ops) — the in-shell build that will replace the standalone EQ
// Quotes tool. It renders the same module as /quotes, but lives on its own route.
// Access is gated on the per-tenant `ops` module entitlement (enabled for SKS so
// the team can test it), plus platform admins everywhere for debugging. When EQ
// Ops is ready to take over fully, enable the `ops` entitlement per tenant and
// retire the external EQ Quotes redirect.
export default function EqOps() {
  const { session } = useSession();
  if (!session) {
    return (
      <HubLayout>
        <div style={{ padding: '24px' }}>
          <Skeleton variant="text" width={320} />
          <Skeleton variant="text" width={240} />
        </div>
      </HubLayout>
    );
  }

  // Gated to tenants with EQ Ops switched on (entitlement) + platform admins.
  if (!moduleEnabled(session, 'ops') && !session.user.is_platform_admin) {
    return (
      <HubLayout>
        <div className="eq-page__header">
          <h1 className="eq-page__title">EQ Ops</h1>
          <p className="eq-page__lede">
            EQ Ops isn't enabled for your workspace. Contact your administrator,
            or <Link to={`/${session.tenant.slug}`}>go back to the home page</Link>.
          </p>
        </div>
      </HubLayout>
    );
  }

  return <QuotesNative />;
}
