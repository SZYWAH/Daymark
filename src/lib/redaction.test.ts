import { describe, expect, it } from "vitest";
import { getSafeErrorMessage, redactSensitiveText } from "./redaction";

describe("redaction helpers", () => {
  it("redacts common API keys and bearer tokens", () => {
    const text = "apiKey=sk-secret-key-123456 Authorization: Bearer abcdefghijklmnop";
    const safe = redactSensitiveText(text);

    expect(safe).not.toContain("sk-secret-key-123456");
    expect(safe).not.toContain("abcdefghijklmnop");
    expect(safe).toContain("[已隐藏]");
  });

  it("redacts JSON-like sensitive fields", () => {
    const safe = redactSensitiveText('{"manualApiKey":"custom-secret-123456","model":"x"}');

    expect(safe).not.toContain("custom-secret-123456");
    expect(safe).toContain('"manualApiKey":"[已隐藏]"');
    expect(safe).toContain('"model":"x"');
  });

  it("redacts sensitive query parameters", () => {
    const safe = redactSensitiveText("https://example.test/chat?token=secret-token-123456&mode=fast");

    expect(safe).not.toContain("secret-token-123456");
    expect(safe).toContain("token=[已隐藏]");
    expect(safe).toContain("mode=fast");
  });

  it("returns fallback for empty or non-message errors", () => {
    expect(getSafeErrorMessage(null, "操作失败。")).toBe("操作失败。");
    expect(getSafeErrorMessage(new Error(""), "操作失败。")).toBe("操作失败。");
  });
});
