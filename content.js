const BAR_ID = "__domain_top_bar__";
const HTML_PADDING_ATTR = "data-domain-top-bar-prev-padding-top";

let appliedRule = null;
const textMeasurer = document.createElement("canvas").getContext("2d");

// Per-origin cache of Fleet /version lookups so each tab fetches at most once
// per distinct token. state: "pending" | "ready" | "none".
const fleetCache = new Map();

function fleetCacheKey(token) {
  return `${location.origin}::${token || ""}`;
}

async function fetchFleetInfo(token) {
  // With a token, try the authenticated API first (works even when the public
  // endpoint is blocked), then fall back to the unauthenticated /version.
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const urls = token
    ? [`${location.origin}/api/latest/fleet/version`, `${location.origin}/version`]
    : [`${location.origin}/version`];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, credentials: "omit", cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (isFleetVersionInfo(data)) return data;
    } catch (_) {
      // Network error / non-JSON: treat as "not a Fleet server here" and move on.
    }
  }
  return null;
}

// Returns the cache entry for this token, kicking off a one-time fetch when the
// origin has not been probed yet. onReady runs once the lookup resolves so the
// caller can re-render with the now-known server info.
function getFleetInfo(token, onReady) {
  const key = fleetCacheKey(token);
  const cached = fleetCache.get(key);
  if (cached) return cached;

  const entry = { state: "pending", info: null };
  fleetCache.set(key, entry);
  fetchFleetInfo(token).then((info) => {
    fleetCache.set(key, { state: info ? "ready" : "none", info });
    if (typeof onReady === "function") onReady();
  });
  return entry;
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
      const entry = getFleetInfo(seg.token, onFleetReady);
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
    } else {
      const text = String(seg.text || "");
      if (text) resolved.push({ justify: seg.justify, text: transformLabelText(text, transform) });
    }
  }
  return resolved;
}

function makeSegmentEl(text) {
  const span = document.createElement("span");
  span.className = "__cb_seg__";
  span.textContent = text;
  span.style.minWidth = "0";
  span.style.overflow = "hidden";
  span.style.textOverflow = "ellipsis";
  span.style.whiteSpace = "nowrap";
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

function evaluateAndApply(rules) {
  const normalized = normalizeRules(rules);
  const matched = findMatchingRule(normalized, window.location.href);
  applyRule(matched);
}

let snoozeTimer = null;

function loadAndApply() {
  chrome.storage.sync.get(
    [STORAGE_KEY, GLOBAL_KEY, BLOCKLIST_KEY, SNOOZE_KEY],
    (items) => {
      if (snoozeTimer) {
        clearTimeout(snoozeTimer);
        snoozeTimer = null;
      }

      // Master off-switch.
      if (items[GLOBAL_KEY] === false) {
        removeBar();
        return;
      }

      // Timed snooze: hide now, and re-evaluate when it expires (this tab only).
      const snoozeUntil = Number(items[SNOOZE_KEY]) || 0;
      const remaining = snoozeUntil - Date.now();
      if (remaining > 0) {
        removeBar();
        snoozeTimer = setTimeout(loadAndApply, Math.min(remaining, 2147483647));
        return;
      }

      // Domain blocklist.
      const url = buildUrlForMatching(window.location.href);
      if (url && isHostBlocked(items[BLOCKLIST_KEY], url.hostname)) {
        removeBar();
        return;
      }

      evaluateAndApply(items[STORAGE_KEY]);
    }
  );
}

loadAndApply();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadAndApply, { once: true });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes[STORAGE_KEY] || changes[GLOBAL_KEY] || changes[BLOCKLIST_KEY] || changes[SNOOZE_KEY]) {
    loadAndApply();
  }
});

window.addEventListener("resize", () => {
  const bar = document.getElementById(BAR_ID);
  if (!bar || !appliedRule) return;
  constrainTypography(bar, appliedRule.style || {}, getBarHeight(appliedRule));
});
