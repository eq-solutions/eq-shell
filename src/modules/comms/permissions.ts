// Comms module reuses existing PermKeys from @eq-solutions/roles:
//   view   → 'field.view'     (manager, supervisor, employee, apprentice, labour_hire)
//   update → 'field.dispatch' (manager, supervisor)
//
// This avoids a package version bump until comms.* keys are added upstream.

export const COMMS_VIEW_PERM   = 'field.view'     as const;
export const COMMS_UPDATE_PERM = 'field.dispatch'  as const;
