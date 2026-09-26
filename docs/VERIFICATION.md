# Verification

## Independent Home (Current)

Current build: `Desktop/release-home/`. Startup and the global new-session button create an independent session with a unique working folder under Electron userData `workspaces/independent/`. Project buttons create project sessions. Independent history stays independent on restore and runtime restart; restoring history does not add a project. The composer exposes the working folder and an optional project picker. Acceptance covers first-run and repeat launch, fresh empty drafts, independent history restoration, project selection and existing UI regressions; all five protocol tests pass. These checks use temporary profiles and fixture histories, not paid-model acceptance.

## Themed Select Menus

Latest build: `Desktop/release-select/`. All six selects (model, thinking, login profile, theme, language and MCP transport) use Chromium customizable select rendering with application colors, rounded menus and checked indicators. Electron 44 supports `appearance: base-select`; menu placement remains in the browser top layer with built-in keyboard behavior. Acceptance checks cover light/dark menu screenshots, keyboard open/Escape, bottom-edge option geometry and existing settings workflows. Model menu screenshots use an isolated profile without live credentials.

## Startup Workspace (Historical, Superseded by Independent Home)

Latest build: `Desktop/release-startup/`. Startup connects the last selected workspace (or the first remembered workspace) and explicitly starts a fresh session. The first renderer snapshot waits for initialization so model and message state arrive together. No remembered workspace retains the project picker; connection failures retain the picker and report an error. Typecheck, five protocol tests and Electron acceptance passed, including an empty startup session and enabled composer without selecting history. Model availability remains controlled by upstream account/configuration; isolated acceptance does not verify a paid model.

## Workspace Session Tree

Latest build: `Desktop/release-tree/`. Sidebar history is grouped under remembered working directories, with an independent-session section for history whose directory is not remembered. Project entries are never created from session history alone. Collapse controls and per-directory new sessions remain; the separate session list and search are removed. Acceptance includes an isolated unassigned session and verifies it does not create a project entry. Fixtures do not establish real-model acceptance; empty sessions still follow upstream deferred persistence.

## Product Icon

Latest build and desktop shortcut: `Desktop/release-brand/`. The canonical SVG matches the supplied StepCode.svg byte-for-byte. Titlebar and empty state use it; the duplicate sidebar brand header is removed. Multi-resolution Windows icons are generated from that SVG and included in the executable, window, installer and uninstaller. The desktop shortcut has an explicit ICO path. Typecheck, production build and packaged Electron acceptance passed; screenshots and the icon extracted from the EXE were visually checked. This does not add any real-model acceptance evidence.

## Custom Window Chrome

Latest build: `Desktop/release-window/`. Windows uses a frameless Electron window with a theme-aware 36px titlebar, native draggable region and explicit minimize/maximize/restore/close controls. The close control delegates to the existing task-aware close flow. Reference implementation inspected: local Oh-DSH `src/main.ts` and `src/client.ts`. Electron checks cover minimize, maximize and restore plus existing layout/streaming regressions. Native drag, edge resize and Windows snap interactions still need manual acceptance.

## Layout Refinement

Latest layout build: `Desktop/release-layout/`. Sidebar spacing is consolidated, transcript and composer share a layout column, short user messages are content-sized, and composer height grows with input. No runtime behavior or assets were changed. Type checking, build, Electron workflow/streaming regression, and wide/narrow layout checks passed. Layout screenshots use explicitly injected test messages in an isolated profile, not a live model conversation.

## Streaming White-Screen Fix

The renderer incorrectly expected cumulative `message` snapshots on RPC `message_update` events. Upstream emits `assistantMessageEvent` deltas instead. The renderer now accumulates text/thinking/tool-start events and uses `message_end` as the final authoritative snapshot. An error boundary provides a reload action instead of a blank screen.

Regression checks include unit coverage and actual Electron renderer delivery of text and tool-start wire events without a `message` field. Updated executable and installer are in `Desktop/release-fixed/`; the desktop shortcut points to that executable. Previous builds did not persist renderer crash logs. This diagnosis was established from the protocol implementation and regression tests, not a recovered crash log.

## Install, Upgrade and Uninstall Residue

Latest build: `Desktop/release/`. `scripts/verify-residue.mjs` snapshots the machine, installs, launches once, uninstalls, snapshots again, and reports what survived; an `upgrade` variant installs v1, launches it so it produces real userData, installs v2 over it, launches again, then uninstalls.

Verified on a development host, not a clean machine: install and uninstall both complete with exit 0; the install directory loses every file (an empty root directory remains, which is NSIS behaviour); both shortcuts, the registry uninstall entry and the registry app key are removed; userData is retained as `deleteAppDataOnUninstall: false` intends and holds no credentials because no login was performed. Across v1 → v2 the userData file set is unchanged (0 missing, 0 emptied, 0 modified) and the install directory matches a fresh v2 install rather than v1 + v2, with one registry uninstall entry rather than two. `~/.stepcode` was compared per-file across the whole window: 248 files, no add, no remove, no change.

The verdict is checked in both directions. In the installed state the rows fail as they should; deleting `userData\preferences.json` before the over-install makes the userData rows fail and names the file. Launch is observed through process liveness rather than a fixed sleep. Note that v2 recreates a deleted `preferences.json` on first run, so survival is judged on the pre-launch snapshot as well.

## Passed Locally

- TypeScript checks and production renderer/main/preload build.
- JSONL byte-boundary decoding, including split Chinese characters and CRLF.
- Isolated child environment: provider key and legacy auth path overrides are not inherited.
- Staged Step Code RPC handshake, message/model queries, and management process startup.
- MCP config round trip with secret values omitted from management responses.
- Real Step Code runtime against a local deterministic SSE fixture: streaming, completed message, persisted session discovery, rename, new session and restored history. This is a protocol test, not a real model quality test.
- The local SSE fixture also requests an actual upstream `write_file` call: Step Code emits its permission confirmation, the test client approves, and the temporary file content is verified.
- Electron source launch and packaged executable: isolated user directory, account settings, workspace connection, rename, MCP save, theme switching, narrow window, no renderer Node access, no renderer exceptions.
- Windows x64 NSIS installer generated.

Screenshots and ephemeral test output are in `Desktop/test-results/` (ignored by Git).

## Not Yet Verified

- Paid model execution, real file-edit/tool approval flows, and cancellation during a real tool task.
- Clean-machine first installation, missing-tool onboarding and 125% display scaling; the development host uses 150% scaling and has prior installs. Install, upgrade and uninstall residue on a development host is covered by `scripts/verify-residue.mjs`.
- All upstream extension UI methods. Dialog methods are supported; custom widgets and status surfaces are not fully represented.
- MCP OAuth management and HTTP secret header editing through UI.
- Large-history virtualization and full Git diff review.

## Release Boundary

The local preview can be tried now. Do not describe it as fully public-release-qualified until the remaining acceptance items pass. No release was published and no personal credentials were imported.
