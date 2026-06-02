// EQ Service module entry — ServiceLauncher.
//
// Service is an iframe module; the iframe keeper (ServiceIframe.tsx) mounts
// full-screen as a persistent background process in App.tsx. This file is the
// module boundary: it re-exports the permission definitions so callers can
// import from a single module path, and provides the ServiceLauncher named
// export as the shell's entry component.
//
// The component yields to the iframe keeper — it returns null because the
// full-screen iframe is already visible when this route is active. Expand
// this component to add shell-native Service UI (quick actions, status
// summary, overlay) without touching the keeper.

export { SERVICE_PERMS, SERVICE_MATRIX } from './permissions';
export type { ServicePermKey } from './permissions';

export function ServiceLauncher() {
  return null;
}

export default ServiceLauncher;
