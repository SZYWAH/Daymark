import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getAutoWorkReviewSettings, getDefaultAiSettings, saveAiSettings } from "../data/itemStore";
import { runAutoWorkReviewOnce } from "./autoWorkReview";

describe("auto work review runner", () => {
  beforeEach(async () => {
    await saveAiSettings({ ...getDefaultAiSettings(), manualApiKey: "", manualKeyStored: false });
  });

  it("skips without scanning when the feature is disabled", async () => {
    const autoSettings = await getAutoWorkReviewSettings();

    const result = await runAutoWorkReviewOnce({
      settings: getDefaultAiSettings(),
      autoSettings,
      date: "2026-07-09",
    });

    expect(result.status).toBe("skipped");
    expect(result.message).toMatch(/未开启/);
  });

  it("does not continue toward conversation reading when prerequisites are missing", async () => {
    const autoSettings = {
      ...(await getAutoWorkReviewSettings()),
      enabled: true,
    };
    const settings = {
      ...getDefaultAiSettings(),
      useEnvKey: false,
      manualApiKey: "",
      manualKeyStored: false,
    };

    const result = await runAutoWorkReviewOnce({
      settings,
      autoSettings,
      date: "2026-07-09",
    });

    expect(result.status).toBe("skipped");
    expect(result.message).toMatch(/API Key|桌面端/);
  });
});
