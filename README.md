# Colorbars Chrome Extension

This extension adds a configurable top bar to pages that match user-defined rules.

## Features

- Per-rule top bar text and style settings.
- Per-rule bar height and placement mode (`push` or `overlay`).
- Rule list with collapsible entries for quick scanning.
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
