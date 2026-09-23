export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "qwen-studio.theme";
export const DEFAULT_THEME: ThemePreference = "system";

const VALID = new Set<ThemePreference>(["light", "dark", "system"]);

export function normalizeTheme(value: unknown): ThemePreference {
  return typeof value === "string" && VALID.has(value as ThemePreference)
    ? (value as ThemePreference)
    : DEFAULT_THEME;
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

function systemPrefersDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/**
 * Writes the concrete theme, never "system", so the stylesheet only needs two
 * blocks. Mirrors the preference to localStorage for the next first paint.
 */
export function applyTheme(preference: ThemePreference) {
  const normalized = normalizeTheme(preference);
  const resolved = resolveTheme(normalized, systemPrefersDark());
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = normalized;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalized);
  } catch {
    /* Private mode: the server setting still applies after the session loads. */
  }
  return resolved;
}

/** Re-applies while the preference is "system" so the OS switch takes effect. */
export function watchSystemTheme() {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    const stored = normalizeTheme(
      (() => {
        try {
          return window.localStorage.getItem(THEME_STORAGE_KEY);
        } catch {
          return null;
        }
      })()
    );
    if (stored === "system") applyTheme("system");
  };
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}
