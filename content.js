const BAR_ID = "__domain_top_bar__";
const HTML_PADDING_ATTR = "data-domain-top-bar-prev-padding-top";

let appliedRule = null;
const textMeasurer = document.createElement("canvas").getContext("2d");

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

function applyRule(rule) {
  if (!rule) {
    removeBar();
    return;
  }

  const barHeightPx = getBarHeight(rule);
  const layoutMode = rule.layoutMode === "overlay" ? "overlay" : "push";
  const existing = document.getElementById(BAR_ID);
  if (existing) existing.remove();
  clearPageOffset();

  const bar = document.createElement("div");
  bar.id = BAR_ID;
  const style = rule.style || {};
  const textTransform = style.textTransform || "none";

  bar.textContent = transformLabelText(style.text ?? "", textTransform);
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
  bar.style.color = style.textColor || "#ffffff";
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
  bar.style.textOverflow = "ellipsis";

  const root = document.documentElement || document.body;
  if (!root) return;

  root.appendChild(bar);
  if (layoutMode === "push") {
    ensurePageOffset(barHeightPx);
  }

  appliedRule = rule;
  constrainTypography(bar, style, barHeightPx);
}

function evaluateAndApply(rules) {
  const normalized = normalizeRules(rules);
  const matched = findMatchingRule(normalized, window.location.href);
  applyRule(matched);
}

function loadAndApply() {
  chrome.storage.sync.get([STORAGE_KEY], (items) => {
    evaluateAndApply(items[STORAGE_KEY]);
  });
}

loadAndApply();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadAndApply, { once: true });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes[STORAGE_KEY]) return;
  evaluateAndApply(changes[STORAGE_KEY].newValue);
});

window.addEventListener("resize", () => {
  const bar = document.getElementById(BAR_ID);
  if (!bar || !appliedRule) return;
  constrainTypography(bar, appliedRule.style || {}, getBarHeight(appliedRule));
});
