// Placement options shared by every bar segment. Segments sharing a placement
// stack horizontally in list order; the order can be changed by dragging.
const JUSTIFY_VALUES = ["left", "center", "right"];

// A plain text segment. The Bar Appearance "Text" of older rules migrates into
// one of these.
const DEFAULT_TEXT_SEGMENT = {
  id: "",
  type: "text",
  enabled: true,
  label: "Text",
  text: "",
  justify: "center"
};

// A dynamic segment that shows the version/branch of the Fleet server the tab
// is pointed at. {version}, {branch}, {revision}, {go_version}, {build_date}
// and {build_user} placeholders are substituted from the server's /version
// response (or the authenticated API when a token is supplied).
const DEFAULT_FLEET_SEGMENT = {
  id: "",
  type: "fleet",
  enabled: false,
  label: "Fleet server",
  template: "Fleet {version} · {branch}",
  token: "",
  justify: "right"
};

// A dynamic segment that shows the current tab's browser name and version, read
// from the user agent. {browser}, {version} and {major} placeholders.
const DEFAULT_BROWSER_SEGMENT = {
  id: "",
  type: "browser",
  enabled: false,
  label: "Browser",
  template: "{browser} {version}",
  justify: "right"
};

const DEFAULT_RULE = {
  id: "",
  enabled: true,
  label: "New Rule",
  matchType: "domain",
  domainPattern: "*.example.com/*",
  assumeWildcards: true,
  scheme: "any",
  hostPrefixMode: "any",
  hostPrefixValue: "",
  hostPattern: "*.example.com",
  pathPattern: "/*",
  portMode: "any",
  portValue: "",
  queryMode: "any",
  queryKey: "",
  queryValue: "",
  barHeight: "28",
  layoutMode: "push",
  style: {
    backgroundColor: "#ff7a18",
    backgroundOpacity: "0.9",
    blur: "0",
    textColor: "#ffffff",
    textOpacity: "1",
    fontFamily: "Arial, sans-serif",
    fontSize: "14",
    fontWeight: "700",
    fontStyle: "normal",
    textTransform: "uppercase",
    letterSpacing: "0.6"
  },
  segments: [{ ...DEFAULT_TEXT_SEGMENT }]
};

const STORAGE_KEY = "domainTopBarRulesV1";
const THEME_KEY = "colorbarsThemeV1";
const SWATCHES_KEY = "colorbarsSwatchesV1";
const MOCKUP_KEY = "colorbarsShowMockupV1";
const GLOBAL_KEY = "colorbarsGlobalEnabledV1";
const STASH_KEY = "colorbarsPrevEnabledV1";
const DEFAULTSTYLE_KEY = "colorbarsDefaultRuleV1";
const BLOCKLIST_KEY = "colorbarsBlocklistV1";
const SNOOZE_KEY = "colorbarsSnoozeUntilV1";
// Transient hand-off: the popup sets this to a rule id so the options page can
// open expanded and scrolled to that rule, then clears it.
const FOCUS_KEY = "colorbarsFocusRuleV1";

const THEME_VALUES = ["auto", "light", "dark"];

// Default saved swatches, shared by the settings picker and the popup.
const DEFAULT_SWATCHES = [
  "#d62828",
  "#ff7a18",
  "#fcbf49",
  "#2a9d8f",
  "#1a73e8",
  "#6f42c1",
  "#202124",
  "#ffffff"
];

// ---- Global enable/disable with non-destructive memory -------------------
// A "state" here is { rules, globalEnabled, stash } where stash maps rule id ->
// the enabled value it had before a global disable, so it can be restored.

function restoreFromStash(state) {
  const stash = state.stash && typeof state.stash === "object" ? state.stash : {};
  state.rules.forEach((rule) => {
    rule.enabled = rule.id in stash ? Boolean(stash[rule.id]) : true;
  });
  state.stash = {};
}

function setGlobalEnabled(state, on) {
  on = Boolean(on);
  if (on === state.globalEnabled) return state;
  if (!on) {
    // Stash current per-rule states, then flip every rule off so each rule's
    // switch reflects the global disable.
    const stash = {};
    state.rules.forEach((rule) => {
      stash[rule.id] = Boolean(rule.enabled);
      rule.enabled = false;
    });
    state.stash = stash;
    state.globalEnabled = false;
  } else {
    restoreFromStash(state);
    state.globalEnabled = true;
  }
  return state;
}

function setRuleEnabled(state, ruleId, enabled) {
  enabled = Boolean(enabled);
  const rule = state.rules.find((r) => r.id === ruleId);
  if (!rule) return state;
  if (enabled && !state.globalEnabled) {
    // Enabling any rule lifts a global disable: restore the others to their
    // prior states and keep this one on.
    restoreFromStash(state);
    state.globalEnabled = true;
    rule.enabled = true;
  } else {
    rule.enabled = enabled;
  }
  return state;
}

// ---- Default style for new rules -----------------------------------------
function normalizeDefaults(raw) {
  const base = {
    barHeight: DEFAULT_RULE.barHeight,
    layoutMode: DEFAULT_RULE.layoutMode,
    style: structuredClone(DEFAULT_RULE.style)
  };
  if (raw && typeof raw === "object") {
    if (raw.barHeight) base.barHeight = String(raw.barHeight);
    if (["push", "overlay"].includes(raw.layoutMode)) base.layoutMode = raw.layoutMode;
    if (raw.style && typeof raw.style === "object") {
      base.style = { ...base.style, ...raw.style };
      delete base.style.text;
    }
  }
  return base;
}

// ---- Domain blocklist -----------------------------------------------------
function isHostBlocked(blocklist, hostname) {
  if (!Array.isArray(blocklist)) return false;
  const host = String(hostname || "").toLowerCase();
  if (!host) return false;
  for (const raw of blocklist) {
    const entry = String(raw || "").trim().toLowerCase();
    if (!entry) continue;
    if (entry.includes("*")) {
      if (wildcardToRegExp(entry).test(host)) return true;
    } else if (host === entry || host.endsWith(`.${entry}`)) {
      return true;
    }
  }
  return false;
}

function defaultSegmentForType(type) {
  if (type === "fleet") return structuredClone(DEFAULT_FLEET_SEGMENT);
  if (type === "browser") return structuredClone(DEFAULT_BROWSER_SEGMENT);
  return structuredClone(DEFAULT_TEXT_SEGMENT);
}

function normalizeSegment(rawSegment, ruleIndex, segmentIndex) {
  const raw = rawSegment && typeof rawSegment === "object" ? rawSegment : {};
  const type = raw.type === "fleet" ? "fleet" : raw.type === "browser" ? "browser" : "text";
  const merged = { ...defaultSegmentForType(type), ...raw, type };
  if (!merged.id) merged.id = `seg-${Date.now()}-${ruleIndex}-${segmentIndex}`;
  merged.enabled = Boolean(merged.enabled);
  merged.justify = JUSTIFY_VALUES.includes(merged.justify) ? merged.justify : "center";
  const fallbackLabel = type === "fleet" ? "Fleet server" : type === "browser" ? "Browser" : "Text";
  merged.label = String(merged.label || fallbackLabel);
  if (type === "fleet") {
    merged.template = String(merged.template || DEFAULT_FLEET_SEGMENT.template);
    merged.token = String(merged.token || "");
    delete merged.text;
  } else if (type === "browser") {
    merged.template = String(merged.template || DEFAULT_BROWSER_SEGMENT.template);
    delete merged.text;
    delete merged.token;
  } else {
    merged.text = String(merged.text ?? "");
    delete merged.template;
    delete merged.token;
  }
  return merged;
}

// Build the segments list for a rule, migrating legacy rules that only had a
// single style.text value into one text segment.
function normalizeSegments(rule, ruleIndex) {
  let source = Array.isArray(rule && rule.segments) ? rule.segments : null;
  if (!source) {
    const legacyText = rule && rule.style ? rule.style.text : "";
    source = [{ ...DEFAULT_TEXT_SEGMENT, text: legacyText || "" }];
  }
  const normalized = source.map((segment, i) => normalizeSegment(segment, ruleIndex, i));
  return normalized.length > 0 ? normalized : [structuredClone(DEFAULT_TEXT_SEGMENT)];
}

function normalizeRules(rawRules) {
  if (!Array.isArray(rawRules)) return [];
  return rawRules.map((rule, index) => {
    const merged = {
      ...structuredClone(DEFAULT_RULE),
      ...rule,
      style: {
        ...structuredClone(DEFAULT_RULE.style),
        ...(rule && rule.style ? rule.style : {})
      }
    };
    delete merged.style.text; // legacy single-text field now lives in segments
    merged.segments = normalizeSegments(rule, index);
    if (!merged.id) merged.id = `rule-${Date.now()}-${index}`;
    merged.enabled = Boolean(merged.enabled);
    merged.matchType = merged.matchType === "components" ? "components" : "domain";
    merged.assumeWildcards = merged.assumeWildcards !== false;
    merged.scheme = ["any", "http", "https", "ftp", "vnc"].includes(merged.scheme)
      ? merged.scheme
      : "any";
    merged.hostPrefixMode = ["any", "specific"].includes(merged.hostPrefixMode)
      ? merged.hostPrefixMode
      : "any";
    merged.portMode = ["any", "specific", "none"].includes(merged.portMode)
      ? merged.portMode
      : "any";
    merged.queryMode = ["any", "specific", "containsKey", "containsPair"].includes(merged.queryMode)
      ? merged.queryMode
      : "any";
    merged.layoutMode = ["push", "overlay"].includes(merged.layoutMode) ? merged.layoutMode : "push";
    const barHeightNumber = Number(merged.barHeight);
    const safeBarHeight = Number.isFinite(barHeightNumber)
      ? Math.min(Math.max(Math.round(barHeightNumber), 16), 120)
      : Number(DEFAULT_RULE.barHeight);
    merged.barHeight = String(safeBarHeight);
    return merged;
  });
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function parseColorWithOpacity(hex, opacity) {
  const clean = (hex || "").trim();
  const alpha = Number(opacity);
  if (!/^#([A-Fa-f0-9]{6})$/.test(clean)) {
    return `rgba(0, 0, 0, ${Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1})`;
  }
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  const safeAlpha = Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1;
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

// A /version (or authenticated API) response is considered a Fleet server when
// it carries the well-known fields the Fleet version handler emits.
function isFleetVersionInfo(info) {
  if (!info || typeof info !== "object") return false;
  return (
    typeof info.version === "string" &&
    typeof info.branch === "string" &&
    typeof info.revision === "string" &&
    typeof info.go_version === "string"
  );
}

// Substitute {version}/{branch}/etc. placeholders in a fleet segment template.
function formatFleetTemplate(template, info) {
  const tpl = String(template || DEFAULT_FLEET_SEGMENT.template);
  const safe = info && typeof info === "object" ? info : {};
  return tpl.replace(/\{(version|branch|revision|go_version|build_date|build_user)\}/g, (_, key) => {
    const value = safe[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

// Identify the browser + version from a user-agent string. Chromium-based
// browsers that embed "Chrome/..." are matched first so they don't fall through
// to the generic Chrome case.
function parseBrowserInfo(userAgent) {
  const ua = String(userAgent || "");
  const tests = [
    { name: "Microsoft Edge", re: /Edg(?:e|A|iOS)?\/([\d.]+)/ },
    { name: "Opera", re: /OPR\/([\d.]+)/ },
    { name: "Vivaldi", re: /Vivaldi\/([\d.]+)/ },
    { name: "Samsung Internet", re: /SamsungBrowser\/([\d.]+)/ },
    { name: "Firefox", re: /(?:Firefox|FxiOS)\/([\d.]+)/ },
    { name: "Chrome", re: /(?:Chrome|CriOS)\/([\d.]+)/ },
    { name: "Safari", re: /Version\/([\d.]+).*Safari/ }
  ];
  for (const t of tests) {
    const m = ua.match(t.re);
    if (m) {
      const version = m[1];
      return { browser: t.name, version, major: version.split(".")[0] };
    }
  }
  return { browser: "Browser", version: "", major: "" };
}

// Substitute {browser}/{version}/{major}/{platform}/{arch} placeholders in a
// browser segment. Whitespace is collapsed so an empty placeholder (e.g. {arch}
// on a browser that doesn't report it) doesn't leave gaps.
function formatBrowserTemplate(template, info) {
  const tpl = String(template || DEFAULT_BROWSER_SEGMENT.template);
  const safe = info && typeof info === "object" ? info : {};
  return tpl
    .replace(/\{(browser|version|major|platform|arch)\}/g, (_, key) => {
      const value = safe[key];
      return value === undefined || value === null ? "" : String(value);
    })
    .replace(/\s+/g, " ")
    .trim();
}

// Normalize architecture + bitness (from UA Client Hints) to a familiar label.
function browserArchLabel(architecture, bitness) {
  const a = String(architecture || "");
  const b = String(bitness || "");
  if (!a) return "";
  if (a === "arm" && b === "64") return "arm64";
  if (a === "x86" && b === "64") return "x86_64";
  if (a === "x86" && b === "32") return "x86";
  return b ? `${a}${b}` : a;
}

// Merge high-entropy UA Client Hints into a base browser info object: upgrade to
// the full version (UA strings are frozen to X.0.0.0), and add platform + arch.
function mergeBrowserHighEntropy(base, he) {
  const info = { ...base };
  if (!he || typeof he !== "object") return info;

  const list = Array.isArray(he.fullVersionList) ? he.fullVersionList : [];
  const real = list.filter((b) => b && b.brand && !/not.*brand/i.test(b.brand));
  const name = String(base.browser || "").split(" ")[0].toLowerCase();
  const pick =
    real.find((b) => name && b.brand.toLowerCase().includes(name)) ||
    real.find((b) => !/chromium/i.test(b.brand)) ||
    real[0];
  if (pick && pick.version) {
    info.version = pick.version;
    info.major = pick.version.split(".")[0];
  }
  if (he.platform) info.platform = String(he.platform);
  info.arch = browserArchLabel(he.architecture, he.bitness);
  return info;
}

function buildUrlForMatching(href) {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

// Build a Domain-Pattern string for a "create rule from this page" action.
// wholeSite=true  -> this exact host, any scheme, any path  (*://host/*)
// wholeSite=false -> only this page's path (protocol//host/path*, allowing query)
// The returned pattern is explicit, so rules using it set assumeWildcards=false.
function patternForUrl(href, wholeSite) {
  const url = buildUrlForMatching(href);
  if (!url || !url.hostname) return null;
  if (wholeSite) return `*://${url.hostname}/*`;
  return `${url.protocol}//${url.hostname}${url.pathname}*`;
}

// True when the extension can add a bar to this URL (content scripts don't run
// on browser-internal pages).
function isSupportedPageUrl(href) {
  const url = buildUrlForMatching(href);
  if (!url) return false;
  return ["http:", "https:", "ftp:", "file:"].includes(url.protocol);
}

function normalizeDomainPattern(rawPattern, assumeWildcards = true) {
  const pattern = (rawPattern || "").trim();
  if (!pattern) return "";

  if (!assumeWildcards) {
    return pattern;
  }

  const hasScheme = /^([a-zA-Z*][a-zA-Z0-9+.-]*):\/\//.test(pattern);
  const normalized = hasScheme ? pattern : `*://${pattern}`;

  const schemeSplit = normalized.split("://");
  if (schemeSplit.length < 2) {
    return normalized;
  }

  const scheme = schemeSplit[0];
  let rest = schemeSplit.slice(1).join("://");
  const firstDelimiterIndex = rest.search(/[/?#]/);
  let hostPort = firstDelimiterIndex >= 0 ? rest.slice(0, firstDelimiterIndex) : rest;
  let suffix = firstDelimiterIndex >= 0 ? rest.slice(firstDelimiterIndex) : "";

  if (!hasScheme && hostPort && !hostPort.startsWith("*")) {
    hostPort = `*.${hostPort}`;
  }

  if (!suffix) {
    suffix = "/*";
  } else {
    if (suffix.startsWith("?") || suffix.startsWith("#")) {
      suffix = `/*${suffix}`;
    }
    if (!suffix.endsWith("*")) {
      suffix = `${suffix}*`;
    }
  }

  rest = `${hostPort}${suffix}`;
  return `${scheme}://${rest}`;
}

function matchDomainRule(rule, url) {
  const normalized = normalizeDomainPattern(rule.domainPattern, rule.assumeWildcards !== false);
  if (!normalized) return false;
  const hasScheme = /^([a-zA-Z*][a-zA-Z0-9+.-]*):\/\//.test(normalized);
  if (hasScheme) {
    return wildcardToRegExp(normalized).test(url.href);
  }
  const hostRelativeHref = `${url.host}${url.pathname}${url.search}${url.hash}`;
  return wildcardToRegExp(normalized).test(hostRelativeHref);
}

function hostPrefixMatches(mode, value, host) {
  if (mode === "any") return true;
  if (mode !== "specific") return false;
  return host.startsWith((value || "").toLowerCase());
}

function matchComponentRule(rule, url) {
  const scheme = rule.scheme || "any";
  if (scheme !== "any" && url.protocol !== `${scheme}:`) return false;

  const hostPattern = (rule.hostPattern || "").trim();
  if (!hostPattern) return false;
  const host = url.hostname.toLowerCase();
  if (!wildcardToRegExp(hostPattern.toLowerCase()).test(host)) return false;

  if (!hostPrefixMatches(rule.hostPrefixMode, rule.hostPrefixValue, host)) return false;

  const pathPattern = (rule.pathPattern || "").trim() || "/*";
  if (!wildcardToRegExp(pathPattern).test(url.pathname)) return false;

  if (rule.portMode === "specific" && url.port !== String(rule.portValue || "").trim()) return false;
  if (rule.portMode === "none" && Boolean(url.port)) return false;

  const queryMode = rule.queryMode || "any";
  if (queryMode === "specific") {
    const queryString = url.search.replace(/^\?/, "");
    const target = (rule.queryValue || "").trim().replace(/^\?/, "");
    if (!target || queryString !== target) return false;
  } else if (queryMode === "containsKey") {
    const key = (rule.queryKey || "").trim();
    if (!key || !url.searchParams.has(key)) return false;
  } else if (queryMode === "containsPair") {
    const key = (rule.queryKey || "").trim();
    const value = (rule.queryValue || "").trim();
    if (!key || !url.searchParams.has(key)) return false;
    if (!url.searchParams.getAll(key).includes(value)) return false;
  }

  return true;
}

function componentPriority(rule) {
  // URL order: scheme -> host -> path -> port -> query.
  if ((rule.scheme || "any") !== "any") return 0;

  const hostPattern = (rule.hostPattern || "").trim();
  if (hostPattern && hostPattern !== "*") return 1;

  if ((rule.hostPrefixMode || "any") === "specific" && (rule.hostPrefixValue || "").trim()) return 1;

  const pathPattern = (rule.pathPattern || "").trim() || "/*";
  if (pathPattern !== "/*") return 2;

  if ((rule.portMode || "any") !== "any") return 3;

  if ((rule.queryMode || "any") !== "any") return 4;

  return 5;
}

function findMatchingRule(rules, href, includeDisabled = false) {
  const url = buildUrlForMatching(href);
  if (!url) return null;

  const matches = [];
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (!includeDisabled && !rule.enabled) continue;

    if (rule.matchType === "domain") {
      if (matchDomainRule(rule, url)) {
        matches.push({ rule, order: i, priority: 1 });
      }
    } else if (matchComponentRule(rule, url)) {
      matches.push({ rule, order: i, priority: componentPriority(rule) });
    }
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.order - b.order;
  });
  return matches[0].rule;
}
