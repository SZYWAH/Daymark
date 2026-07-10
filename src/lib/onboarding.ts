export const ONBOARDING_COMPLETED_KEY = "daymark.onboarding.v1.completed";

type OnboardingStorage = Pick<Storage, "getItem" | "setItem">;

function getLocalStorage(): OnboardingStorage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function shouldShowOnboarding(storage: OnboardingStorage | null = getLocalStorage()) {
  if (!storage) return true;

  try {
    return storage.getItem(ONBOARDING_COMPLETED_KEY) !== "true";
  } catch {
    return true;
  }
}

export function markOnboardingCompleted(storage: OnboardingStorage | null = getLocalStorage()) {
  if (!storage) return false;

  try {
    storage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    return true;
  } catch {
    return false;
  }
}
