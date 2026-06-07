// RETIRED HAND-COPY — kept as a thin re-export, not a mirror.
//
// This file used to be a verbatim local copy of the @eq-solutions/roles
// permission matrix, because Netlify's function bundler resolved the package's
// default entry to raw `.ts` and 502'd at runtime. As of v2.3.0 the package
// ships a compiled `roles.js` as its `default` export condition, so functions
// import it directly (see _shared/permissions.ts). Re-exporting the package
// MATRIX here means this file can no longer drift from the source of truth.
//
// Nothing in the functions tree imports this today; it is retained (not deleted)
// only for backwards-compat and is safe to remove once confirmed unused.
export { MATRIX } from '@eq-solutions/roles';
