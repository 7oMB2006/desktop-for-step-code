# Verification

This file combines historical feature checks with the current release gates. Named `Desktop/release-*` directories below identify local outputs used for those checks; they are not required retained artifacts or current download locations. Current packaging writes to `Desktop/release/`.

## Conversation Presentation

The revised 2026-09-30 preview at `Desktop/release/conversation-preview/` keeps all assistant narration and tool summaries visible in source order, with only thinking and individual tool payloads folded. It passed type checking, all 33 tests, the production build and background Electron acceptance against both the local build and the rebuilt packaged executable. The preview replaces the initial package's now-superseded global process disclosure.

Subsequent 2026-09-30 changes add localized action summaries and per-tool running/completed/failed animations. Type checking, all 35 tests, the production build and background Electron acceptance passed against both the local build and the rebuilt packaged executable at the same preview path. Acceptance verifies raw commands remain inside details, left-to-right shimmer runs only for pending calls, a completed sibling stops its own animation while another tool remains pending, failed labels are upright/red, reduced-motion disables shimmer, and interrupted missing results never appear successful. Screenshots are under `Desktop/test-results/tool-summary-*.png` and `transcript-tool-*.png`.

Fixtures cover user turn anchors, tool-ID pairing with out-of-order results, failed and missing results, retained intermediate narration, thinking and images, copy of all response prose excluding thinking/tool payloads, hover/focus controls without layout shifts, draft-preserving edit-to-composer, nested disclosure and visible narration/tool summaries after runtime disconnect. Light/dark and narrow-window screenshots are local evidence under `Desktop/test-results/transcript-*.png`; math and image-preview regression checks remain included.

Clipboard text writes are replaced by an in-page fixture, not performed against the user's clipboard. Editing restores a message copy to the composer; it is not runtime history editing. Branch remains disabled. This renderer change has no new real-model or installer lifecycle acceptance.

The subsequent thinking-disclosure adjustment passed type checking, all 36 tests, the production build and background Electron acceptance against both the local build and the rebuilt executable in `Desktop/release/conversation-preview/`. Thinking now folds when the first subsequent nonempty text delta arrives, while the response and pending tools remain active. Empty text-start events do not fold it; a manual reopen survives later deltas. `Desktop/test-results/thinking-folded-on-prose.png` captures that streaming state. The packaged credential-migration regression also passed again.

## Mathematical Notation

The 2026-09-30 source build passed type checking, 28 tests and background Electron acceptance. The local preview at `Desktop/release/math-preview/` was also packaged and passed the same acceptance against its unpacked executable. Fixtures cover inline and display math, same-line double-dollar notation, fractions, roots, sums, integrals, limits, matrices, cases, preserved code and prices, incomplete stream completion, malformed and oversized formulas, and disabled untrusted commands. Electron screenshots cover light/dark themes and a narrow window; the acceptance checks local font loading, thinking-block math, centered display formulas, horizontal scrolling confined to the formula with both ends accessible, and continued rendering after an invalid formula.

These are isolated renderer/protocol checks, not new real-model or installer lifecycle acceptance. Installation, upgrade and uninstall gates were not rerun for this frontend change. Screenshots are local evidence under `Desktop/test-results/math-*.png`. The first implementation supports dollar delimiters, not `\(...\)` or `\[...\]`; it is not a full LaTeX document compiler.

## Composer Attachments and Image Preview

The 2026-09-30 local preview was packaged at `Desktop/release/attachments-anchored-preview/`. Type checking, 22 tests, the production build and packaged Electron acceptance passed. Isolated fixtures cover file import through preload, document drop, synthetic clipboard image paste, image panning and Ctrl+wheel zoom, anchored expansion, close-during-drag reset, keyboard/focus return, reduced motion, localized image menus and adding transcript images back to the composer.

Image action acceptance substitutes clipboard writes, save dialogs and Explorer launch to avoid touching the user's clipboard or opening foreground windows. It validates the clipboard image payload and saved/cache bytes; it is not unattended OS clipboard round-trip or real-model acceptance. Other documents are local path references for agent tools, not native Word/PPT parsing. No installer, upgrade or uninstall gate was rerun for this frontend change.

Explorer image copies now live in userData `cache/image-previews/`, separate from the application data root. Acceptance verifies lazy directory creation, repeated reveals reusing the same format-specific cache file, and no image cache write to the data root. Existing root-level copies from earlier preview builds are not automatically deleted.

## Desktop Credential Storage

Step login previously wrote the access credential into readable `step-runtime/auth.json`. The desktop now loads that file once, stores a Windows `safeStorage` encrypted snapshot as `auth.dpapi`, then removes the plaintext file. The staged Step runtime uses a desktop-only in-memory auth backend; the renderer never receives the credential. If Windows encryption is unavailable, the ciphertext cannot be unlocked, or a nonempty legacy auth file exists, startup fails closed rather than falling back to plaintext. Normal uninstall removes the desktop Step credential files; upgrades retain them, and the app is configured to retain its user data. This does not encrypt MCP secrets in `config.toml` or protect against processes running as the same Windows user.

The isolated fixture test covers ordinary upstream plaintext persistence and desktop child-process memory storage. `scripts/verify-auth-vault.mjs` covers Electron migration, login, logout and relaunch with fixture credentials; that script uses no real Step account. The disposable Windows VM candidate-install acceptance is recorded in `docs/acceptance/issue-5/README.md`; a separate real-account model pass is recorded below. Neither establishes every public-release gate.
The VM acceptance confirmed that normal uninstall removed the three desktop credential files and retained a test session. It did not create an independent workspace, so workspace survival was not verified. The migration used two builds both labeled `0.1.0`, so it is build-to-build migration evidence rather than a formal version upgrade. An empty `%LOCALAPPDATA%\\Programs\\Desktop for Step Code` directory after uninstall is harmless residue, not a credential-cleanup failure; no custom recursive removal is planned.

## Independent Home

Recorded local build: `Desktop/release-home/`. Startup and the global new-session button create an independent session with a unique working folder under Electron userData `workspaces/independent/`. Project buttons create project sessions. Independent history stays independent on restore and runtime restart; restoring history does not add a project. The composer exposes the working folder and an optional project picker. Acceptance covers first-run and repeat launch, fresh empty drafts, independent history restoration, project selection and existing UI regressions; all five protocol tests pass. These checks use temporary profiles and fixture histories, not paid-model acceptance.

## Themed Select Menus

Recorded local build: `Desktop/release-select/`. All six selects (model, thinking, login profile, theme, language and MCP transport) use Chromium customizable select rendering with application colors, rounded menus and checked indicators. Electron 44 supports `appearance: base-select`; menu placement remains in the browser top layer with built-in keyboard behavior. Acceptance checks cover light/dark menu screenshots, keyboard open/Escape, bottom-edge option geometry and existing settings workflows. Model menu screenshots use an isolated profile without live credentials.

## Startup Workspace (Historical, Superseded by Independent Home)

Recorded local build: `Desktop/release-startup/`. Startup connects the last selected workspace (or the first remembered workspace) and explicitly starts a fresh session. The first renderer snapshot waits for initialization so model and message state arrive together. No remembered workspace retains the project picker; connection failures retain the picker and report an error. Typecheck, five protocol tests and Electron acceptance passed, including an empty startup session and enabled composer without selecting history. Model availability remains controlled by upstream account/configuration; isolated acceptance does not verify a paid model.

## Workspace Session Tree

Recorded local build: `Desktop/release-tree/`. Sidebar history is grouped under remembered working directories, with an independent-session section for history whose directory is not remembered. Project entries are never created from session history alone. Collapse controls and per-directory new sessions remain; the separate session list and search are removed. Acceptance includes an isolated unassigned session and verifies it does not create a project entry. Fixtures do not establish real-model acceptance; empty sessions still follow upstream deferred persistence.

## Product Icon

Recorded local build: `Desktop/release-brand/`. The canonical SVG matches the supplied StepCode.svg byte-for-byte. The empty state uses it; the duplicate sidebar brand header was removed, and the titlebar identity was later replaced by a sidebar toggle. Multi-resolution Windows icons are generated from that SVG and included in the executable, window, installer and uninstaller. The desktop shortcut had an explicit ICO path during that acceptance. Typecheck, production build and packaged Electron acceptance passed; screenshots and the icon extracted from the EXE were visually checked. This does not add any real-model acceptance evidence.

## Custom Window Chrome

Recorded local build: `Desktop/release-window/`. Windows uses a frameless Electron window with a theme-aware 46px titlebar, native draggable region and explicit minimize/maximize/restore/close controls. The close control delegates to the existing task-aware close flow. The titlebar project icon has since been replaced by a sidebar toggle, and File, Edit, View and Help menus were added alongside it (see Native Menus and Sidebar Motion). Reference implementation inspected: local Oh-DSH `src/main.ts` and `src/client.ts`. Electron checks cover minimize, maximize and restore plus existing layout/streaming regressions. Native drag, edge resize and Windows snap interactions still need manual acceptance.

## Layout Refinement

Recorded local layout build: `Desktop/release-layout/`. Sidebar spacing is consolidated, transcript and composer share a layout column, short user messages are content-sized, and composer height grows with input. No runtime behavior or assets were changed. Type checking, build, Electron workflow/streaming regression, and wide/narrow layout checks passed. Layout screenshots use explicitly injected test messages in an isolated profile, not a live model conversation.

## Streaming White-Screen Fix

The renderer incorrectly expected cumulative `message` snapshots on RPC `message_update` events. Upstream emits `assistantMessageEvent` deltas instead. The renderer now accumulates text/thinking/tool-start events and uses `message_end` as the final authoritative snapshot. An error boundary provides a reload action instead of a blank screen.

Regression checks include unit coverage and actual Electron renderer delivery of text and tool-start wire events without a `message` field. The updated executable and installer for that check were in `Desktop/release-fixed/`. Those builds did not persist renderer crash logs; startup and runtime crash logging was added later. This diagnosis was established from the protocol implementation and regression tests, not a recovered crash log.

## Install, Upgrade and Uninstall Residue

`scripts/verify-residue.mjs` snapshots the machine, installs, launches once, uninstalls, snapshots again, and reports what survived; an `upgrade` variant installs v1, launches it so it produces real userData, installs v2 over it, launches again, then uninstalls.

Verified on a development host, not a clean machine: install and uninstall both complete with exit 0; the install directory loses every file (an empty root directory remains, which is NSIS behaviour); both shortcuts, the registry uninstall entry and the registry app key are removed; userData is retained as `deleteAppDataOnUninstall: false` intends and holds no credentials because no login was performed. Across v1 → v2 the userData file set is unchanged (0 missing, 0 emptied, 0 modified) and the install directory matches a fresh v2 install rather than v1 + v2, with one registry uninstall entry rather than two. `~/.stepcode` was compared per-file across the whole window: 248 files, no add, no remove, no change.

The verdict is checked in both directions. In the installed state the rows fail as they should; deleting `userData\preferences.json` before the over-install makes the userData rows fail and names the file. Launch is observed through process liveness rather than a fixed sleep. Note that v2 recreates a deleted `preferences.json` on first run, so survival is judged on the pre-launch snapshot as well.

## Responsive Sidebar

PR #7. The sidebar auto-collapses on narrow windows. Typecheck, five protocol tests, production build and Electron acceptance passed with isolated fixtures; no paid-model execution was used.

## Performance Bar

PR #8. Run timing, tool count, token usage and cache metrics appear beneath the composer, plus session totals from Step Code's existing stats RPC. Typecheck, 7 tests, production build and Electron acceptance passed with isolated fixture data. No paid-model execution was used.

## Native Menus and Sidebar Motion

PR #13. The titlebar project icon is replaced by a sidebar toggle alongside File, Edit, View and Help menus wired to existing actions, the window bar is 46px, and sidebar collapse, expansion and responsive threshold changes animate with cubic easing while respecting reduced-motion preferences. Typecheck, nine tests, production build and Electron acceptance passed.

## Real-Account Acceptance

The feature-level integration checks above use isolated fixture profiles; the development-host residue check and the disposable-VM candidate-install pass are separate, as described in their sections. This section records a further pass against a real Step Plan account outside that VM, run by driving a packaged build through Playwright with sign-in completed manually in a browser. It was not unattended CI.

Browser authorization completed and the account reported `step_plan · valid`. A pre-existing legacy `auth.json` was migrated to `auth.dpapi` and removed on first launch; no plaintext `auth.json` persisted.

One coding task completed end to end on the `step-5-preview` model using the desktop's tool-approval flow. The desktop's token total matched the runtime's `get_session_stats`, including cached tokens.

## Startup and Runtime Crash Log

The main process installs handlers for `uncaughtException`, `unhandledRejection`, `render-process-gone` and `child-process-gone`, and records a startup phase at runtime staged, vault loaded, admin started, rpc started and window created. Each failure writes one file into `%APPDATA%\Desktop for Step Code\logs\` named `crash-<timestamp>-<id>.log`, holding the app version, whether the build is packaged, the phase at failure, the error and its stack, and the userData and logs paths; the write goes through a temp file and rename and stays silent when it fails, because a crash handler that can crash is worse than none. The ready-path failure keeps its existing dialog-and-quit behaviour and only gains a file written first, so no startup outcome changes.

`RpcProcess` now attaches the child exit code and a redacted stderr tail to both the runtime-exit error and its event, so an unexpected Step Code runtime exit is recorded with them; lines that look like credentials or environment values are dropped before anything reaches disk, since upstream stderr can echo them.

Acceptance uses a real failure rather than a mock: `scripts/verify-crash-log.mjs` migrates a fixture credential into `auth.dpapi`, then writes a conflicting plaintext `auth.json` so `vault.load()` refuses to start, and asserts that the crash log names that error and the phase while never echoing credential values. It runs in the Windows integration check after `verify-electron.mjs`.

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
- Native File, Edit, View and Help menus, and animated sidebar transitions.
- Real Step Plan sign-in, encrypted credential with no plaintext `auth.json` at any point, one real coding task with tool approvals, and token agreement between the desktop's accumulation and `get_session_stats`.

Screenshots and ephemeral test output are in `Desktop/test-results/` (ignored by Git).

## Release Boundary

The local preview can be tried now. The Issue #5 candidate install, build-to-build credential migration and normal uninstall passed in a disposable Windows VM; independent-workspace survival was not tested. Broader public-release qualification remains incomplete, so do not describe this as fully release-qualified. No release was published.
