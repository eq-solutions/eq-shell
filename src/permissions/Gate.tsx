// Phase 1.F — <Gate perm="..."> component.
//
// Render children when useCan() is true; optionally render a fallback
// when false. Sugar for the common JSX pattern:
//
//   <Gate perm="admin.invite_user">
//     <InviteButton />
//   </Gate>
//
//   <Gate perm="admin.deactivate_user" fallback={<DisabledNote />}>
//     <DeactivateButton />
//   </Gate>
//
// Spec: IDENTITY-MODEL.md §4.3.

import type { ReactNode } from 'react';
import { useCan, type PermKey } from '../permissions';

export interface GateProps {
  perm: PermKey;
  /** Rendered when the permission is granted. */
  children: ReactNode;
  /** Optional content rendered when the permission is denied. */
  fallback?: ReactNode;
}

export function Gate({ perm, children, fallback = null }: GateProps): ReactNode {
  return useCan(perm) ? <>{children}</> : <>{fallback}</>;
}
