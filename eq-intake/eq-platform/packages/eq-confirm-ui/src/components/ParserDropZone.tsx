/**
 * ParserDropZone — the entry-point component.
 *
 * Wraps a drag-and-drop file input + ConfirmFlow. Drop in to any React app
 * to get the full parse → confirm → commit flow with one component.
 *
 * Host app supplies the FlowConfig (schema, tenantId, AI, commit fn).
 *
 * UX choices:
 *   - The dropzone is ALWAYS visible. Once a file is loaded it shrinks to a
 *     compact "currently parsing X.csv — drop another to replace" strip so
 *     the user can always swap files without hunting for a "Start over"
 *     button hidden somewhere in the flow.
 *   - A status badge sits next to the dropzone so the current phase is
 *     obvious at a glance.
 *   - Errors surface inline, not in a modal — the dropzone stays usable.
 */

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ChangeEvent,
  type JSX,
} from "react";
import { createConfirmFlow } from "../store.js";
import { ConfirmFlow } from "./ConfirmFlow.js";
import type { FlowConfig, FlowStatus } from "../types.js";

export interface ParserDropZoneProps {
  config: FlowConfig;
  /** Canonical fields available for mapping. Usually Object.keys(schema.properties). */
  canonicalFields: string[];
  /** Accept attribute on the underlying input. Default: ".csv,.xlsx,.xls,.xlsm". */
  accept?: string;
  /**
   * Optional callback fired when the user sets a destination on the
   * non-blocking "Where is this going?" prompt. Use it to log routes.
   */
  onDestinationChange?: (
    value: string | undefined,
    source: "suggested" | "free_text",
  ) => void;
}

export function ParserDropZone(props: ParserDropZoneProps): JSX.Element {
  // Lazy useState ensures the store is created exactly once per mount,
  // regardless of StrictMode's double-invoke behaviour on useMemo factories.
  const [flow] = useState(() => createConfirmFlow());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Configure the driver as a real side effect. configure() resets the store,
  // which is correct behaviour when the consumer swaps schema/tenant/AI etc.
  useEffect(() => {
    flow.driver.configure(props.config);
  }, [flow, props.config]);

  const status = flow.useStore((s) => s.status);
  const file = flow.useStore((s) => s.file);

  const onFile = (f: File) => {
    void flow.driver.runToConfirmMapping(f);
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFile(f);
    // Reset the input so re-selecting the same file fires onChange again.
    e.target.value = "";
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  const startOver = () => {
    flow.useStore.getState().reset();
  };

  const isIdle = status.kind === "idle";
  const hasFile = !!file;

  return (
    <div className="eq-dropzone-wrapper">
      <div
        className={
          "eq-dropzone" +
          (dragOver ? " eq-dropzone--over" : "") +
          (hasFile ? " eq-dropzone--compact" : "")
        }
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label={hasFile ? "Replace file" : "Drop a CSV or XLSX file"}
      >
        {!hasFile ? (
          <>
            <p className="eq-dropzone__title">
              Drop a file here
            </p>
            <p className="eq-dropzone__hint">
              CSV · XLSX · PDF · photo — or click to browse
            </p>
          </>
        ) : (
          <div className="eq-dropzone__compact-row">
            <span className="eq-dropzone__file">
              <strong>{file.name}</strong> · click or drop to replace
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                startOver();
              }}
            >
              Start over
            </button>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={
            props.accept ??
            ".csv,.tsv,.xlsx,.xls,.xlsm,.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic"
          }
          onChange={onInputChange}
          style={{ display: "none" }}
        />
      </div>

      {!isIdle && (
        <div className="eq-status-bar">
          <span className="eq-status-bar__label">Status:</span>
          <span className={`eq-status-bar__badge eq-status-bar__badge--${badgeKind(status)}`}>
            {statusLabel(status)}
          </span>
        </div>
      )}

      <ConfirmFlow
        store={flow.useStore}
        driver={flow.driver}
        canonicalFields={props.canonicalFields}
        schema={props.config.schema}
        onDestinationChange={props.onDestinationChange}
      />
    </div>
  );
}

function statusLabel(s: FlowStatus): string {
  switch (s.kind) {
    case "idle":
      return "Idle";
    case "parsing":
      return "Reading file";
    case "confirm_sheet":
      return "Pick a sheet";
    case "classifying":
      return "Classifying";
    case "mapping":
      return "AI column mapping";
    case "confirm_mapping":
      return "Review mapping";
    case "validating":
      return "Validating rows";
    case "confirm_rows":
      return "Review rows";
    case "committing":
      return `Committing (${s.committed}/${s.total})`;
    case "complete":
      return `Complete — ${s.committed} committed`;
    case "error":
      return `Error in ${s.phase}`;
  }
}

function badgeKind(s: FlowStatus): "info" | "ok" | "warn" | "err" {
  switch (s.kind) {
    case "complete":
      return "ok";
    case "error":
      return "err";
    case "confirm_sheet":
    case "confirm_mapping":
    case "confirm_rows":
      return "warn";
    default:
      return "info";
  }
}
