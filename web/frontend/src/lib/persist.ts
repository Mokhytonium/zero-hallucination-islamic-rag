/**
 * Small, failure-tolerant localStorage helpers for UI preferences.
 * Privacy-sensitive values (the BYOK key) stay in sessionStorage elsewhere;
 * this module is only for harmless view state.
 */
export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled — preferences simply don't persist */
  }
}

export function readBoolPref(key: string, fallback: boolean): boolean {
  const raw = readPref(key);
  if (raw === null) return fallback;
  return raw === "1" || raw === "true";
}
