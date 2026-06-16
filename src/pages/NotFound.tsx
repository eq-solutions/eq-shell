// Real 404 page. Replaces the silent <Navigate to="."> that previously
// caught unknown routes — that just looked like the home reloaded for
// no reason, which is worse than a clear "page not found" message.

import { Link, useLocation, useParams } from 'react-router-dom';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

export default function NotFound() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const loc = useLocation();
  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
        <div className="eq-page__header">
          <span
            className="eq-pill eq-pill--warn"
            style={{ display: 'inline-block', marginBottom: 12 }}
          >
            404
          </span>
          <h1 className="eq-page__title">Page not found</h1>
          <p className="eq-page__lede">
            Nothing lives at{' '}
            <code
              style={{
                background: 'var(--gray-100)',
                padding: '2px 6px',
                borderRadius: 4,
                fontSize: 13,
              }}
            >
              {loc.pathname}
            </code>
            . It may have moved, or the link you followed was broken.
          </p>
        </div>

        <section className="eq-section">
          <h2 className="eq-section__heading">Try one of these</h2>
          <div className="eq-modules" style={{ marginTop: 0 }}>
            <Link to={`/${tenantSlug}`} className="eq-module-card">
              <div className="eq-module-card__head">
                <h3>Home</h3>
              </div>
              <p>Your dashboard with the snapshot grid and your apps.</p>
            </Link>
            <Link to={`/${tenantSlug}/admin`} className="eq-module-card">
              <div className="eq-module-card__head">
                <h3>Admin</h3>
              </div>
              <p>Manage users, settings, and audit logs for your workspace.</p>
            </Link>
            <Link to={`/${tenantSlug}/admin/audit`} className="eq-module-card">
              <div className="eq-module-card__head">
                <h3>Activity log</h3>
              </div>
              <p>A record of changes and sign-ins across your account.</p>
            </Link>
          </div>
        </section>
    </HubLayout>
  );
}
