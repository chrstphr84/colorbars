importScripts("shared.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get([STORAGE_KEY], (items) => {
    const current = normalizeRules(items[STORAGE_KEY]);
    if (current.length > 0) return;

    chrome.storage.sync.set({
      [STORAGE_KEY]: [
        {
          ...structuredClone(DEFAULT_RULE),
          id: `rule-${Date.now()}`,
          label: "Example: Staging",
          domainPattern: "*.staging.example.com/*",
          style: {
            ...structuredClone(DEFAULT_RULE.style),
            backgroundColor: "#d62828",
            backgroundOpacity: "0.85"
          },
          segments: [
            { ...structuredClone(DEFAULT_TEXT_SEGMENT), id: `seg-${Date.now()}`, text: "STAGING" }
          ]
        }
      ]
    });
  });
});
