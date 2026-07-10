import { describe, expect, it } from "vitest";
import { markOnboardingCompleted, ONBOARDING_COMPLETED_KEY, shouldShowOnboarding } from "./onboarding";

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("onboarding state", () => {
  it("shows the guide when the current completion marker is absent", () => {
    expect(shouldShowOnboarding(createMemoryStorage())).toBe(true);
  });

  it("stops showing after the guide is completed", () => {
    const storage = createMemoryStorage();

    expect(markOnboardingCompleted(storage)).toBe(true);
    expect(shouldShowOnboarding(storage)).toBe(false);
  });

  it("falls back safely when storage access fails", () => {
    const storage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };

    expect(shouldShowOnboarding(storage)).toBe(true);
    expect(markOnboardingCompleted(storage)).toBe(false);
  });

  it("does not treat an older onboarding version as completed", () => {
    const storage = createMemoryStorage({
      "daymark.onboarding.v0.completed": "true",
    });

    expect(storage.getItem(ONBOARDING_COMPLETED_KEY)).toBeNull();
    expect(shouldShowOnboarding(storage)).toBe(true);
  });
});
