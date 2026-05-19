import { describe, it, expect } from "vitest";
import {
  CONFIRM_UI_READY,
  createConfirmFlow,
  computeCommitReady,
  computeEffectiveMapping,
} from "../src/index.js";

describe("@eq/confirm-ui scaffold", () => {
  it("exports CONFIRM_UI_READY = true now that the real components ship", () => {
    expect(CONFIRM_UI_READY).toBe(true);
  });

  it("createConfirmFlow returns a fresh store + driver", () => {
    const flow = createConfirmFlow();
    expect(flow.useStore).toBeTypeOf("function");
    expect(flow.driver).toBeDefined();
    expect(flow.useStore.getState().status.kind).toBe("idle");
  });

  it("helper functions are exported and callable on empty state", () => {
    const flow = createConfirmFlow();
    const state = flow.useStore.getState();
    expect(computeEffectiveMapping(state).mapping).toEqual({});
    expect(computeCommitReady(state).committable).toEqual([]);
  });
});
