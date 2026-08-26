const BAR_ID = "__domain_top_bar__";
const HTML_PADDING_ATTR = "data-domain-top-bar-prev-padding-top";

let appliedRule = null;
const textMeasurer = document.createElement("canvas").getContext("2d");

// The page's own title, tracked separately from document.title because the
// tab-title feature may overwrite document.title. A Page Title segment reads
// this so it always shows the real title.
let realPageTitle = document.title;
let tabTitleCfg = null; // matched rule's tabTitle, or null
let cbManagedTitle = null; // the value we last wrote to document.title (loop guard)

// Per-origin cache of Fleet /version lookups so each tab fetches at most once.
// state: "pending" | "ready" | "none".
const fleetCache = new Map();

async function fetchFleetInfo() {
  // The public /version endpoint identifies a Fleet server with no auth needed.
  try {
    const res = await fetch(`${location.origin}/version`, { credentials: "omit", cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (isFleetVersionInfo(data)) return data;
    }
  } catch (_) {
    // Network error / non-JSON: treat as "not a Fleet server here".
  }
  return null;
}

// Returns the cache entry for this origin, kicking off a one-time fetch when the
// origin has not been probed yet. onReady runs once the lookup resolves so the
// caller can re-render with the now-known server info.
function getFleetInfo(onReady) {
  const key = location.origin;
  const cached = fleetCache.get(key);
  if (cached) return cached;

  const entry = { state: "pending", info: null };
  fleetCache.set(key, entry);
  fetchFleetInfo().then((info) => {
    fleetCache.set(key, { state: info ? "ready" : "none", info });
    if (typeof onReady === "function") onReady();
  });
  return entry;
}

// Fleet stores its session token in a cookie (set client-side by js-cookie, so
// it's readable here). The server authenticates the API via the Authorization
// header, not the cookie, so we read the token and send it as a Bearer header.
function fleetAuthToken() {
  const c = document.cookie || "";
  const host = c.match(/(?:^|;\s*)__Host-token=([^;]+)/); // HTTPS
  if (host) return decodeURIComponent(host[1]);
  const plain = c.match(/(?:^|;\s*)token=([^;]+)/); // HTTP
  return plain ? decodeURIComponent(plain[1]) : "";
}

// Logged-in Fleet user's role via the authenticated /me endpoint. Fetched at
// most once per tab.
let fleetRoleCache = null; // { state: "pending"|"ready"|"none", role }
function getFleetRole(onReady) {
  if (fleetRoleCache) return fleetRoleCache;
  fleetRoleCache = { state: "pending", role: "" };
  const token = fleetAuthToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  fetch(`${location.origin}/api/latest/fleet/me`, { credentials: "include", headers, cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      fleetRoleCache = isFleetMeResponse(data)
        ? { state: "ready", role: fleetDisplayRole(data.user) }
        : { state: "none", role: "" };
      if (typeof onReady === "function") onReady();
    })
    .catch(() => {
      fleetRoleCache = { state: "none", role: "" };
      if (typeof onReady === "function") onReady();
    });
  return fleetRoleCache;
}

function clearPageOffset() {
  const html = document.documentElement;
  html.style.removeProperty("scroll-padding-top");
  if (html.hasAttribute(HTML_PADDING_ATTR)) {
    const prev = html.getAttribute(HTML_PADDING_ATTR) || "";
    if (prev) html.style.paddingTop = prev;
    else html.style.removeProperty("padding-top");
    html.removeAttribute(HTML_PADDING_ATTR);
  }
}

function removeBar() {
  const existing = document.getElementById(BAR_ID);
  if (existing) existing.remove();
  clearPageOffset();
  appliedRule = null;
}

function ensurePageOffset(heightPx) {
  const html = document.documentElement;
  html.style.setProperty("scroll-padding-top", `${heightPx}px`);
  if (html.hasAttribute(HTML_PADDING_ATTR)) return;

  html.setAttribute(HTML_PADDING_ATTR, html.style.paddingTop || "");
  const computed = window.getComputedStyle(html).paddingTop;
  const current = Number.parseFloat(computed || "0");
  const next = Number.isFinite(current) ? current + heightPx : heightPx;
  html.style.paddingTop = `${next}px`;
}

function getBarHeight(rule) {
  const raw = Number(rule && rule.barHeight ? rule.barHeight : 28);
  if (!Number.isFinite(raw)) return 28;
  return Math.min(Math.max(Math.round(raw), 16), 120);
}

function transformLabelText(input, transform) {
  const text = String(input || "");
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  if (transform === "capitalize") {
    return text.replace(/\S+/g, (word) => {
      if (!word) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
  }
  return text;
}

function constrainTypography(bar, style, barHeightPx) {
  const rawSize = Number(style.fontSize || 14);
  const maxByHeight = Math.max(8, barHeightPx - 6);
  const safeSize = Math.min(Math.max(Number.isFinite(rawSize) ? rawSize : 14, 8), maxByHeight);

  bar.style.fontSize = `${safeSize}px`;

  const family = style.fontFamily || "Arial, sans-serif";
  const weight = style.fontWeight || "700";
  const fontStyle = style.fontStyle || "normal";
  const text = bar.textContent || "";

  if (!textMeasurer) {
    bar.style.letterSpacing = `${Math.max(0, Number(style.letterSpacing || 0))}px`;
    return;
  }

  textMeasurer.font = `${fontStyle} ${weight} ${safeSize}px ${family}`;
  const baseWidth = textMeasurer.measureText(text).width;
  const available = Math.max(1, window.innerWidth - 24);
  const requestedSpacing = Math.max(0, Number(style.letterSpacing || 0));

  let maxSpacing = requestedSpacing;
  if (text.length > 1) {
    maxSpacing = Math.max(0, (available - baseWidth) / (text.length - 1));
  }
  bar.style.letterSpacing = `${Math.min(requestedSpacing, maxSpacing)}px`;
}

// Resolve every enabled segment of the rule into {justify, text} entries.
// Fleet segments only produce text once their /version lookup has resolved as a
// Fleet server; otherwise they render nothing (and never reserve space).
// Browser details. Chromium freezes navigator.userAgent to X.0.0.0, so the full
// version + platform + architecture come from the async high-entropy Client
// Hints API. While that resolves we render nothing (state "pending"); browsers
// without Client Hints fall back to the (unfrozen) UA string synchronously.
let browserState = null; // null=unstarted | "pending" | "ready"
let browserInfo = null;
function getBrowserInfo(onReady) {
  const uad = navigator.userAgentData;
  if (!uad || typeof uad.getHighEntropyValues !== "function") {
    if (!browserInfo) browserInfo = parseBrowserInfo(navigator.userAgent);
    return browserInfo;
  }
  if (browserState === "ready") return browserInfo;
  if (browserState === null) {
    browserState = "pending";
    uad
      .getHighEntropyValues(["fullVersionList", "architecture", "bitness", "platform", "platformVersion"])
      .then((he) => {
        browserInfo = mergeBrowserHighEntropy(parseBrowserInfo(navigator.userAgent), he);
        browserState = "ready";
        if (typeof onReady === "function") onReady();
      })
      .catch(() => {
        browserInfo = parseBrowserInfo(navigator.userAgent);
        browserState = "ready";
        if (typeof onReady === "function") onReady();
      });
  }
  return browserState === "ready" ? browserInfo : null;
}

function resolveSegments(rule, onFleetReady) {
  const transform = (rule.style && rule.style.textTransform) || "none";
  const resolved = [];
  for (const seg of rule.segments || []) {
    if (!seg || !seg.enabled) continue;
    if (seg.type === "fleet") {
      const entry = getFleetInfo(onFleetReady);
      if (entry.state === "ready") {
        const text = formatFleetTemplate(seg.template, entry.info);
        if (text) resolved.push({ justify: seg.justify, text: transformLabelText(text, transform) });
      }
    } else if (seg.type === "browser") {
      const info = getBrowserInfo(onFleetReady);
      if (info) {
        const text = formatBrowserTemplate(seg.template, info);
        if (text) resolved.push({ justify: seg.justify, text: transformLabelText(text, transform) });
      }
    } else if (seg.type === "pagetitle") {
      const text = formatPageTitleTemplate(seg.template, realPageTitle);
      if (text) resolved.push({ justify: seg.justify, text: transformLabelText(text, transform) });
    } else if (seg.type === "fleetrole") {
      const entry = getFleetRole(onFleetReady);
      if (entry.state === "ready" && entry.role) {
        const text = formatFleetRoleTemplate(seg.template, entry.role);
        if (text) resolved.push({ justify: seg.justify, text: transformLabelText(text, transform) });
      }
    } else if (seg.type === "element") {
      const raw = readElementText(seg.selector);
      if (raw) {
        const text = formatElementTemplate(seg.template, raw);
        if (text) resolved.push({ justify: seg.justify, text: transformLabelText(text, transform) });
      }
    } else {
      const text = String(seg.text || "");
      if (text) resolved.push({ justify: seg.justify, text: transformLabelText(text, transform) });
    }
  }
  return resolved;
}

let copyFlashTimer = null;

function fallbackCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  } catch (_) {
    /* ignore */
  }
}

function flashCopied(span, original) {
  span.textContent = "Copied";
  clearTimeout(copyFlashTimer);
  copyFlashTimer = setTimeout(() => {
    span.textContent = original;
  }, 700);
}

function copySegmentText(span, text) {
  const done = () => flashCopied(span, text);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => {
      fallbackCopy(text);
      done();
    });
    return;
  }
  fallbackCopy(text);
  done();
}

function makeSegmentEl(text) {
  const span = document.createElement("span");
  span.className = "__cb_seg__";
  span.textContent = text;
  span.style.minWidth = "0";
  span.style.overflow = "hidden";
  span.style.textOverflow = "ellipsis";
  span.style.whiteSpace = "nowrap";
  // Only the text is clickable (to copy); the rest of the bar stays
  // click-through (pointer-events:none on the bar itself).
  span.style.pointerEvents = "auto";
  span.style.cursor = "pointer";
  span.title = "Click to copy";
  span.addEventListener("click", (event) => {
    event.stopPropagation();
    copySegmentText(span, text);
  });
  return span;
}

// Lay the resolved segments out inside the bar. left/center/right become three
// equal columns so the center stays truly centered and columns never overlap;
// segments sharing a column stack horizontally in list order.
function layoutSegments(bar, segments) {
  bar.style.justifyContent = "space-between";
  bar.style.gap = "0";
  const zones = { left: null, center: null, right: null };
  ["left", "center", "right"].forEach((name) => {
    const zone = document.createElement("div");
    zone.style.flex = "1 1 0";
    zone.style.minWidth = "0";
    zone.style.display = "flex";
    zone.style.alignItems = "center";
    zone.style.gap = "14px";
    zone.style.overflow = "hidden";
    zone.style.justifyContent =
      name === "left" ? "flex-start" : name === "right" ? "flex-end" : "center";
    bar.appendChild(zone);
    zones[name] = zone;
  });
  segments.forEach((s) => {
    const zone = zones[s.justify] || zones.center;
    zone.appendChild(makeSegmentEl(s.text));
  });
}

function applyRule(rule) {
  if (!rule) {
    removeBar();
    return;
  }

  const barHeightPx = getBarHeight(rule);
  const existing = document.getElementById(BAR_ID);
  if (existing) existing.remove();
  clearPageOffset();

  const bar = document.createElement("div");
  bar.id = BAR_ID;
  const style = rule.style || {};

  bar.style.position = "fixed";
  bar.style.top = "0";
  bar.style.left = "0";
  bar.style.right = "0";
  bar.style.height = `${barHeightPx}px`;
  bar.style.zIndex = "2147483647";
  bar.style.display = "flex";
  bar.style.alignItems = "center";
  bar.style.justifyContent = "center";
  bar.style.pointerEvents = "none";
  bar.style.background = parseColorWithOpacity(style.backgroundColor, style.backgroundOpacity);
  bar.style.color = parseColorWithOpacity(style.textColor, style.textOpacity);

  // Blur the page behind the bar — only meaningful when the bar is translucent.
  const opacity = Number(style.backgroundOpacity);
  const blurPx = Number(style.blur);
  if (Number.isFinite(blurPx) && blurPx > 0 && Number.isFinite(opacity) && opacity < 1) {
    bar.style.backdropFilter = `blur(${blurPx}px)`;
    bar.style.webkitBackdropFilter = `blur(${blurPx}px)`;
  }

  bar.style.fontFamily = style.fontFamily || "Arial, sans-serif";
  bar.style.fontWeight = style.fontWeight || "700";
  bar.style.fontStyle = style.fontStyle || "normal";
  bar.style.textTransform = "none";
  bar.style.lineHeight = "1";
  bar.style.boxSizing = "border-box";
  bar.style.padding = "0 12px";
  bar.style.borderBottom = "1px solid rgba(0, 0, 0, 0.15)";
  bar.style.textShadow = "0 1px 1px rgba(0, 0, 0, 0.2)";
  bar.style.whiteSpace = "nowrap";
  bar.style.overflow = "hidden";

  // Re-render this same rule once a pending Fleet lookup resolves.
  const segments = resolveSegments(rule, () => {
    if (appliedRule && appliedRule.id === rule.id) applyRule(rule);
  });
  layoutSegments(bar, segments);

  const root = document.documentElement || document.body;
  if (!root) return;

  root.appendChild(bar);
  // The bar always pushes page content down (and naturally overlays content as
  // the page scrolls under the fixed bar).
  ensurePageOffset(barHeightPx);

  appliedRule = rule;
  constrainTypography(bar, style, barHeightPx);
}

// ---- Tab indicator (favicon) --------------------------------------------
// Chrome extensions can't draw on the tab strip, so the only per-tab visual is
// the favicon. We composite a faded colored stripe onto the bottom of the real
// favicon — but only on BACKGROUND tabs, restoring the true icon on the active
// tab so the product UI you're looking at is never obscured.
const CB_FAVICON_ID = "__cb_favicon_link__";
let indicatorEnabled = false;
let indicatorScope = null; // { mode, ids } — which rules the indicator applies to
let indicatorColor = null; // rule color when a bar applies + in scope, else null
let faviconOriginalHref = null; // the page's real favicon, captured once
let faviconApplied = false;

function pageFaviconLink() {
  const links = [...document.querySelectorAll('link[rel~="icon" i]')];
  return links.find((l) => l.href) || null;
}

function ensureFaviconCaptured() {
  if (faviconOriginalHref !== null) return;
  const link = pageFaviconLink();
  faviconOriginalHref = link ? link.href : `${location.origin}/favicon.ico`;
}

function managedFaviconLink() {
  let link = pageFaviconLink();
  if (!link) {
    link = document.createElement("link");
    link.id = CB_FAVICON_ID;
    link.rel = "icon";
    (document.head || document.documentElement).appendChild(link);
  }
  return link;
}

function restoreFavicon() {
  if (!faviconApplied) return;
  const link = pageFaviconLink();
  if (link && faviconOriginalHref) link.href = faviconOriginalHref;
  faviconApplied = false;
}

// A solid rounded tile in the rule's color. Drawn from scratch (no page pixels),
// so it works on every site including cross-origin favicons, and it's synchronous.
function makeSolidTileDataUrl(color) {
  const size = 32;
  const radius = Math.round(size * 0.22);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, radius);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, size, size);
  }
  return canvas.toDataURL("image/png");
}

function updateTabIndicator() {
  // Wait until the head is parsed so we capture the site's real favicon.
  if (document.readyState === "loading") return;

  const shouldShow = indicatorEnabled && indicatorColor && document.hidden;
  if (!shouldShow) {
    restoreFavicon();
    return;
  }

  ensureFaviconCaptured();
  managedFaviconLink().href = makeSolidTileDataUrl(indicatorColor);
  faviconApplied = true;
}

function setIndicator(color) {
  indicatorColor = color || null;
  updateTabIndicator();
}

// ---- Tab title ----------------------------------------------------------
function setDocTitle(value) {
  document.title = value;
  // Read the value back: the document.title getter strips/collapses whitespace,
  // so storing the raw string would defeat the loop guard (our own write would
  // look like an external change and poison realPageTitle). Store what the
  // getter actually returns so the guard in watchTitle() always matches.
  cbManagedTitle = document.title;
}

function applyTabTitle() {
  if (!tabTitleManages(tabTitleCfg)) {
    // Not managing (or no longer): restore the real title if we changed it.
    if (cbManagedTitle !== null) {
      setDocTitle(realPageTitle);
      cbManagedTitle = null;
    }
    return;
  }
  // No real title captured yet (e.g. at document_start before <title> parses).
  // Applying now would emit a degenerate title (e.g. a bare "#123"); wait for
  // the real title — the title observer and nav-end capture will re-apply.
  if (!String(realPageTitle).trim()) return;
  const focused = !document.hidden;
  const issueNum = tabTitleCfg.github ? githubIssueNumber(location.href) : null;
  const next = composeTabTitle(realPageTitle, tabTitleCfg, focused, issueNum);
  if (document.title !== next) setDocTitle(next);
}

function setTabTitle(cfg) {
  tabTitleCfg = tabTitleManages(cfg) ? cfg : null;
  applyTabTitle();
}

document.addEventListener("visibilitychange", () => {
  updateTabIndicator();
  applyTabTitle();
});

// Watch the page's own <title> changes (SPAs update it without navigating):
// track the real title, refresh the bar (Page Title segment), and re-apply our
// tab-title override. Our own writes are ignored via the cbManagedTitle guard.
let titleObserver = null;
// React-based sites (GitHub included) don't mutate the <title> text — they swap
// out the whole <title> element during hydration. Watching the element itself
// would leave us observing a detached node (the title reverts and only re-applies
// on focus). Observing <head> survives the swap: adding a new <title> child fires
// childList, and later text edits fire characterData.
function onTitleMaybeChanged() {
  if (document.title === cbManagedTitle) return; // our own write (normalized read-back)
  realPageTitle = document.title;
  if (appliedRule) applyRule(appliedRule);
  applyTabTitle();
}
function watchTitle() {
  const head = document.head || document.querySelector("head");
  if (!head) return false;
  // Capture the current real title now. On a full page load the <title> is
  // parsed before we can connect, so the observer (which only fires on future
  // changes) would otherwise never see it and realPageTitle would stay "".
  onTitleMaybeChanged();
  titleObserver = new MutationObserver(onTitleMaybeChanged);
  titleObserver.observe(head, { childList: true, characterData: true, subtree: true });
  return true;
}
if (!watchTitle()) {
  document.addEventListener("DOMContentLoaded", watchTitle, { once: true });
}

// ---- Element (sticky-header) segments -----------------------------------
function readElementText(selector) {
  if (!selector) return "";
  try {
    const el = document.querySelector(selector);
    return el ? (el.textContent || "").trim() : "";
  } catch (_) {
    return ""; // invalid selector
  }
}

function elementSegmentsSignature(rule) {
  let sig = "";
  for (const seg of (rule && rule.segments) || []) {
    if (seg.enabled && seg.type === "element") sig += "" + readElementText(seg.selector);
  }
  return sig;
}

// Element text is rendered by the site (often after load / on SPA nav), so watch
// the body for changes and re-apply when a watched element's text changes. Only
// active while the matched rule has an enabled element segment; observing <body>
// (our bar lives on <html>) avoids reacting to our own DOM writes.
let elementObserver = null;
let elementDebounce = null;
let lastElementSig = "";
function ensureElementObserver(active) {
  if (active) {
    if (elementObserver || !document.body) return;
    elementObserver = new MutationObserver(() => {
      clearTimeout(elementDebounce);
      elementDebounce = setTimeout(() => {
        if (!appliedRule) return;
        const sig = elementSegmentsSignature(appliedRule);
        if (sig !== lastElementSig) {
          lastElementSig = sig;
          applyRule(appliedRule);
        }
      }, 300);
    });
    elementObserver.observe(document.body, { childList: true, characterData: true, subtree: true });
  } else if (elementObserver) {
    elementObserver.disconnect();
    elementObserver = null;
  }
}

function evaluateAndApply(rules) {
  const normalized = normalizeRules(rules);
  const matched = findMatchingRule(normalized, window.location.href);
  applyRule(matched);
  const inScope = matched && tabIndicatorApplies(indicatorScope, matched.id);
  setIndicator(inScope && matched.style ? matched.style.backgroundColor : null);
  setTabTitle(matched ? matched.tabTitle : null);

  const hasElementSeg = !!(matched && matched.segments.some((s) => s.enabled && s.type === "element"));
  lastElementSig = matched ? elementSegmentsSignature(matched) : "";
  ensureElementObserver(hasElementSeg);
}

let snoozeTimer = null;

function suppress() {
  // No bar on this tab → also drop the tab indicator and any title override.
  removeBar();
  setIndicator(null);
  setTabTitle(null);
}

// When the extension is reloaded/updated/disabled, an already-injected content
// script becomes orphaned and its chrome.* calls throw "Extension context
// invalidated". Detect that and stop our timers/observers so we fail silently
// (a fresh content script runs on the next full page load).
let contentTornDown = false;
let urlPollId = null;

function extensionValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (_) {
    return false;
  }
}

function teardownContent() {
  if (contentTornDown) return;
  contentTornDown = true;
  clearTimeout(snoozeTimer);
  clearTimeout(elementDebounce);
  if (urlPollId) clearInterval(urlPollId);
  if (elementObserver) {
    try { elementObserver.disconnect(); } catch (_) {}
    elementObserver = null;
  }
  if (titleObserver) {
    try { titleObserver.disconnect(); } catch (_) {}
    titleObserver = null;
  }
}

function loadAndApply() {
  if (!extensionValid()) {
    teardownContent();
    return;
  }
  try {
    cbStore.get(
      [STORAGE_KEY, GLOBAL_KEY, SNOOZE_KEY, TAB_INDICATOR_KEY, TAB_SCOPE_KEY],
      (items) => {
        if (chrome.runtime && chrome.runtime.lastError) return; // context went away mid-call
      if (snoozeTimer) {
        clearTimeout(snoozeTimer);
        snoozeTimer = null;
      }
      indicatorEnabled = items[TAB_INDICATOR_KEY] === true;
      indicatorScope = items[TAB_SCOPE_KEY] || null;

      // Master off-switch.
      if (items[GLOBAL_KEY] === false) {
        suppress();
        return;
      }

      // Timed snooze: hide now, and re-evaluate when it expires (this tab only).
      const snoozeUntil = Number(items[SNOOZE_KEY]) || 0;
      const remaining = snoozeUntil - Date.now();
      if (remaining > 0) {
        suppress();
        snoozeTimer = setTimeout(loadAndApply, Math.min(remaining, 2147483647));
        return;
      }

        evaluateAndApply(items[STORAGE_KEY]);
      }
    );
  } catch (_) {
    teardownContent(); // context invalidated
  }
}

// Re-evaluate on soft (SPA) navigations so the bar and tab indicator follow the
// rule for the new URL without a full reload.
let cbLastHref = location.href;
function onMaybeUrlChange() {
  if (location.href === cbLastHref) return;
  cbLastHref = location.href;
  faviconOriginalHref = null; // the new page may have its own favicon
  if (document.title !== cbManagedTitle) realPageTitle = document.title; // capture real title at nav
  loadAndApply();
}
window.addEventListener("popstate", onMaybeUrlChange);
window.addEventListener("hashchange", onMaybeUrlChange);
if (window.navigation && typeof window.navigation.addEventListener === "function") {
  window.navigation.addEventListener("navigate", () => setTimeout(onMaybeUrlChange, 0));
} else {
  urlPollId = setInterval(onMaybeUrlChange, 1000);
}

loadAndApply();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadAndApply, { once: true });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    changes[STORAGE_KEY] ||
    changes[GLOBAL_KEY] ||
    changes[SNOOZE_KEY] ||
    changes[TAB_INDICATOR_KEY] ||
    changes[TAB_SCOPE_KEY]
  ) {
    loadAndApply();
  }
});

window.addEventListener("resize", () => {
  const bar = document.getElementById(BAR_ID);
  if (!bar || !appliedRule) return;
  constrainTypography(bar, appliedRule.style || {}, getBarHeight(appliedRule));
});
