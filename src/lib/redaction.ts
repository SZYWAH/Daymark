const REDACTED = "[已隐藏]";
const SENSITIVE_FIELD =
  "(?:api[_-]?key|apikey|manualApiKey|access[_-]?token|id[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|secret|password|authorization|token|key)";

export function redactSensitiveText(value: unknown) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);

  return text
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/gi, REDACTED)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`)
    .replace(
      new RegExp(`(["']?${SENSITIVE_FIELD}["']?\\s*:\\s*["'])([^"',}\\]\\s]{4,})(["'])`, "gi"),
      `$1${REDACTED}$3`,
    )
    .replace(
      new RegExp(`\\b(${SENSITIVE_FIELD})\\b\\s*[:=]\\s*["']?([^"',;&\\s}\\]]{4,})`, "gi"),
      `$1=${REDACTED}`,
    )
    .replace(new RegExp(`([?&](?:${SENSITIVE_FIELD})=)([^&#\\s]{4,})`, "gi"), `$1${REDACTED}`);
}

export function getSafeErrorMessage(error: unknown, fallback: string) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const safe = redactSensitiveText(message).trim();
  return safe || fallback;
}
