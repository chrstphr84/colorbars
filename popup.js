// Popup: theme-aware quick controls (global switch, per-page toggle, snooze) and
// a collapsible "create rule from this page" flow. All behavior is here (MV3 CSP
// blocks inline JS).

function genId() {
  return `rule-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}
function genSegId() {
  return `seg-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

/* ----------------------------------------------------------------- Theme */
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
prefersDark.addEventListener("change", applyStoredTheme);

/* ----------------------------------------------------------------- State */
const els = {
  global: document.getElementById("pp-global"),
  page: document.getElementById("pp-page"),
  pageRow: document.getElementById("pp-page-row"),
  pageSub: document.getElementById("pp-page-sub"),
  snoozeRow: document.getElementById("pp-snooze-row"),
  snoozeSub: document.getElementById("pp-snooze-sub"),
  snoozeResume: document.getElementById("pp-snooze-resume"),
  openOptions: document.getElementById("open-options"),
  // create accordion
  toggle: document.getElementById("pp-create-toggle"),
  panel: document.getElementById("pp-panel"),
  createFields: document.getElementById("pp-create-fields"),
  existsMsg: document.getElementById("pp-exists-msg"),
  doneBlock: document.getElementById("pp-done-block"),
  name: document.getElementById("pp-name"),
  text: document.getElementById("pp-text"),
  textError: document.getElementById("pp-text-error"),
  swatches: document.getElementById("pp-swatches"),
  wild: document.getElementById("pp-wild"),
  pattern: document.getElementById("pp-pattern"),
  donePreview: document.getElementById("pp-done-preview"),
  doneMsg: document.getElementById("pp-done-msg"),
  action: document.getElementById("pp-action")
};

const state = { rules: [], globalEnabled: true, stash: {} };
let matchedRuleId = null;
let snoozeUntil = 0;
let currentUrl = "";
let supported = false;
let defaults = null;
let swatches = [];
let chosenColor = "#ff7a18";
let swatchList = []; // stable order so selecting one doesn't reshuffle
let conflictRuleId = null;
let createdRuleId = null;
let panelState = "collapsed"; // collapsed | create | exists | done

function persist() {
  cbStore.set({
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

function hostOf(href) {
  const url = buildUrlForMatching(href);
  return url ? url.hostname.replace(/^www\./, "") : "";
}

function suggestedText(href) {
  const host = hostOf(href);
  const labels = host.split(".").filter(Boolean);
  const sld = labels.length >= 2 ? labels[labels.length - 2] : labels[0] || "";
  return sld.toUpperCase();
}

/* ------------------------------------------------------- Top-of-popup UI */
function refreshMatch() {
  const matched = currentUrl ? findMatchingRule(state.rules, currentUrl, true) : null;
  matchedRuleId = matched ? matched.id : null;
}

function render() {
  els.global.checked = state.globalEnabled;

  const rule = state.rules.find((r) => r.id === matchedRuleId);
  if (rule) {
    els.pageRow.classList.remove("disabled");
    els.page.disabled = false;
    els.page.checked = Boolean(rule.enabled);
    els.pageSub.textContent = rule.label || "Matched rule";
    els.pageSub.title = rule.label || "";
  } else {
    els.pageRow.classList.add("disabled");
    els.page.disabled = true;
    els.page.checked = false;
    els.pageSub.textContent = "No rule matches this page";
    els.pageSub.title = "";
  }

  const snoozed = snoozeUntil > Date.now();
  els.snoozeRow.style.display = snoozed ? "" : "none";
  if (snoozed) els.snoozeSub.textContent = `Until ${formatTime(snoozeUntil)}`;
}

/* ----------------------------------------------------- Create accordion */
function setState(s) {
  panelState = s;
  els.panel.hidden = s === "collapsed";
  els.createFields.hidden = s !== "create";
  els.existsMsg.hidden = s !== "exists";
  els.doneBlock.hidden = s !== "done";
  els.action.hidden = s === "collapsed";

  els.action.disabled = false;
  els.action.textContent = s === "create" ? "Create rule" : "Edit rule";
  els.toggle.textContent = s === "collapsed" ? "Create rule for this page ▾" : "Create rule for this page ▴";
}

function clearTextInvalid() {
  els.text.classList.remove("pp-invalid");
  els.textError.hidden = true;
}

function markTextInvalid() {
  els.text.classList.add("pp-invalid");
  els.textError.hidden = false;
  els.text.focus();
}

// Build the swatch list once (stable order) so selecting one only moves the
// highlight — it never reshuffles the swatches.
function buildSwatchList() {
  const seen = new Set();
  swatchList = [];
  [...swatches, chosenColor].forEach((raw) => {
    const c = String(raw || "").toLowerCase();
    if (c && !seen.has(c)) {
      seen.add(c);
      swatchList.push(c);
    }
  });
}

function renderSwatches() {
  els.swatches.innerHTML = "";
  swatchList.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pp-swatch" + (c === chosenColor.toLowerCase() ? " selected" : "");
    b.style.background = c;
    b.title = c;
    b.addEventListener("click", () => {
      chosenColor = c;
      renderSwatches();
    });
    els.swatches.appendChild(b);
  });
}

function updatePatternHint() {
  const pattern = patternForUrl(currentUrl, els.wild.checked);
  els.pattern.textContent = pattern ? `Matches: ${pattern}` : "";
  els.pattern.title = pattern || "";
}

function openAccordion() {
  // A rule already covers this page → offer to edit it instead of creating one.
  const existing = currentUrl ? findMatchingRule(state.rules, currentUrl, true) : null;
  if (existing) {
    conflictRuleId = existing.id;
    const msg = `A rule already covers this page: ${existing.label || "Untitled rule"}`;
    els.existsMsg.textContent = msg;
    els.existsMsg.title = msg;
    setState("exists");
    return;
  }

  els.name.value = hostOf(currentUrl) || "New rule";
  els.text.value = "";
  els.text.placeholder = suggestedText(currentUrl) || "STAGING";
  els.wild.checked = true;
  chosenColor = (defaults && defaults.style.backgroundColor) || DEFAULT_RULE.style.backgroundColor;
  buildSwatchList();
  renderSwatches();
  updatePatternHint();
  clearTextInvalid();
  setState("create");
  els.text.focus();
}

function createRule() {
  const barText = els.text.value.trim();
  if (!barText) return;
  const name = els.name.value.trim() || hostOf(currentUrl) || "New rule";
  const pattern = patternForUrl(currentUrl, els.wild.checked);
  if (!pattern) return;

  // Creating a rule implies wanting bars, so lift any global disable first.
  if (!state.globalEnabled) setGlobalEnabled(state, true);

  const base = defaults || normalizeDefaults(null);
  const rule = {
    ...structuredClone(DEFAULT_RULE),
    id: genId(),
    enabled: true,
    label: name,
    matchType: "domain",
    domainPattern: pattern,
    assumeWildcards: false,
    barHeight: base.barHeight,
    layoutMode: base.layoutMode,
    style: { ...structuredClone(base.style), backgroundColor: chosenColor },
    segments: [
      { ...structuredClone(DEFAULT_TEXT_SEGMENT), id: genSegId(), text: barText, justify: "center", enabled: true }
    ]
  };
  state.rules.push(rule);
  createdRuleId = rule.id;
  persist();
  refreshMatch();
  render();

  els.donePreview.textContent = barText;
  els.donePreview.title = barText;
  els.donePreview.style.background = chosenColor;
  els.donePreview.style.color = base.style.textColor || "#ffffff";
  els.donePreview.style.textTransform = base.style.textTransform || "none";
  const host = hostOf(currentUrl);
  els.doneMsg.textContent = `Rule created for ${host}`;
  els.doneMsg.title = host;
  setState("done");
}

function openRuleInOptions(ruleId) {
  if (!ruleId) return;
  cbStore.set({ [FOCUS_KEY]: ruleId }, () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
}

/* ---------------------------------------------------------------- Load */
cbStore.get(
  [STORAGE_KEY, GLOBAL_KEY, STASH_KEY, SNOOZE_KEY, DEFAULTSTYLE_KEY, SWATCHES_KEY],
  (items) => {
    state.rules = normalizeRules(items[STORAGE_KEY]);
    state.globalEnabled = items[GLOBAL_KEY] !== false;
    state.stash = items[STASH_KEY] && typeof items[STASH_KEY] === "object" ? items[STASH_KEY] : {};
    snoozeUntil = Number(items[SNOOZE_KEY]) || 0;
    defaults = normalizeDefaults(items[DEFAULTSTYLE_KEY]);
    swatches =
      Array.isArray(items[SWATCHES_KEY]) && items[SWATCHES_KEY].length > 0
        ? items[SWATCHES_KEY]
        : [...DEFAULT_SWATCHES];

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      currentUrl = tabs && tabs[0] ? tabs[0].url || "" : "";
      supported = isSupportedPageUrl(currentUrl);
      refreshMatch();
      render();

      if (supported) {
        setState("collapsed");
        // A rule already covers this page → the button edits it instead of
        // offering to create a duplicate.
        if (matchedRuleId) els.toggle.textContent = "Edit rule for this page ▸";
      } else {
        els.toggle.disabled = true;
        els.toggle.textContent = "Can't add a bar to this page";
      }
    });
  }
);

/* ------------------------------------------------------------- Wiring */
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
  cbStore.set({ [SNOOZE_KEY]: 0 });
  render();
});

els.toggle.addEventListener("click", () => {
  if (!supported) return;
  // If a rule already covers this page, jump straight to editing it.
  if (matchedRuleId) {
    openRuleInOptions(matchedRuleId);
    return;
  }
  if (panelState === "collapsed") openAccordion();
  else setState("collapsed");
});

els.text.addEventListener("input", clearTextInvalid);
els.wild.addEventListener("change", updatePatternHint);

els.action.addEventListener("click", () => {
  if (panelState === "create") {
    if (!els.text.value.trim()) {
      markTextInvalid();
      return;
    }
    createRule();
  } else if (panelState === "exists") {
    openRuleInOptions(conflictRuleId);
  } else if (panelState === "done") {
    openRuleInOptions(createdRuleId);
  }
});

els.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
