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
    text: "",
    backgroundColor: "#ff7a18",
    backgroundOpacity: "0.9",
    textColor: "#ffffff",
    fontFamily: "Arial, sans-serif",
    fontSize: "14",
    fontWeight: "700",
    fontStyle: "normal",
    textTransform: "uppercase",
    letterSpacing: "0.6"
  }
};

const STORAGE_KEY = "domainTopBarRulesV1";

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

function buildUrlForMatching(href) {
  try {
    return new URL(href);
  } catch {
    return null;
  }
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

function findMatchingRule(rules, href) {
  const url = buildUrlForMatching(href);
  if (!url) return null;

  const matches = [];
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (!rule.enabled) continue;

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
