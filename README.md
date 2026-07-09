# Colorbars Chrome Extension

This extension adds a configurable top bar to pages that match user-defined rules.

## Features

- Per-rule top bar text and style settings.
- Per-rule bar height and placement mode (`push` or `overlay`).
- Rule list with collapsible entries for quick scanning.
- Light / Dark / Auto theme (Auto follows the OS and updates live), Chrome-native settings styling.
- Custom color picker for Background and Text colors: the picker button shows the current color, with a
  saturation/brightness box, hue slider, hex entry, and shared saved swatches (click to apply, shift-click to remove).
- Multiple text segments per rule, each placed Left / Center / Right; segments never overlap, and segments
  sharing a zone stack horizontally in list order.
- Per-rule drag-and-drop bar mock-up for placing segments into Left / Center / Right zones and reordering
  within a zone; can be disabled in favor of a per-segment justification dropdown.
- Optional Fleet Server Info segment that detects a Fleet server on any domain (via `<origin>/version`) and shows
  its version/branch in the bar, with a templated display string and an optional masked API token.
- Extension version shown unobtrusively in the settings Help section.
- Toolbar popup (matches the settings theme) with an **All sites** master switch and a **This page** switch for the
  rule matching the current tab; disabling globally remembers and restores each rule's prior state.
- Global settings: master enable/disable, timed **Snooze** (1 hour / until tomorrow), **default style for new rules**,
  and a **domain blocklist** (wildcards supported; a bare domain covers its subdomains).
- Two matching modes:
  - `Domain Pattern` mode (single wildcard pattern).
  - `URL Components` mode (scheme, host, path, port, query).
- Domain Pattern mode includes a `Wildcards` checkbox (default on):
  - on: omitted URL components are wildcarded automatically
  - off: wildcard characters must be entered manually
- Supported schemes/prefixes include `http`, `https`, `ftp`, and `vnc`.
- Conflict precedence is based on URL component order (scheme -> host -> path -> port -> query), then rule list order.
- Font size is constrained by the bar height.
- Letter spacing is constrained by window width and recalculated on browser resize.
- Built-in font dropdown with common system/web-safe fonts.
- 3-second toast notifications for validation errors.
- In-extension help page with back button.
- Extension popup includes an `Open Settings` action so pinning is not required.

## Install (unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `chrome-extension`.

## Notes

- Rules are stored in `chrome.storage.sync`.
- The top bar is non-interactive (`pointer-events: none`) and sits above page content.
- Default bar text is empty.
