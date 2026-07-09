// Popup: theme-aware quick controls for the global switch and the rule that
// matches the current tab. All behavior is here (MV3 CSP blocks inline JS).

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return prefersDark.matches ? "dark" : "light";
}

function applyStoredTheme() {
  chrome.storage.sync.get([THEME_KEY], (items) => {
    const pref = THEME_VALUES.includes(items[THEME_KEY]) ? items[THEME_KEY] : "auto";
    const resolved = resolveTheme(pref);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  });
}

applyStoredTheme();
prefersDark.addEventListener("change", applyStoredTheme);

const els = {
  global: document.getElementById("pp-global"),
  page: document.getElementById("pp-page"),
  pageRow: document.getElementById("pp-page-row"),
  pageSub: document.getElementById("pp-page-sub"),
  snoozeRow: document.getElementById("pp-snooze-row"),
  snoozeSub: document.getElementById("pp-snooze-sub"),
  snoozeResume: document.getElementById("pp-snooze-resume"),
  openOptions: document.getElementById("open-options")
};

const state = { rules: [], globalEnabled: true, stash: {} };
let matchedRuleId = null;
let snoozeUntil = 0;

function persist() {
  chrome.storage.sync.set({
    [STORAGE_KEY]: state.rules,
    [GLOBAL_KEY]: state.globalEnabled,
    [STASH_KEY]: state.stash
  });
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (_) {
    return "later";
  }
}

function render() {
  els.global.checked = state.globalEnabled;

  const rule = state.rules.find((r) => r.id === matchedRuleId);
  if (rule) {
    els.pageRow.classList.remove("disabled");
    els.page.disabled = false;
    els.page.checked = Boolean(rule.enabled);
    els.pageSub.textContent = rule.label || "Matched rule";
  } else {
    els.pageRow.classList.add("disabled");
    els.page.disabled = true;
    els.page.checked = false;
    els.pageSub.textContent = "No rule matches this page";
  }

  const snoozed = snoozeUntil > Date.now();
  els.snoozeRow.style.display = snoozed ? "" : "none";
  if (snoozed) els.snoozeSub.textContent = `Until ${formatTime(snoozeUntil)}`;
}

chrome.storage.sync.get([STORAGE_KEY, GLOBAL_KEY, STASH_KEY, SNOOZE_KEY], (items) => {
  state.rules = normalizeRules(items[STORAGE_KEY]);
  state.globalEnabled = items[GLOBAL_KEY] !== false;
  state.stash = items[STASH_KEY] && typeof items[STASH_KEY] === "object" ? items[STASH_KEY] : {};
  snoozeUntil = Number(items[SNOOZE_KEY]) || 0;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs && tabs[0] ? tabs[0].url || "" : "";
    // Include disabled rules so a per-page toggle can re-enable a matching rule.
    const matched = url ? findMatchingRule(state.rules, url, true) : null;
    matchedRuleId = matched ? matched.id : null;
    render();
  });
});

els.global.addEventListener("change", () => {
  setGlobalEnabled(state, els.global.checked);
  persist();
  render();
});

els.page.addEventListener("change", () => {
  if (!matchedRuleId) return;
  setRuleEnabled(state, matchedRuleId, els.page.checked);
  persist();
  render();
});

els.snoozeResume.addEventListener("click", () => {
  snoozeUntil = 0;
  chrome.storage.sync.set({ [SNOOZE_KEY]: 0 });
  render();
});

els.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
