/* Runs before the first paint so switching themes never flashes the wrong one.
   Kept dependency-free: it may only duplicate the tiny resolve rule in src/theme.ts. */
(function () {
  var KEY = "qwen-studio.theme";
  var root = document.documentElement;
  var preference = "system";
  try {
    var stored = window.localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark" || stored === "system") preference = stored;
  } catch (error) {
    /* Private mode: fall back to the operating system setting. */
  }
  var dark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  var resolved = preference === "system" ? (dark ? "dark" : "light") : preference;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
})();
