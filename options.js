function genId() {
  return `rule-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

const state = {
  rules: [],
  openById: {}
};

const listEl = document.getElementById("rules-list");
const template = document.getElementById("rule-template");
const addButton = document.getElementById("add-rule");
const toastEl = document.getElementById("toast");
let toastTimer = null;

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
    return `${pattern || "Domain Pattern"} | ${rule.layoutMode}:${rule.barHeight}px`;
  }

  const bits = [];
  if (rule.scheme !== "any") bits.push(rule.scheme);
  if ((rule.hostPattern || "").trim()) bits.push(rule.hostPattern.trim());
  if ((rule.pathPattern || "").trim() && rule.pathPattern.trim() !== "/*") bits.push(rule.pathPattern.trim());
  if (rule.portMode === "specific" && (rule.portValue || "").trim()) bits.push(`port:${rule.portValue}`);
  if (rule.queryMode !== "any") bits.push(`query:${rule.queryMode}`);
  const base = bits.length > 0 ? bits.join(" | ") : "URL Components";
  return `${base} | ${rule.layoutMode}:${rule.barHeight}px`;
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
        ? 'Wildcards <code>*</code> are assumed for any unassigned components.'
        : 'Wildcards <code>*</code> must be entered manually for any desired components.';
  }

  const preview = root.querySelector('[data-role="bg-preview"]');
  preview.style.background = rule.style.backgroundColor || "#000000";
  const textPreview = root.querySelector('[data-role="text-preview"]');
  textPreview.style.background = rule.style.textColor || "#ffffff";
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

function save(showSavedToast = false) {
  const next = state.rules.map((rule) => coerceRule(rule));
  for (const rule of next) {
    const error = validateRule(rule);
    if (error) {
      showToast(`Rule \"${rule.label || "Untitled"}\": ${error}`, true, 3000);
      return;
    }
  }

  chrome.storage.sync.set({ [STORAGE_KEY]: next }, () => {
    state.rules = next;
    if (showSavedToast) showToast("Saved", false, 800);
  });
}

function render() {
  listEl.innerHTML = "";

  state.rules.forEach((rule, idx) => {
    const fragment = template.content.cloneNode(true);
    const shell = fragment.querySelector('[data-role="rule-shell"]');

    shell.open = Boolean(state.openById[rule.id]);
    shell.addEventListener("toggle", () => {
      state.openById[rule.id] = shell.open;
    });

    shell.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.getAttribute("data-field");
      const value = parsePath(rule, field);

      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = value ?? "";

      input.addEventListener("input", () => {
        setPath(state.rules[idx], field, typedValue(input));
        syncVisibility(shell, state.rules[idx]);
        save(false);
      });
    });

    shell.querySelector('[data-action="delete"]').addEventListener("click", () => {
      state.rules.splice(idx, 1);
      render();
      save(true);
    });

    syncVisibility(shell, rule);
    listEl.appendChild(fragment);
  });
}

function load() {
  chrome.storage.sync.get([STORAGE_KEY], (items) => {
    state.rules = normalizeRules(items[STORAGE_KEY]);
    render();
  });
}

addButton.addEventListener("click", () => {
  const rule = {
    ...structuredClone(DEFAULT_RULE),
    id: genId(),
    label: `Rule ${state.rules.length + 1}`
  };
  state.rules.push(rule);
  state.openById[rule.id] = true;
  render();
  save(true);
});

load();
