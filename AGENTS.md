# Desktop for Step Code

## Project Boundary

- This repository contains the desktop client in `Desktop/`. The macOS Apple Silicon 0.6.0 preparation follows the frozen Windows PR #163 merge, preserving the existing macOS port. See `docs/MACOS.md` and `docs/PLATFORM_HANDOFF.md`.
- `Step-Code/` is a separate upstream checkout and is intentionally excluded from this repository.
- The owner explicitly authorized the 0.6.0 migration on 2026-10-24. Freeze shared Windows features at PR #163 merge `324e71d1800de020c035cdce598374a6037ba4ca`; do not import later Windows main/PR work or the separately maintained Linux branch without an explicit request. Mac parity fixes and release preparation build on this commit. Preserve Windows behavior and renderer isolation. WSL is not a dependency.
- Separate post-0.6.0 feature work: on 2026-10-26, the owner explicitly authorized Workflow [III], the read-only `/workflows` drawer, from main `e50ff1d7824209e8fe90ef949100c677bf90d8c9`. This is not part of the frozen macOS 0.6.0 migration. The authorization does not expand that release's scope, permit unrelated feature imports, or authorize a runtime pin upgrade.
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

## Windows Package Handoff

- Follow `docs/ARTIFACT_LIFECYCLE.md` for generated profiles, scratch output, retained evidence and preview-package ownership. Honor locally configured package retention, protect actively referenced or explicitly retained packages, and obtain authorization before deleting older artifacts.
- Honor the machine's ignored local build-output override. Resolve output paths before building; do not place large local preview packages in the system temporary directory or silently fall back to an unapproved drive.
- Acceptance scripts and demos must create disposable profiles through `Desktop/scripts/test-profile.mjs`, close their owned processes before cleanup, and keep formal application credentials and sessions separate. Installer residue tests require a disposable account or VM and `--disposable-account`; never erase pre-existing state to prepare a test.

- Unless the owner explicitly opts out for a particular build, a requested Windows acceptance package includes updating the existing primary desktop `Desktop for Step Code.lnk` after package verification passes. This is standing authorization; do not require a separate shortcut-update request.
- Inspect and back up that exact shortcut before editing. Point its target, working directory and icon to the newly verified package's `win-unpacked` executable, then read the saved shortcut back to verify all three fields and that the executable exists.
- Preserve existing launch arguments, profile selection, hotkey and window style. Do not introduce demo arguments, profile overrides or credential/configuration changes as part of redirecting the shortcut.
- Updating the shortcut does not switch an already-running single-instance application. Do not close or restart the owner's application, run the installer or delete the previous package without separate authorization; report when the old app is still running.
