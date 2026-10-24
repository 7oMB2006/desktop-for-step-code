# Desktop for Step Code

## Project Boundary

- This repository contains the desktop client in `Desktop/`. The macOS Apple Silicon track now follows the frozen Windows v0.5.1 Release, preserving the published v0.5.0-macos.1 port. See `docs/MACOS.md` and `docs/PLATFORM_HANDOFF.md`.
- `Step-Code/` is a separate upstream checkout and is intentionally excluded from this repository.
- Keep the macOS baseline fixed at Release v0.5.1 (`15f0fa77ee1562d3297e226071d49c00c762d891`), as requested by the owner; do not merge later Windows main/PR work or the separately maintained Linux branch without an explicit request. Preserve Windows behavior and renderer isolation. WSL is not a dependency.
- Preserve changes already present in the Step Code checkout. Do not edit it unless an integration need requires a narrowly scoped change.

## Runtime Boundary

- The Electron main process owns the Step Code child process and its JSONL RPC stream.
- The renderer must not receive Node.js access or filesystem access. Use the typed preload bridge and narrow IPC handlers.
- Store desktop-owned Step Code configuration, credentials, and sessions under Electron's `userData` directory. Never fall back to the user's personal Step Code profile.
- Do not log or display credentials, cookies, or raw child-process environment values.

## Development

- Run the desktop from `Desktop/` using `corepack pnpm dev`; stage its runtime first.
- Run type checks, protocol tests, and Electron acceptance tests before considering runtime integration complete.
- Read `docs/VERIFICATION.md` before claiming release readiness; local fixture tests do not establish real model acceptance.
- Do not add AI-client co-author attribution to commits.
- Follow `DESIGN.md` for shared UI components, including animated disclosures and form focus states. Input, textarea and composite-field focus indicators must remain fully visible on all four sides and rounded corners; reserve space inside clipping/scroll containers and verify focused controls in light/dark and narrow layouts. Never hide the focus indicator to mask clipping.
