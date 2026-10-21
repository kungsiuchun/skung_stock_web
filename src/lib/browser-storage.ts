const sessionNotice = "Changes remain in this session only and will not be preserved after reloading.";

export function readBrowserJson(key: string): { value: unknown; error: string | null } {
  if (typeof window === "undefined") return { value: undefined, error: null };
  let saved: string | null;
  try {
    saved = window.localStorage.getItem(key);
  } catch {
    return { value: undefined, error: `Browser storage could not be read. ${sessionNotice}` };
  }
  if (saved === null) return { value: undefined, error: null };
  try {
    return { value: JSON.parse(saved), error: null };
  } catch {
    return { value: undefined, error: "Saved browser data contains invalid JSON and was not loaded. It has not been deleted." };
  }
}

export function writeBrowserJson(key: string, value: unknown): string | null {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return null;
  } catch {
    return `Changes could not be saved to browser storage. ${sessionNotice}`;
  }
}
