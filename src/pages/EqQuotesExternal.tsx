import { Navigate, useParams } from 'react-router-dom';

// EQ Quotes (the standalone Flask tool) has been replaced by EQ Ops. The old
// /<tenant>/eq-quotes door now redirects into /<tenant>/ops so muscle-memory and
// any saved links land on the live in-shell build. The Flask app stays reachable
// at quotes.eq.solutions directly for historical reference during the cutover.
export default function EqQuotesExternal() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  return <Navigate to={`/${tenantSlug ?? ''}/ops`} replace />;
}

export { EqQuotesExternal };
