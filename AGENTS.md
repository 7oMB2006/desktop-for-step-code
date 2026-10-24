# Desktop for Step Code

## Project Boundary

- This repository contains the desktop client in `Desktop/`. The macOS Apple Silicon 0.6.0 preparation follows the frozen Windows PR #163 merge, preserving the existing macOS port. See `docs/MACOS.md` and `docs/PLATFORM_HANDOFF.md`.
- `Step-Code/` is a separate upstream checkout and is intentionally excluded from this repository.
- The owner explicitly authorized the 0.6.0 migration on 2026-10-24. Freeze shared Windows features at PR #163 merge `324e71d1800de020c035cdce598374a6037ba4ca`; do not import later Windows main/PR work or the separately maintained Linux branch without an explicit request. Mac parity fixes and release preparation build on this commit. Preserve Windows behavior and renderer isolation. WSL is not a dependency.
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
