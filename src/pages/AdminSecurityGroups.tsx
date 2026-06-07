// AdminSecurityGroups — re-export of AccessControlPage.
//
// Phase 3 of the SKS Live roles sprint. The unified Access Control page
// (role matrix + custom groups + permission preview) lives in
// AccessControlPage.tsx; this file gives the route a stable import name
// matching the sprint spec and the /admin/security-groups URL.

export { default } from './AccessControlPage';
