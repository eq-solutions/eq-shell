/**
 * DestinationPicker — non-blocking "where is this going?" prompt.
 *
 * Surfaces on the confirm_mapping screen so the user can tell us where
 * the data is headed next. Captured to build a route map over time —
 * which destinations are worth investing in dedicated export profiles
 * for, and which canonical schemas are worth building first.
 *
 * Free-form. Doesn't gate the flow. Chips are biased toward Royce's
 * actual SKS/EQ world (SimPRO, Xero, SharePoint, DC compliance portals,
 * insurance bundles) — generic SaaS-shaped suggestions wouldn't be
 * useful signal.
 *
 * The host app supplies a callback that fires when the value changes;
 * the demo uses it to persist a route log to localStorage. The store
 * also tracks the current value so other components (commit log,
 * future export-profile selector) can read it.
 */

import { useState, useId, type JSX } from "react";
import type { UseBoundStore, StoreApi } from "zustand";
import type { FlowState } from "../types.js";

export interface DestinationPickerProps {
  store: UseBoundStore<StoreApi<FlowState>>;
  /** Optional callback invoked when the destination changes. */
  onChange?: (value: string | undefined, source: "suggested" | "free_text") => void;
  /** Override the default suggestions. */
  suggestions?: string[];
}

const DEFAULT_SUGGESTIONS = [
  "SimPRO",
  "Xero",
  "SharePoint",
  "Equinix portal",
  "NEXTDC portal",
  "Compliance bundle",
];

export function DestinationPicker(props: DestinationPickerProps): JSX.Element {
  const destination = props.store((s) => s.destination);
  const destinationSource = props.store((s) => s.destinationSource);
  const setDestination = props.store((s) => s.setDestination);
  const [freeText, setFreeText] = useState("");
  const inputId = useId();
  const suggestions = props.suggestions ?? DEFAULT_SUGGESTIONS;

  const pickChip = (label: string) => {
    setDestination(label, "suggested");
    setFreeText("");
    props.onChange?.(label, "suggested");
  };

  const submitFreeText = () => {
    const v = freeText.trim();
    if (!v) return;
    setDestination(v, "free_text");
    props.onChange?.(v, "free_text");
  };

  const clear = () => {
    setDestination(undefined, "free_text");
    setFreeText("");
    props.onChange?.(undefined, "free_text");
  };

  return (
    <aside className="eq-destination" aria-labelledby={inputId}>
      <h3 id={inputId} className="eq-destination__title">
        Where is this going next?
      </h3>
      <p className="eq-destination__hint">
        Optional. Helps us understand which routes are worth building dedicated
        export profiles for.
      </p>
      <div className="eq-destination__chips">
        {suggestions.map((label) => {
          const active = destination === label && destinationSource === "suggested";
          return (
            <button
              key={label}
              type="button"
              className={
                "eq-destination__chip" +
                (active ? " eq-destination__chip--active" : "")
              }
              onClick={() => pickChip(label)}
              aria-pressed={active}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="eq-destination__freetext">
        <input
          type="text"
          placeholder="Or type a destination (system, portal, person, project…)"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitFreeText();
            }
          }}
          aria-label="Custom destination"
        />
        <button type="button" onClick={submitFreeText} disabled={freeText.trim() === ""}>
          Set
        </button>
      </div>
      {destination ? (
        <div className="eq-destination__current">
          Headed to <strong>{destination}</strong>
          {destinationSource === "free_text" ? " (custom)" : null}
          {" · "}
          <button type="button" className="eq-link-button" onClick={clear}>
            clear
          </button>
        </div>
      ) : null}
    </aside>
  );
}
