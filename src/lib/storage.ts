const PREFIX = 'qc_';

export const storageKeys = {
  activeSidebarTab: `${PREFIX}active_sidebar_tab_v1`,
  uiCollapse: (section: string) => `${PREFIX}collapse_${section}`,
  modelRoutingState: `${PREFIX}model_routing_state_v1`,
} as const;

export function getStoredString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setStoredString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures (private mode/quota/sandbox issues).
  }
}

export function getStoredJson<T>(key: string): T | null {
  const raw = getStoredString(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setStoredJson<T>(key: string, value: T): void {
  try {
    setStoredString(key, JSON.stringify(value));
  } catch {
    // Ignore serialization/storage failures.
  }
}
