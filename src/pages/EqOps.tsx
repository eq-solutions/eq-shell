import { useSession } from '../session';
import { HubLayout } from '../components/HubLayout';
import QuotesNative from './QuotesNative';

// EQ Ops (route /ops) — the in-shell build that will replace the standalone EQ
// Quotes tool. It renders the same module as /quotes, but lives on its own route
// and is gated to platform admins, so it can be debugged while the team stays on
// the external EQ Quotes tool (quotes.eq.solutions). When EQ Ops is ready to take
// over, point the team's nav here and retire the external EQ Quotes redirect.
export default function EqOps() {
  const { session } = useSession();
  if (!session) return null;

  // Not your debug surface — the team uses EQ Quotes (external) until this ships.
  if (!session.user.is_platform_admin) {
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
