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

// A dynamic segment that shows the page's title (document.title), handy when a
// site's own sticky header/title is obscured by the bar. {title} placeholder.
const DEFAULT_PAGETITLE_SEGMENT = {
  id: "",
  type: "pagetitle",
  enabled: false,
  label: "Page title",
  template: "{title}",
  justify: "left"
};

// A dynamic segment that shows the logged-in Fleet user's role, read from the
// Fleet server's authenticated /me endpoint (session cookie). {role} placeholder.
const DEFAULT_FLEETROLE_SEGMENT = {
  id: "",
  type: "fleetrole",
  enabled: false,
  label: "Fleet role",
  template: "{role}",
  justify: "right"
};

// A dynamic segment that shows the text of a page element matched by a CSS
// selector — e.g. a site's sticky-header title. Default targets GitHub's sticky
// issue/PR title; editable for other sites. {text} placeholder.
const DEFAULT_ELEMENT_SEGMENT = {
  id: "",
  type: "element",
  enabled: false,
  label: "Sticky header",
  selector: '[class*="StickyHeaderTitle-module__stickyTitleLink"]',
  template: "{text}",
  justify: "left"
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
  segments: [{ ...DEFAULT_TEXT_SEGMENT }],
  // Optional per-rule tab (document.title) renaming.
  // mode: off | prepend | append | overwrite. prepend/append revert to the real
  // title when the tab is focused; overwrite persists. github prepends
  // "#<issue> " on GitHub issue/PR pages and persists on focus.
  tabTitle: { mode: "off", text: "", github: false }
};

const TAB_TITLE_MODES = ["off", "prepend", "append", "overwrite"];

function normalizeTabTitle(raw) {
  const t = raw && typeof raw === "object" ? raw : {};
  return {
    mode: TAB_TITLE_MODES.includes(t.mode) ? t.mode : "off",
    text: String(t.text || ""),
    github: Boolean(t.github)
  };
}

const STORAGE_KEY = "domainTopBarRulesV1";
const THEME_KEY = "colorbarsThemeV1";
const SWATCHES_KEY = "colorbarsSwatchesV1";
const GLOBAL_KEY = "colorbarsGlobalEnabledV1";
const STASH_KEY = "colorbarsPrevEnabledV1";
const DEFAULTSTYLE_KEY = "colorbarsDefaultRuleV1";
const SNOOZE_KEY = "colorbarsSnoozeUntilV1";
// Transient hand-off: the popup sets this to a rule id so the options page can
// open expanded and scrolled to that rule, then clears it.
const FOCUS_KEY = "colorbarsFocusRuleV1";
// Global toggle: show the rule's color as a favicon indicator on background tabs.
const TAB_INDICATOR_KEY = "colorbarsTabIndicatorV1";
// Which rules the tab indicator applies to: { mode: "all" | "selected", ids: [] }.
const TAB_SCOPE_KEY = "colorbarsTabIndicatorScopeV1";

// Storage lives in chrome.storage.local, not sync: sync has an 8KB-per-item cap
// (QUOTA_BYTES_PER_ITEM) that the rules array can exceed, which made writes fail
// with "kQuotaBytesPerItem quota exceeded". local has a multi-MB budget and no
// per-item cap. cbStore mirrors the chrome.storage.sync API (get/set/remove) and
// performs a one-time migration of any pre-existing sync data into local.
const CB_MIGRATION_FLAG = "cbStorageMigratedV1";
const cbStore = {
  _migrated: false,
  _ensure(done) {
    if (this._migrated) return done();
    const self = this;
    try {
      chrome.storage.local.get(CB_MIGRATION_FLAG, (local) => {
        if (!chrome.runtime.lastError && local && local[CB_MIGRATION_FLAG]) {
          self._migrated = true;
          return done();
        }
        // Copy everything currently in sync into local, then mark migrated.
        chrome.storage.sync.get(null, (sync) => {
          const payload = Object.assign({}, chrome.runtime.lastError ? {} : sync, {
            [CB_MIGRATION_FLAG]: true
          });
          chrome.storage.local.set(payload, () => {
            self._migrated = true;
            done();
          });
        });
      });
    } catch (_) {
      // No chrome.storage (shouldn't happen in extension contexts): fail open.
      done();
    }
  },
  get(keys, cb) {
    this._ensure(() => chrome.storage.local.get(keys, cb));
  },
  set(obj, cb) {
    this._ensure(() => chrome.storage.local.set(obj, cb));
  },
  remove(keys, cb) {
    this._ensure(() => chrome.storage.local.remove(keys, cb));
  }
};

// True when the tab indicator should apply to a given rule id under a scope.
function tabIndicatorApplies(scope, ruleId) {
  if (!scope || scope.mode !== "selected") return true; // default: all rules
  return Array.isArray(scope.ids) && scope.ids.includes(ruleId);
}

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

const SEGMENT_TYPES = ["text", "fleet", "browser", "pagetitle", "fleetrole", "element"];
// Segment types that carry a {…} template but no free-text/token field.
const TEMPLATE_SEGMENT_DEFAULTS = {
  browser: () => DEFAULT_BROWSER_SEGMENT,
  pagetitle: () => DEFAULT_PAGETITLE_SEGMENT,
  fleetrole: () => DEFAULT_FLEETROLE_SEGMENT
};

function defaultSegmentForType(type) {
  if (type === "fleet") return structuredClone(DEFAULT_FLEET_SEGMENT);
  if (type === "browser") return structuredClone(DEFAULT_BROWSER_SEGMENT);
  if (type === "pagetitle") return structuredClone(DEFAULT_PAGETITLE_SEGMENT);
  if (type === "fleetrole") return structuredClone(DEFAULT_FLEETROLE_SEGMENT);
  if (type === "element") return structuredClone(DEFAULT_ELEMENT_SEGMENT);
  return structuredClone(DEFAULT_TEXT_SEGMENT);
}

function normalizeSegment(rawSegment, ruleIndex, segmentIndex) {
  const raw = rawSegment && typeof rawSegment === "object" ? rawSegment : {};
  const type = SEGMENT_TYPES.includes(raw.type) ? raw.type : "text";
  const merged = { ...defaultSegmentForType(type), ...raw, type };
  if (!merged.id) merged.id = `seg-${Date.now()}-${ruleIndex}-${segmentIndex}`;
  merged.enabled = Boolean(merged.enabled);
  merged.justify = JUSTIFY_VALUES.includes(merged.justify) ? merged.justify : "center";
  const labels = {
    fleet: "Fleet server",
    browser: "Browser",
    pagetitle: "Page title",
    fleetrole: "Fleet role",
    element: "Sticky header",
    text: "Text"
  };
  merged.label = String(merged.label || labels[type]);
  if (type === "fleet") {
    merged.template = String(merged.template || DEFAULT_FLEET_SEGMENT.template);
    delete merged.text;
    delete merged.token; // legacy: the manual API token was removed
  } else if (type === "element") {
    merged.template = String(merged.template || DEFAULT_ELEMENT_SEGMENT.template);
    merged.selector = String(merged.selector || DEFAULT_ELEMENT_SEGMENT.selector);
    delete merged.text;
    delete merged.token;
  } else if (TEMPLATE_SEGMENT_DEFAULTS[type]) {
    merged.template = String(merged.template || TEMPLATE_SEGMENT_DEFAULTS[type]().template);
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
  // Allow zero segments: if a rule's last segment is removed, the bar simply
  // shows no text. (Previously this re-injected a default Text, which made
  // "add an element to an empty rule" produce a phantom extra Text segment.)
  return source.map((segment, i) => normalizeSegment(segment, ruleIndex, i));
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
    merged.tabTitle = normalizeTabTitle(rule && rule.tabTitle);
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

// Human-friendly label for a Fleet role string (mirrors Fleet's capitalizeRole).
function capitalizeRole(role) {
  const r = String(role || "").trim();
  if (!r) return "";
  if (r === "observer_plus") return "Observer+";
  if (r === "gitops") return "GitOps";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

// Privilege ranking used to pick a single role for accounts with several team
// roles (higher = more access).
const ROLE_RANK = { admin: 6, maintainer: 5, observer_plus: 4, observer: 3, technician: 2, gitops: 1 };

// Compute the display role for a Fleet user object (global_role + teams[].role).
// Prefer the global role when present (top-level access). Otherwise show the
// strongest team role held — a "what am I logged in as" indicator, so one clean
// label rather than "Various".
function fleetDisplayRole(user) {
  if (!user || typeof user !== "object") return "";
  const global = user.global_role || null;
  if (global) return capitalizeRole(global);
  const teams = Array.isArray(user.teams) ? user.teams : [];
  const roles = teams.map((t) => t && t.role).filter(Boolean);
  if (roles.length === 0) return "Unassigned";
  let best = roles[0];
  for (const r of roles) {
    if ((ROLE_RANK[r] || 0) > (ROLE_RANK[best] || 0)) best = r;
  }
  return capitalizeRole(best);
}

// A /me response looks like a Fleet user payload when it carries a user with
// role fields.
function isFleetMeResponse(data) {
  return (
    data &&
    typeof data === "object" &&
    data.user &&
    typeof data.user === "object" &&
    ("global_role" in data.user || "teams" in data.user)
  );
}

// Substitute the {role} placeholder in a fleet-role segment template.
function formatFleetRoleTemplate(template, role) {
  const tpl = String(template || DEFAULT_FLEETROLE_SEGMENT.template);
  return tpl.replace(/\{role\}/g, role === undefined || role === null ? "" : String(role)).trim();
}

// Substitute the {text} placeholder in an element segment template.
function formatElementTemplate(template, text) {
  const tpl = String(template || DEFAULT_ELEMENT_SEGMENT.template);
  return tpl.replace(/\{text\}/g, text === undefined || text === null ? "" : String(text)).trim();
}

// Substitute the {title} placeholder in a page-title segment template.
function formatPageTitleTemplate(template, title) {
  const tpl = String(template || DEFAULT_PAGETITLE_SEGMENT.template);
  return tpl.replace(/\{title\}/g, title === undefined || title === null ? "" : String(title)).trim();
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

// Extract a GitHub issue/PR number from a URL, else null.
function githubIssueNumber(href) {
  const url = buildUrlForMatching(href);
  if (!url || !/(^|\.)github\.com$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/^\/[^/]+\/[^/]+\/(?:issues|pull)\/(\d+)/);
  return m ? m[1] : null;
}

// Compose a tab title from the page's real title and a rule's tabTitle config.
// prepend/append only apply when the tab is NOT focused (they revert on focus);
// overwrite and the GitHub issue prefix persist regardless of focus.
function composeTabTitle(realTitle, cfg, focused, issueNum) {
  let base = String(realTitle || "").trim();
  const github = !!(cfg && cfg.github && issueNum);
  // Idempotent: drop any issue prefix already on the title so re-applying (or a
  // title we previously set being read back) can't stack it. Only runs on
  // GitHub issue/PR pages, whose real titles never start with "#<number>".
  // Strips one or more leading "#<num>" groups (with or without a trailing
  // separator/space), so even a bare "#123" or an already-doubled prefix cleans up.
  if (github) base = base.replace(/^(?:#\d+\s*-?\s*)+/, "").trim();
  const text = cfg && cfg.text ? String(cfg.text) : "";
  const mode = cfg ? cfg.mode : "off";
  let t = base;
  if (mode === "overwrite" && text) {
    t = text;
  } else if (!focused && text && (mode === "prepend" || mode === "append")) {
    t = mode === "prepend" ? `${text} ${base}` : `${base} ${text}`;
  }
  t = t.trim();
  if (github) {
    // No trailing space when there's no title yet (avoids emitting a bare
    // "#123 " whose trailing space the document.title getter would strip).
    t = t ? `#${issueNum} ${t}` : `#${issueNum}`;
  }
  return t;
}

// Whether a rule's tabTitle config actually manages the title.
function tabTitleManages(cfg) {
  return !!cfg && ((cfg.mode !== "off" && cfg.text) || cfg.github);
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
  const hostPort = firstDelimiterIndex >= 0 ? rest.slice(0, firstDelimiterIndex) : rest;
  let suffix = firstDelimiterIndex >= 0 ? rest.slice(firstDelimiterIndex) : "";

  // Assumed wildcards fill only the unassigned components (scheme + path). The
  // host is matched exactly as typed; add "*." yourself to include subdomains.

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
