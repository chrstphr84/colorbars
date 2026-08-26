function genId() {
  return `rule-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function genSegId() {
  return `seg-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

const state = {
  rules: [],
  openById: {},
  sectionOpen: {}, // `${ruleId}|${section}` -> bool, so re-renders keep sections open
  globalEnabled: true,
  stash: {},
  defaults: null // set on load via normalizeDefaults
};

const listEl = document.getElementById("rules-list");
const template = document.getElementById("rule-template");
const textSegTemplate = document.getElementById("text-segment-template");
const fleetSegTemplate = document.getElementById("fleet-segment-template");
const browserSegTemplate = document.getElementById("browser-segment-template");
const pageTitleSegTemplate = document.getElementById("pagetitle-segment-template");
const fleetRoleSegTemplate = document.getElementById("fleetrole-segment-template");
const elementSegTemplate = document.getElementById("element-segment-template");
const addButton = document.getElementById("add-rule");
const toastEl = document.getElementById("toast");
let toastTimer = null;

/* ----------------------------------------------------------------- Toast */
function showToast(message, isError = false, durationMs = 1000) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.toggle("error", isError);
  toastEl.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("show");
  }, durationMs);
}

/* ----------------------------------------------------------------- Theme */
const themeToggle = document.getElementById("theme-toggle");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
let themePref = "auto";

function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return prefersDark.matches ? "dark" : "light";
}

function applyTheme() {
  const resolved = resolveTheme(themePref);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  themeToggle.querySelectorAll("button").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.themeValue === themePref));
  });
}

function setTheme(pref) {
  themePref = THEME_VALUES.includes(pref) ? pref : "auto";
  chrome.storage.sync.set({ [THEME_KEY]: themePref });
  applyTheme();
}

// "Auto" tracks the OS preference live.
prefersDark.addEventListener("change", () => {
  if (themePref === "auto") applyTheme();
});

themeToggle.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-theme-value]");
  if (btn) setTheme(btn.dataset.themeValue);
});

/* ------------------------------------------------------ Mock-up toggle */
/* ------------------------------------------------ Tab indicator toggle */
const tabIndicatorToggle = document.getElementById("tab-indicator-toggle");
const tabScopeBlock = document.getElementById("tab-indicator-scope");
const tabScopeList = document.getElementById("tab-scope-list");
let tabIndicatorOn = false;
let tabScope = { mode: "all", ids: [] };

function persistTabScope() {
  chrome.storage.sync.set({ [TAB_SCOPE_KEY]: tabScope });
}

// Rebuild the "Applies to" control from the current rules, keeping it in sync as
// rules are added, renamed, or removed.
function renderTabScope() {
  tabScopeBlock.hidden = !tabIndicatorOn;
  document.querySelectorAll('input[name="tab-scope-mode"]').forEach((r) => {
    r.checked = r.value === tabScope.mode;
  });
  const selected = tabScope.mode === "selected";
  tabScopeList.hidden = !selected;
  if (!selected) return;

  tabScopeList.innerHTML = "";
  if (state.rules.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "No rules yet.";
    tabScopeList.appendChild(p);
    return;
  }
  state.rules.forEach((rule) => {
    const label = document.createElement("label");
    label.className = "inline";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = tabScope.ids.includes(rule.id);
    cb.addEventListener("change", () => {
      const set = new Set(tabScope.ids);
      if (cb.checked) set.add(rule.id);
      else set.delete(rule.id);
      tabScope.ids = [...set];
      persistTabScope();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(` ${rule.label || "Untitled rule"}`));
    tabScopeList.appendChild(label);
  });
}

function applyTabIndicatorState() {
  tabIndicatorToggle.checked = tabIndicatorOn;
  const meta = document.getElementById("tab-indicator-meta");
  if (meta) meta.textContent = tabIndicatorOn ? "On" : "Off";
  renderTabScope();
}

tabIndicatorToggle.addEventListener("change", () => {
  tabIndicatorOn = tabIndicatorToggle.checked;
  chrome.storage.sync.set({ [TAB_INDICATOR_KEY]: tabIndicatorOn });
  applyTabIndicatorState();
});

document.querySelectorAll('input[name="tab-scope-mode"]').forEach((r) => {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    tabScope.mode = r.value === "selected" ? "selected" : "all";
    persistTabScope();
    renderTabScope();
  });
});

/* ------------------------------------------------------------- Swatches */
// DEFAULT_SWATCHES lives in shared.js so the popup can reuse it.
const MAX_SWATCHES = 16;
let swatches = [];
const swatchTrayRefreshers = new Set();

function loadSwatches(done) {
  chrome.storage.sync.get([SWATCHES_KEY], (items) => {
    const stored = items[SWATCHES_KEY];
    swatches = Array.isArray(stored) && stored.length > 0 ? stored.slice(0, MAX_SWATCHES) : [...DEFAULT_SWATCHES];
    if (typeof done === "function") done();
  });
}

function persistSwatches() {
  chrome.storage.sync.set({ [SWATCHES_KEY]: swatches });
  swatchTrayRefreshers.forEach((fn) => fn());
}

function addSwatch(hex) {
  const value = clampHex(hex);
  if (swatches.includes(value)) return;
  swatches.unshift(value);
  if (swatches.length > MAX_SWATCHES) swatches.length = MAX_SWATCHES;
  persistSwatches();
}

function removeSwatch(hex) {
  swatches = swatches.filter((s) => s !== hex);
  persistSwatches();
}

/* --------------------------------------------------------- Color helpers */
function clampHex(hex) {
  const v = String(hex || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : "#000000";
}

function hexToRgb(hex) {
  const v = clampHex(hex);
  return {
    r: parseInt(v.slice(1, 3), 16),
    g: parseInt(v.slice(3, 5), 16),
    b: parseInt(v.slice(5, 7), 16)
  };
}

function rgbToHex(r, g, b) {
  const to = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

function hexToHsv(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

function hsvToHex(h, s, v) {
  const { r, g, b } = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

/* ------------------------------------------------------- Color picker UI */
// macOS-flavored popover: SV area + hue slider + hex field + saved swatches.
// The trigger button itself shows the chosen color. onChange(hex) persists.
function buildColorPicker(container, initialHex, onChange) {
  container.innerHTML = "";
  let hsv = hexToHsv(initialHex);
  let currentHex = clampHex(initialHex);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cb-color-trigger";
  const fill = document.createElement("span");
  fill.className = "cb-color-fill";
  const hexLabel = document.createElement("span");
  hexLabel.className = "cb-color-hex";
  trigger.append(fill, hexLabel);

  const pop = document.createElement("div");
  pop.className = "cb-color-pop";

  const svBox = document.createElement("div");
  svBox.className = "cb-sv";
  const svThumb = document.createElement("div");
  svThumb.className = "cb-sv-thumb";
  svBox.appendChild(svThumb);

  const hue = document.createElement("input");
  hue.type = "range";
  hue.className = "cb-hue";
  hue.min = "0";
  hue.max = "360";

  const hexRow = document.createElement("div");
  hexRow.className = "cb-hex-row";
  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.maxLength = 7;
  hexInput.spellcheck = false;
  hexRow.appendChild(hexInput);

  const swatchLabel = document.createElement("div");
  swatchLabel.className = "cb-swatches-label";
  swatchLabel.textContent = "Saved swatches";

  const tray = document.createElement("div");
  tray.className = "cb-swatches";

  pop.append(svBox, hue, hexRow, swatchLabel, tray);
  container.append(trigger, pop);

  function syncTrigger() {
    fill.style.background = currentHex;
    hexLabel.textContent = currentHex.toUpperCase();
  }

  function syncControls() {
    svBox.style.backgroundColor = `hsl(${hsv.h}, 100%, 50%)`;
    svThumb.style.left = `${hsv.s * 100}%`;
    svThumb.style.top = `${(1 - hsv.v) * 100}%`;
    hue.value = String(Math.round(hsv.h));
    hexInput.value = currentHex.toUpperCase();
  }

  function commit(hex, fromHsv) {
    currentHex = clampHex(hex);
    if (!fromHsv) hsv = hexToHsv(currentHex);
    syncTrigger();
    syncControls();
    onChange(currentHex);
  }

  function commitFromHsv() {
    commit(hsvToHex(hsv.h, hsv.s, hsv.v), true);
  }

  function renderTray() {
    tray.innerHTML = "";
    swatches.forEach((sw) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cb-swatch";
      btn.style.background = sw;
      btn.dataset.removable = "true";
      btn.title = `${sw} — click to use, shift-click to remove`;
      btn.addEventListener("click", (e) => {
        if (e.shiftKey) removeSwatch(sw);
        else commit(sw, false);
      });
      tray.appendChild(btn);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "cb-swatch add";
    add.textContent = "+";
    add.title = "Save current color";
    add.addEventListener("click", () => addSwatch(currentHex));
    tray.appendChild(add);
  }
  swatchTrayRefreshers.add(renderTray);

  // SV box dragging.
  function pickFromEvent(event) {
    const rect = svBox.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    hsv.s = x;
    hsv.v = 1 - y;
    commitFromHsv();
  }
  svBox.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pickFromEvent(event);
    const move = (e) => pickFromEvent(e);
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });

  hue.addEventListener("input", () => {
    hsv.h = Number(hue.value);
    commitFromHsv();
  });

  hexInput.addEventListener("input", () => {
    const v = hexInput.value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
      commit(v.startsWith("#") ? v : `#${v}`, false);
    }
  });

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = !pop.classList.contains("open");
    closeAllColorPops();
    if (willOpen) {
      pop.classList.add("open");
      renderTray();
      syncControls();
    }
  });

  syncTrigger();
  syncControls();

  return {
    setHex(hex) {
      commit(hex, false);
    }
  };
}

function closeAllColorPops() {
  document.querySelectorAll(".cb-color-pop.open").forEach((p) => p.classList.remove("open"));
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".color-field")) closeAllColorPops();
});

/* ----------------------------------------------------------- Rule fields */
function parsePath(obj, keyPath) {
  const parts = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length; i += 1) {
    current = current[parts[i]];
  }
  return current;
}

function setPath(obj, keyPath, value) {
  const parts = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

function typedValue(input) {
  if (input.type === "checkbox") return input.checked;
  return input.value;
}

function coerceRule(rule) {
  return normalizeRules([rule])[0];
}

function summaryMeta(rule) {
  if (rule.matchType === "domain") {
    const pattern = normalizeDomainPattern(rule.domainPattern || "", rule.assumeWildcards !== false);
    return `${pattern || "Domain Pattern"} | ${rule.barHeight}px`;
  }

  const bits = [];
  if (rule.scheme !== "any") bits.push(rule.scheme);
  if ((rule.hostPattern || "").trim()) bits.push(rule.hostPattern.trim());
  if ((rule.pathPattern || "").trim() && rule.pathPattern.trim() !== "/*") bits.push(rule.pathPattern.trim());
  if (rule.portMode === "specific" && (rule.portValue || "").trim()) bits.push(`port:${rule.portValue}`);
  if (rule.queryMode !== "any") bits.push(`query:${rule.queryMode}`);
  const base = bits.length > 0 ? bits.join(" | ") : "URL Components";
  return `${base} | ${rule.barHeight}px`;
}

function syncVisibility(root, rule) {
  const isDomain = rule.matchType === "domain";
  root.querySelector(".domain-fields").style.display = isDomain ? "grid" : "none";
  root.querySelector(".component-fields").style.display = isDomain ? "none" : "grid";

  const prefixValue = root.querySelector(".prefix-value");
  prefixValue.style.display = !isDomain && rule.hostPrefixMode === "specific" ? "flex" : "none";

  const portValue = root.querySelector(".port-value");
  portValue.style.display = !isDomain && rule.portMode === "specific" ? "flex" : "none";

  const queryKey = root.querySelector(".query-key");
  const queryValue = root.querySelector(".query-value");
  const qMode = rule.queryMode;
  queryKey.style.display = !isDomain && (qMode === "containsKey" || qMode === "containsPair") ? "flex" : "none";
  queryValue.style.display = !isDomain && (qMode === "specific" || qMode === "containsPair") ? "flex" : "none";

  const title = root.querySelector('[data-role="summary-title"]');
  const meta = root.querySelector('[data-role="summary-meta"]');
  title.textContent = rule.label || "Untitled Rule";
  meta.textContent = summaryMeta(rule);
  const wildcardHint = root.querySelector('[data-role="wildcard-hint"]');
  if (wildcardHint) {
    wildcardHint.innerHTML =
      rule.assumeWildcards !== false
        ? 'Wildcards <code>*</code> are assumed for the scheme and path when omitted. Everything else matches as typed — add <code>*</code> anywhere to wildcard any part of the URL (e.g. <code>*.example.com</code> for subdomains).'
        : 'Wildcards <code>*</code> must be entered manually for any desired components.';
  }

  // Blur only applies to a translucent bar: disable it (and blank the field)
  // at full opacity, while keeping the stored value to restore later.
  const blurInput = root.querySelector('[data-field="style.blur"]');
  if (blurInput) {
    const opacity = Number(rule.style.backgroundOpacity);
    const opaque = !(Number.isFinite(opacity) && opacity < 1);
    blurInput.disabled = opaque;
    blurInput.value = opaque ? "" : rule.style.blur ?? "";
  }

  // Tab title: the text field only matters when a mode is chosen; the warning
  // only applies to overwrite.
  const ttMode = (rule.tabTitle && rule.tabTitle.mode) || "off";
  const ttText = root.querySelector(".tabtitle-text");
  if (ttText) ttText.style.display = ttMode !== "off" ? "flex" : "none";
  const ttWarn = root.querySelector(".tabtitle-warning");
  if (ttWarn) ttWarn.style.display = ttMode === "overwrite" ? "block" : "none";
}

function validateRule(rule) {
  if (!rule.label.trim()) return "Rule name cannot be empty.";
  const h = Number(rule.barHeight);
  if (!Number.isFinite(h) || h < 16 || h > 120) return "Bar height must be between 16 and 120.";

  if (rule.matchType === "domain") {
    if (!rule.domainPattern.trim()) return "Domain pattern cannot be empty.";
    return "";
  }

  if (!rule.hostPattern.trim()) return "Host pattern is required in URL Components mode.";
  if (!rule.pathPattern.trim()) return "Path pattern is required in URL Components mode.";

  if (rule.portMode === "specific") {
    const p = Number(rule.portValue);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return "Specific port must be between 1 and 65535.";
  }
  if (rule.queryMode === "specific" && !rule.queryValue.trim()) {
    return "Exact query string cannot be empty.";
  }
  if (rule.queryMode === "containsKey" && !rule.queryKey.trim()) {
    return "Query key is required for key matching.";
  }
  if (rule.queryMode === "containsPair" && (!rule.queryKey.trim() || !rule.queryValue.trim())) {
    return "Query key and value are required for key/value matching.";
  }
  return "";
}

// Settings auto-save on every change. We no longer surface a "Saved" toast
// (it was inconsistent across settings and just added noise); validation
// errors are still shown. The unused first argument is kept so existing
// call sites don't need to change.
function save() {
  const next = state.rules.map((rule) => coerceRule(rule));
  for (const rule of next) {
    const error = validateRule(rule);
    if (error) {
      showToast(`Rule \"${rule.label || "Untitled"}\": ${error}`, true, 3000);
      return;
    }
  }

  chrome.storage.sync.set(
    { [STORAGE_KEY]: next, [GLOBAL_KEY]: state.globalEnabled, [STASH_KEY]: state.stash },
    () => {
      state.rules = next;
    }
  );
  updatePreview(); // keep a live preview in sync with edits
}

/* --------------------------------------------------------- Rule preview */
// A temporary, non-persisted preview of one rule's bar, pinned to the top of
// the settings page. Cleared when the page unloads (so it resets on leaving).
let previewRuleId = null;
const PREVIEW_ID = "cb-rule-preview";

function removePreview() {
  const el = document.getElementById(PREVIEW_ID);
  if (el) el.remove();
  document.body.style.removeProperty("padding-top");
}

function updatePreview() {
  const rule = previewRuleId ? state.rules.find((r) => r.id === previewRuleId) : null;
  if (!rule) {
    removePreview();
    return;
  }
  const style = rule.style || {};
  const hNum = Number(rule.barHeight);
  const h = Number.isFinite(hNum) ? Math.min(Math.max(Math.round(hNum), 16), 120) : 28;
  const fontSize = Math.min(Math.max(Number(style.fontSize) || 14, 8), h - 6);

  let bar = document.getElementById(PREVIEW_ID);
  if (!bar) {
    bar = document.createElement("div");
    bar.id = PREVIEW_ID;
    document.body.appendChild(bar);
  }
  bar.innerHTML = "";
  Object.assign(bar.style, {
    position: "fixed",
    top: "0",
    left: "0",
    right: "0",
    height: `${h}px`,
    zIndex: "2147483647",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: parseColorWithOpacity(style.backgroundColor, style.backgroundOpacity),
    color: parseColorWithOpacity(style.textColor, style.textOpacity),
    fontFamily: style.fontFamily || "Arial, sans-serif",
    fontWeight: style.fontWeight || "700",
    fontStyle: style.fontStyle || "normal",
    fontSize: `${fontSize}px`,
    letterSpacing: `${Math.max(0, Number(style.letterSpacing) || 0)}px`,
    textTransform: style.textTransform || "none",
    lineHeight: "1",
    boxSizing: "border-box",
    padding: "0 12px",
    borderBottom: "1px solid rgba(0, 0, 0, 0.15)",
    textShadow: "0 1px 1px rgba(0, 0, 0, 0.2)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    pointerEvents: "none"
  });

  const zones = {};
  ["left", "center", "right"].forEach((name) => {
    const z = document.createElement("div");
    Object.assign(z.style, {
      flex: "1 1 0",
      minWidth: "0",
      display: "flex",
      alignItems: "center",
      gap: "14px",
      overflow: "hidden",
      justifyContent: name === "left" ? "flex-start" : name === "right" ? "flex-end" : "center"
    });
    bar.appendChild(z);
    zones[name] = z;
  });

  (rule.segments || []).forEach((seg) => {
    if (!seg.enabled) return;
    // Dynamic segments show their template as a placeholder (real values appear
    // on the actual page).
    const text = seg.type === "text" ? seg.text || "" : seg.template || "";
    if (!text) return;
    const span = document.createElement("span");
    span.textContent = text;
    Object.assign(span.style, { minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
    (zones[seg.justify] || zones.center).appendChild(span);
  });

  document.body.style.paddingTop = `${h}px`;
}

/* -------------------------------------------------------------- Segments */
function segmentDisplayText(seg) {
  if (seg.label && seg.label.trim()) return seg.label.trim();
  if (seg.type === "fleet") return seg.template || "Fleet server";
  if (seg.type === "browser") return seg.template || "Browser";
  if (seg.type === "pagetitle") return seg.template || "Page title";
  if (seg.type === "fleetrole") return seg.template || "Fleet role";
  if (seg.type === "element") return "Sticky header";
  return seg.text || "Text";
}

function renderDnd(shell, rule) {
  const bar = shell.querySelector('[data-role="dnd-bar"]');
  bar.querySelectorAll(".dnd-chip").forEach((c) => c.remove());

  rule.segments.forEach((seg) => {
    if (!seg.enabled) return;
    const zone = bar.querySelector(`.dnd-zone[data-zone="${seg.justify}"]`) || bar.querySelector('[data-zone="center"]');
    const chip = document.createElement("div");
    chip.className = "dnd-chip";
    chip.draggable = true;
    chip.dataset.segId = seg.id;
    const text = document.createElement("span");
    text.className = "chip-text";
    text.textContent = segmentDisplayText(seg);
    chip.appendChild(text);
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", seg.id);
      e.dataTransfer.effectAllowed = "move";
      chip.classList.add("dragging");
    });
    chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
    zone.appendChild(chip);
  });

  // Hide a zone's label while it holds chips (prevents the label from shifting
  // chips around); show it again when the zone is empty.
  bar.querySelectorAll(".dnd-zone").forEach((zone) => {
    zone.classList.toggle("has-items", zone.querySelector(".dnd-chip") !== null);
  });
}

// The segment id, before which a drop should insert, given a horizontal x
// position within a zone. Returns null to append at the end of the zone.
function refChipBefore(zone, clientX, draggedId) {
  const chips = [...zone.querySelectorAll(".dnd-chip")].filter((c) => c.dataset.segId !== draggedId);
  for (const chip of chips) {
    const r = chip.getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return chip.dataset.segId;
  }
  return null;
}

// Move a segment into a zone, positioned before refSegId (or appended to the
// zone's group when refSegId is null). Reorders within the segments array so
// stacking order follows the drop position.
function placeSegment(idx, draggedId, zone, refSegId) {
  if (!JUSTIFY_VALUES.includes(zone)) return;
  const arr = state.rules[idx].segments;
  const dragged = arr.find((s) => s.id === draggedId);
  if (!dragged || draggedId === refSegId) return;

  arr.splice(arr.indexOf(dragged), 1);
  dragged.justify = zone;

  let insertAt;
  if (refSegId) {
    insertAt = arr.findIndex((s) => s.id === refSegId);
  } else {
    // Append after the last segment already in this zone, else at the end.
    let last = -1;
    arr.forEach((s, i) => {
      if (s.justify === zone) last = i;
    });
    insertAt = last === -1 ? arr.length : last + 1;
  }
  if (insertAt < 0) insertAt = arr.length;
  arr.splice(insertAt, 0, dragged);

  save(false);
  render();
}

function renderSegments(shell, rule, idx) {
  const container = shell.querySelector('[data-role="segments"]');
  container.innerHTML = "";

  rule.segments.forEach((seg, segIdx) => {
    const tplByType = {
      fleet: fleetSegTemplate,
      browser: browserSegTemplate,
      pagetitle: pageTitleSegTemplate,
      fleetrole: fleetRoleSegTemplate,
      element: elementSegTemplate,
      text: textSegTemplate
    };
    const tpl = tplByType[seg.type] || textSegTemplate;
    const frag = tpl.content.cloneNode(true);
    const segEl = frag.querySelector('[data-role="segment"]');
    const nameEl = segEl.querySelector('[data-role="seg-name"]');
    nameEl.textContent = segmentDisplayText(seg);

    segEl.querySelectorAll("[data-seg-field]").forEach((input) => {
      const field = input.getAttribute("data-seg-field");
      const value = seg[field];
      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = value ?? "";

      input.addEventListener("input", () => {
        state.rules[idx].segments[segIdx][field] = typedValue(input);
        if (field === "label" || field === "text" || field === "template") {
          nameEl.textContent = segmentDisplayText(state.rules[idx].segments[segIdx]);
          renderDnd(shell, state.rules[idx]);
        }
        if (field === "justify" || field === "enabled") {
          renderDnd(shell, state.rules[idx]);
        }
        save(false);
      });
    });

    segEl.querySelector('[data-action="delete-segment"]').addEventListener("click", () => {
      state.rules[idx].segments.splice(segIdx, 1);
      render();
      save(true);
    });

    // Drag handle lets the whole segment be dropped into a zone.
    const handle = segEl.querySelector(".seg-drag");
    handle.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", seg.id);
    });

    container.appendChild(frag);
  });

  // Wire drop zones (drop into a zone, and reorder within a zone).
  const bar = shell.querySelector('[data-role="dnd-bar"]');
  function clearInsertMarks() {
    bar.querySelectorAll(".insert-before").forEach((c) => c.classList.remove("insert-before"));
  }
  shell.querySelectorAll(".dnd-zone").forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      zone.classList.add("drag-over");
      const dragging = bar.querySelector(".dnd-chip.dragging");
      const draggedId = dragging ? dragging.dataset.segId : null;
      const ref = refChipBefore(zone, e.clientX, draggedId);
      clearInsertMarks();
      if (ref) {
        const refChip = zone.querySelector(`.dnd-chip[data-seg-id="${ref}"]`);
        if (refChip) refChip.classList.add("insert-before");
      }
    });
    zone.addEventListener("dragleave", () => {
      zone.classList.remove("drag-over");
      clearInsertMarks();
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const segId = e.dataTransfer.getData("text/plain");
      const ref = refChipBefore(zone, e.clientX, segId);
      clearInsertMarks();
      if (segId) placeSegment(idx, segId, zone.dataset.zone, ref);
    });
  });

  renderDnd(shell, rule);
}

function addSegment(idx, type) {
  const base = structuredClone(defaultSegmentForType(type));
  base.id = genSegId();
  base.enabled = true;
  state.rules[idx].segments.push(base);
  render();
  save(true);
}

/* ---------------------------------------------------------------- Render */
function render() {
  closeAllColorPops();
  swatchTrayRefreshers.clear();
  listEl.innerHTML = "";

  state.rules.forEach((rule, idx) => {
    const fragment = template.content.cloneNode(true);
    const shell = fragment.querySelector('[data-role="rule-shell"]');
    shell.dataset.ruleId = rule.id;

    shell.open = Boolean(state.openById[rule.id]);
    shell.addEventListener("toggle", () => {
      state.openById[rule.id] = shell.open;
    });

    // Collapsible sections (Bar Appearance / Bar Text), collapsed by default;
    // remember open state so re-renders (e.g. adding a segment) don't collapse them.
    shell.querySelectorAll(".rule-section").forEach((section) => {
      const key = `${rule.id}|${section.dataset.section}`;
      section.open = Boolean(state.sectionOpen[key]);
      section.addEventListener("toggle", () => {
        state.sectionOpen[key] = section.open;
      });
    });

    shell.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.getAttribute("data-field");
      const value = parsePath(rule, field);

      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = value ?? "";

      input.addEventListener("input", () => {
        if (field === "enabled") {
          // Routes through the shared helper so enabling a rule while globally
          // disabled lifts the global disable and restores the other rules.
          setRuleEnabled(state, state.rules[idx].id, input.checked);
          renderGlobalSection();
          render();
          save(false);
          return;
        }
        setPath(state.rules[idx], field, typedValue(input));
        syncVisibility(shell, state.rules[idx]);
        save(false);
      });
    });

    // Custom color pickers (background + text color).
    shell.querySelectorAll("[data-color-field]").forEach((container) => {
      const path = container.getAttribute("data-color-field");
      const current = parsePath(rule, path) || "#000000";
      buildColorPicker(container, current, (hex) => {
        setPath(state.rules[idx], path, hex);
        save(false);
      });
    });

    shell.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (previewRuleId === rule.id) previewRuleId = null;
      state.rules.splice(idx, 1);
      render();
      save(true);
    });

    // Temporary per-rule preview (not persisted; only one at a time).
    const previewToggle = shell.querySelector('[data-role="preview-toggle"]');
    previewToggle.checked = previewRuleId === rule.id;
    previewToggle.addEventListener("change", () => {
      if (previewToggle.checked) {
        previewRuleId = rule.id;
        document.querySelectorAll('[data-role="preview-toggle"]').forEach((t) => {
          if (t !== previewToggle) t.checked = false;
        });
      } else {
        previewRuleId = null;
      }
      updatePreview();
    });

    shell.querySelector('[data-action="add-text"]').addEventListener("click", () => addSegment(idx, "text"));
    shell.querySelector('[data-action="add-fleet"]').addEventListener("click", () => addSegment(idx, "fleet"));
    shell.querySelector('[data-action="add-browser"]').addEventListener("click", () => addSegment(idx, "browser"));
    shell.querySelector('[data-action="add-pagetitle"]').addEventListener("click", () => addSegment(idx, "pagetitle"));
    shell.querySelector('[data-action="add-fleetrole"]').addEventListener("click", () => addSegment(idx, "fleetrole"));
    shell.querySelector('[data-action="add-element"]').addEventListener("click", () => addSegment(idx, "element"));

    syncVisibility(shell, rule);
    renderSegments(shell, rule, idx);
    listEl.appendChild(fragment);
  });

  // Keep the Tab indicator "Selected rules" checklist in sync with the rules.
  if (typeof renderTabScope === "function") renderTabScope();
}

function load() {
  chrome.storage.sync.get(
    [STORAGE_KEY, GLOBAL_KEY, STASH_KEY, DEFAULTSTYLE_KEY, SNOOZE_KEY, FOCUS_KEY],
    (items) => {
      state.rules = normalizeRules(items[STORAGE_KEY]);
      state.globalEnabled = items[GLOBAL_KEY] !== false;
      state.stash = items[STASH_KEY] && typeof items[STASH_KEY] === "object" ? items[STASH_KEY] : {};
      state.defaults = normalizeDefaults(items[DEFAULTSTYLE_KEY]);
      globalState.snoozeUntil = Number(items[SNOOZE_KEY]) || 0;

      // Hand-off from the popup: expand + scroll to a just-created rule.
      const focusId = items[FOCUS_KEY];
      if (focusId && state.rules.some((r) => r.id === focusId)) {
        state.openById[focusId] = true;
        chrome.storage.sync.remove(FOCUS_KEY);
      }

      initGlobalSection();
      render();

      if (focusId) {
        const shell = listEl.querySelector(`[data-rule-id="${focusId}"]`);
        if (shell) shell.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  );
}

/* ----------------------------------------------------- Global section */
const globalState = { snoozeUntil: 0 };
const globalToggle = document.getElementById("global-toggle");
const snoozeActive = document.getElementById("snooze-active");
const snoozeControls = document.getElementById("snooze-controls");
const snoozeText = document.getElementById("snooze-text");
const snoozeMeta = document.getElementById("snooze-meta");
let globalInited = false;
let snoozeTick = null;

function renderGlobalSection() {
  globalToggle.checked = state.globalEnabled;

  const snoozed = globalState.snoozeUntil > Date.now();
  snoozeActive.style.display = snoozed ? "flex" : "none";
  snoozeControls.style.display = snoozed ? "none" : "flex";
  if (snoozed) {
    const t = new Date(globalState.snoozeUntil).toLocaleString([], {
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric"
    });
    snoozeText.textContent = `Snoozed until ${t}`;
    snoozeMeta.textContent = `Until ${t}`;
  } else {
    snoozeMeta.textContent = "Not snoozed";
  }
}

function setSnooze(until) {
  globalState.snoozeUntil = until;
  chrome.storage.sync.set({ [SNOOZE_KEY]: until });
  renderGlobalSection();
  scheduleSnoozeTick();
}

function scheduleSnoozeTick() {
  if (snoozeTick) clearTimeout(snoozeTick);
  const remaining = globalState.snoozeUntil - Date.now();
  if (remaining > 0) snoozeTick = setTimeout(renderGlobalSection, Math.min(remaining + 500, 2147483647));
}

function initGlobalSection() {
  renderGlobalSection();
  scheduleSnoozeTick();
  if (globalInited) return;
  globalInited = true;

  globalToggle.addEventListener("change", () => {
    setGlobalEnabled(state, globalToggle.checked);
    render();
    save(true);
  });

  document.querySelectorAll("[data-snooze]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-snooze");
      let until;
      if (kind === "tomorrow") {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        until = d.getTime() + 24 * 60 * 60 * 1000;
      } else {
        until = Date.now() + Number(kind) * 60 * 1000;
      }
      setSnooze(until);
    });
  });
  document.getElementById("snooze-resume").addEventListener("click", () => setSnooze(0));

  // Default-style fields + color pickers (bound to state.defaults).
  document.querySelectorAll("[data-default-field]").forEach((input) => {
    const path = input.getAttribute("data-default-field");
    input.value = parsePath(state.defaults, path) ?? "";
    input.addEventListener("input", () => {
      setPath(state.defaults, path, input.value);
      chrome.storage.sync.set({ [DEFAULTSTYLE_KEY]: state.defaults });
    });
  });
  document.querySelectorAll("[data-default-color]").forEach((container) => {
    const path = container.getAttribute("data-default-color");
    buildColorPicker(container, parsePath(state.defaults, path) || "#000000", (hex) => {
      setPath(state.defaults, path, hex);
      chrome.storage.sync.set({ [DEFAULTSTYLE_KEY]: state.defaults });
    });
  });
}

addButton.addEventListener("click", () => {
  // Adding a rule implies wanting bars again, so lift any global disable first.
  if (!state.globalEnabled) {
    setGlobalEnabled(state, true);
    renderGlobalSection();
  }
  const defaults = state.defaults || normalizeDefaults(null);
  const rule = {
    ...structuredClone(DEFAULT_RULE),
    id: genId(),
    label: `Rule ${state.rules.length + 1}`,
    barHeight: defaults.barHeight,
    layoutMode: defaults.layoutMode,
    style: structuredClone(defaults.style),
    segments: [{ ...structuredClone(DEFAULT_TEXT_SEGMENT), id: genSegId() }]
  };
  state.rules.push(rule);
  state.openById[rule.id] = true;
  render();
  save(true);
});

/* ------------------------------------------------------------- Bootstrap */
const versionEl = document.getElementById("ext-version");
if (versionEl) {
  const manifest = chrome.runtime.getManifest();
  versionEl.textContent = `Colorbars v${manifest.version}`;
}

loadTheme();
loadTabIndicatorPref();
loadSwatches(() => {
  load();
});

function loadTheme() {
  chrome.storage.sync.get([THEME_KEY], (items) => {
    themePref = THEME_VALUES.includes(items[THEME_KEY]) ? items[THEME_KEY] : "auto";
    applyTheme();
  });
}

function loadTabIndicatorPref() {
  chrome.storage.sync.get([TAB_INDICATOR_KEY, TAB_SCOPE_KEY], (items) => {
    tabIndicatorOn = items[TAB_INDICATOR_KEY] === true; // default off
    const s = items[TAB_SCOPE_KEY];
    tabScope = {
      mode: s && s.mode === "selected" ? "selected" : "all",
      ids: s && Array.isArray(s.ids) ? s.ids : []
    };
    applyTabIndicatorState();
  });
}
