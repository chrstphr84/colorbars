# Changelog

<!-- Generated from changelog.json by tools/gen-changelog.mjs. Do not edit by hand. -->

All notable changes to Colorbars are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project aims to follow [Semantic Versioning](https://semver.org/): a **minor**
bump for a feature (or batch of features), a **patch** bump for tweaks and fixes.

## [1.11.2]

### Changed
- Rule sections (Bar Appearance, Bar Text) are now collapsible and collapsed by default, keeping expanded rules shorter.
- Moved the Text / Fleet Server Info / Browser Info buttons to the top of the Bar Text section (below the mock-up) and dropped the "Add" prefix.

## [1.11.1]

### Changed
- Removed the global Display toggle; the in-rule bar mock-up is always shown.
- Removed the "Saved" toast — settings auto-save silently; validation errors are still shown.

## [1.11.0]

### Added
- Global Tab indicator toggle: replaces the tab's favicon with a solid rounded tile in the matched rule's color.
- The indicator only appears on background (unfocused) tabs — the active tab keeps its real favicon, so the page you're viewing is never obscured.
- Follows the rule color across in-app (SPA) navigations.
- Optional scope: apply the indicator to all rules or only selected ones, set in one place in the Global panel (rules stay uncluttered).

## [1.10.1]

### Fixed
- Domain Pattern with Wildcards on now matches the host as typed. Previously it silently required a subdomain, so a pattern like qa.example.com/* never matched qa.example.com itself. Add a *. prefix to include subdomains.

## [1.10.0]

### Added
- Browser Info segment for the bar text, showing the current tab's browser, full version, platform, and architecture (placeholders {browser}, {version}, {major}, {platform}, {arch}); works like the Fleet Server Info segment but reads the browser with no network request. Full version/platform/arch come from User-Agent Client Hints.

## [1.9.0]

### Added
- Create a rule for the current page directly from the toolbar popup: name (auto-filled from the domain), bar text, and a color picked from your swatches.
- Wildcards are on by default (matches the whole site); turn them off to flag only the exact page.
- New rules inherit all other settings from your default style.
- Conflict check: if a rule already covers the page, the popup offers to edit it instead of creating a duplicate.
- Confirmation with a bar preview and a one-click Edit rule that opens Settings expanded on the new rule.

## [1.8.0]

### Added
- Blur option that frosts the page behind the bar (available only when Bar Opacity is below 1; remembers its value when re-enabled).
- Text Opacity option for the bar text.

### Changed
- Renamed Background Color to Bar Color and Built-in Font to Font.
- Reordered the Bar Appearance fields into a cleaner grid.
- The bar always pushes page content down; removed the Page Placement option (it still overlays as the page scrolls).
- Removed the redundant Oblique font style (identical to Italic).

## [1.7.1]

### Changed
- The changelog now reads from a single changelog.json file; the changelog page and the generated CHANGELOG.md both come from it.

## [1.7.0]

### Added
- Dedicated Changelog page, reachable from both Settings and Help.
- A subtle Changelog link in the footer of the Settings and Help pages.

### Changed
- The Settings Help button is now a lozenge, matching the Back buttons.
- Simplified the Settings footer to just the version and Changelog link, matching the Help page footer.

## [1.6.1]

### Changed
- Global settings are now collapsible panels (Snooze, Default style, Domain blocklist, Display), matching the Rules accordion.
- Each Global panel shows its current state in the summary.
- Fixed cramped spacing in the Global section to match the Rules section.

### Fixed
- The Default-style color picker no longer clips inside its collapsible panel.

## [1.6.0]

### Added
- Themed toolbar popup with an All sites master switch and a This page switch for the current tab's rule.
- Global settings: master enable/disable, timed Snooze (1 hour / until tomorrow), default style for new rules, and a domain blocklist.

### Changed
- Disabling globally remembers each rule's state; re-enabling restores it.
- Per-page and global toggles are reflected on the matching rule switches.
- Moved the bar layout mock-up toggle from Appearance into the Global section.

## [1.5.2]

### Fixed
- Reserved the scrollbar gutter so the column no longer shifts when a rule is expanded.
- Aligned the Help page header with the Settings page for a seamless transition.

## [1.5.1]

### Fixed
- Help page now respects the theme set in Settings.
- Help page Back button works again (moved inline scripts to an external file for MV3 compatibility).

## [1.5.0]

### Added
- Drag a text segment into any zone, and drag to reorder within a zone.
- Toggle to show or hide the bar layout mock-up inside rules.

### Changed
- Segment placement is now Left / Center / Right (removed Justify).

### Fixed
- Zone labels no longer jump when a segment is placed.
- Auto theme now follows the operating system correctly.

## [1.4.0]

### Added
- Light / Dark / Auto themes and a Chrome-native settings restyle.
- Custom color picker with saved swatches for the Background and Text colors.
- Fleet Server Info segment showing the server's version and branch, with an optional API token.
- Multiple text segments per rule with independent placement, plus a drag-and-drop mock-up.
- Extension version shown in the Help section.

## [1.3.0]

### Baseline
- Per-rule top bar with Domain Pattern and URL Components matching.
- Per-rule text, style, height, and placement; collapsible rule list and in-extension help.

[1.11.2]: #1112
[1.11.1]: #1111
[1.11.0]: #1110
[1.10.1]: #1101
[1.10.0]: #1100
[1.9.0]: #190
[1.8.0]: #180
[1.7.1]: #171
[1.7.0]: #170
[1.6.1]: #161
[1.6.0]: #160
[1.5.2]: #152
[1.5.1]: #151
[1.5.0]: #150
[1.4.0]: #140
[1.3.0]: #130
