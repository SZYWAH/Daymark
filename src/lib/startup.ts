export const STARTUP_MIN_VISIBLE_MS = 1_400;
export const STARTUP_MAX_TOTAL_MS = 2_500;
export const STARTUP_EXIT_MS = 180;

export function getStartupExitDelay(
  elapsedMs: number,
  ready: boolean,
  reducedMotion = false,
) {
  const elapsed = Math.max(0, elapsedMs);
  if (ready) {
    return Math.max(0, STARTUP_MIN_VISIBLE_MS - elapsed);
  }

  const exitDuration = reducedMotion ? 0 : STARTUP_EXIT_MS;
  return Math.max(0, STARTUP_MAX_TOTAL_MS - exitDuration - elapsed);
}

export function shouldOpenFirstRunGuide({
  loading,
  startupComplete,
  pending,
}: {
  loading: boolean;
  startupComplete: boolean;
  pending: boolean;
}) {
  return !loading && startupComplete && pending;
}
