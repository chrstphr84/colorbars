// External script for the help page. MV3's CSP blocks inline <script> and inline
// event handlers on extension pages, so all behavior lives here.

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return prefersDark.matches ? "dark" : "light";
}

function applyStoredTheme() {
  cbStore.get([THEME_KEY], (items) => {
    const pref = THEME_VALUES.includes(items[THEME_KEY]) ? items[THEME_KEY] : "auto";
    const resolved = resolveTheme(pref);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  });
}

applyStoredTheme();

// Track live OS changes (when on Auto) and changes made on the settings page.
prefersDark.addEventListener("change", applyStoredTheme);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[THEME_KEY]) applyStoredTheme();
});

// Back button: return to the settings page.
const backBtn = document.getElementById("back-btn");
if (backBtn) {
  backBtn.addEventListener("click", () => {
    if (window.history.length > 1) window.history.back();
    else chrome.runtime.openOptionsPage();
  });
}

const versionEl = document.getElementById("ext-version");
if (versionEl) versionEl.textContent = `Colorbars v${chrome.runtime.getManifest().version}`;
