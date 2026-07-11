import { describe, expect, it } from "vitest";
import {
  getStartupExitDelay,
  shouldOpenFirstRunGuide,
  STARTUP_EXIT_MS,
  STARTUP_MAX_TOTAL_MS,
  STARTUP_MIN_VISIBLE_MS,
} from "./startup";

describe("startup timing", () => {
  it("keeps a fast startup visible for the minimum duration", () => {
    expect(getStartupExitDelay(120, true)).toBe(STARTUP_MIN_VISIBLE_MS - 120);
  });

  it("starts leaving immediately when data becomes ready after the minimum", () => {
    expect(getStartupExitDelay(900, true)).toBe(0);
  });

  it("reserves the exit animation inside the maximum total duration", () => {
    expect(getStartupExitDelay(0, false)).toBe(STARTUP_MAX_TOTAL_MS - STARTUP_EXIT_MS);
  });

  it("waits until the hard deadline when reduced motion removes the exit animation", () => {
    expect(getStartupExitDelay(0, false, true)).toBe(STARTUP_MAX_TOTAL_MS);
  });
});

describe("startup onboarding sequence", () => {
  it("opens onboarding only after loading and startup are both complete", () => {
    expect(shouldOpenFirstRunGuide({ loading: true, startupComplete: false, pending: true })).toBe(false);
    expect(shouldOpenFirstRunGuide({ loading: false, startupComplete: false, pending: true })).toBe(false);
    expect(shouldOpenFirstRunGuide({ loading: false, startupComplete: true, pending: true })).toBe(true);
  });

  it("does not reopen onboarding after the pending flag is consumed", () => {
    expect(shouldOpenFirstRunGuide({ loading: false, startupComplete: true, pending: false })).toBe(false);
  });
});
