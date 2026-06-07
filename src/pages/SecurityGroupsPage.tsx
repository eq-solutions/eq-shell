// Redirect — moved to AccessControlPage (unified role matrix + groups).
import { Navigate, useParams } from 'react-router-dom';

export default function SecurityGroupsPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  return <Navigate to={`/${tenantSlug ?? ''}/admin/access-control`} replace />;
}
