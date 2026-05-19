/**
 * @eq/confirm-ui — confirm-flow state machine + React components.
 *
 * Drop into any React app:
 *
 *   import { ParserDropZone } from "@eq/confirm-ui";
 *
 *   <ParserDropZone
 *     config={{ schema, tenantId, ai, commit, fkLookup }}
 *     canonicalFields={Object.keys(schema.properties)}
 *   />
 *
 * For more control, use createConfirmFlow() directly:
 *
 *   const { useStore, driver } = createConfirmFlow();
 *   driver.configure(config);
 *   await driver.runToConfirmMapping(file);
 *   const status = useStore.getState().status;
 */

// State machine
export {
  createConfirmFlow,
  computeEffectiveMapping,
  computeCommitReady,
  buildCommittedCsv,
} from "./store.js";
export type { FlowDriver } from "./store.js";

// Types
export type {
  FlowState,
  FlowStatus,
  FlowConfig,
  FlagResolution,
  EffectiveMapping,
  CommitReady,
  CommittableRow,
  CommitFn,
} from "./types.js";

// Components
export { MappingTable } from "./components/MappingTable.js";
export type { MappingTableProps } from "./components/MappingTable.js";
export { FlaggedRowsTable } from "./components/FlaggedRowsTable.js";
export type { FlaggedRowsTableProps } from "./components/FlaggedRowsTable.js";
export { ConfirmFlow } from "./components/ConfirmFlow.js";
export type { ConfirmFlowProps } from "./components/ConfirmFlow.js";
export { ParserDropZone } from "./components/ParserDropZone.js";
export type { ParserDropZoneProps } from "./components/ParserDropZone.js";
export { SheetPicker } from "./components/SheetPicker.js";
export type { SheetPickerProps } from "./components/SheetPicker.js";
export { DestinationPicker } from "./components/DestinationPicker.js";
export type { DestinationPickerProps } from "./components/DestinationPicker.js";

/**
 * Sentinel used by the old placeholder. Now true since the real UI ships.
 */
export const CONFIRM_UI_READY = true as const;
