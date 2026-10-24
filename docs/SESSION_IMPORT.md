# Offline Session Migration

Windows and macOS 0.6.0 Settings > Session migration import local Codex and Claude Code history.
This adapts Step-Code PR #291 at source commit
`6a0984573275d2398faa812bbf661a9dc5557e06`, using the shared pinned v0.1.5
runtime. macOS 0.6.0 includes the same reviewed import service and setup UI.
Earlier Windows-only verification records below remain historical evidence; see
[Mac candidate verification](releases/v0.6.0-macos-preparation.zh-CN.md).

## Workflow

- Scanning is explicit, not a startup action. Sources default to `CODEX_HOME`
  or `~/.codex`, and `CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects`.
  Override the source directories when needed. Codex archives and child sessions
  are excluded by default.
- Results use 20-session pages with a separately scrolling list. Search and
  source filters cover all scanned candidates and return to the first page.
  Reviewed selections survive pagination and filtering; the action bar above
  the list counts off-page selections and can clear them. A new scan clears
  selections and reviewed snapshots. Pagination does not reduce discovery work.
- Candidates can be selected directly, by page or across all filtered matches,
  up to 100 per batch. Clicking a row toggles selection; the separate eye-and-text
  Preview button opens details without changing selection.
  Previewing is optional; import prepares missing snapshots
  sequentially before publishing any copies, with progress and cancellation.
  Missing project directories open the relevant preview for correction.
  The fingerprint binds the selected
  immutable snapshot for 15 minutes, subject to the bounded preview cache.
  A new scan replaces candidate capabilities. Preview again for later source
  changes. Imported copies never silently refresh from the source.
- Map each selected session to an existing absolute project directory, including
  through the native directory chooser. Import batches contain 1 to 100 sessions.
- Import preparation opens a confirmation dialog listing target directories and
  session counts. Returning or pressing Escape preserves selection and publishes
  nothing. "Add missing directories as sidebar projects" defaults on; turning it
  off leaves unregistered directories under independent sessions without detaching
  matches from existing projects. Only imported/skipped copies register projects,
  not failed or unprocessed candidates. Registration does not create directories,
  activate a runtime, grant project trust or change the active conversation.
  Reimporting an existing copy with this option enabled can repair its grouping
  without rewriting history. Its saved native directory takes precedence over a
  newly selected destination, since duplicate imports do not relocate copies.
- Import runs offline in its own Desktop-owned Node child, without credentials,
  source-agent execution, provider requests or changes to the active conversation.
  Account/admin-process reloads do not destroy its reviewed snapshots.
- Copies and journals remain inside the Desktop profile at
  `step-runtime/sessions/imported` and `step-runtime/agent/session-imports`.
  Reimporting an identical source/fingerprint skips its existing copy, even after
  that copy has been continued. Changed reviewed snapshots create separate copies.
- Cancel stops remaining sessions between atomic publications. Completed copies
  remain. Closing settings does not stop the job. Application exit settles the
  current publication and cancels remaining work before stopping the child.
  A crash leaves a recoverable interrupted journal, not a falsely completed batch.
- Finished batches default to collapsed summaries showing imported, skipped and
  failed counts. Details use a 280px scrolling region with the shared disclosure
  arrow and motion. Finished history uses five-batch pages; running jobs remain
  visible outside that pagination. Preview has no duplicate selection control.

## Continuation And Display

The runtime patch supplies the shared adapters, snapshot service, provenance,
context projection and usage exclusion from #291. Historical tools enter model
context as text evidence with explicit completed, failed or unknown outcomes,
not live tool protocol. Source system/developer controls, approvals, credentials
and hidden reasoning are not activated. Source models are not restored as the
Desktop model and imported usage is not new StepCode spend.

The Desktop renderer reads original active-path history for imported sessions,
separately from this model-only context projection. Historical tools use existing
tool disclosures with a historical label and retain unknown outcomes. They cannot
become active Plan/Workflow state, new file-change receipts or native tool groups
claiming successful current operations. Historical call IDs have a separate
display-only namespace, so a new provider's IDs cannot pair with old results.
Native continuations retain their normal messages, usage and entry IDs.

The admin catalog explicitly includes the imported child directory because
`SessionManager.listAll(customRoot)` scans only direct files. It never falls
back to a personal Step Code profile. Opening a result uses normal Desktop
navigation and its existing project/trust/permission checks.

## Limits

This is conversation migration, not a lossless backup or restoration of source
processes, checkpoints or encrypted reasoning. Missing/unsupported attachments
produce preview warnings. Local supported images must be contained in the selected
source root. Claude compaction and message-chain gaps are reported explicitly.
Source files are opened read-only. The service keeps upstream bounds:
128 MiB source files, 5,000 candidates, 16 discovery levels, a 256 MiB preview cache,
20 MiB per local image and 32 MiB total local images. Windows session-history RPC
has a separate 256 Mi-character ceiling to accommodate reviewed histories and
embedded images; management and other RPC transports retain their 32 Mi-character
ceiling. This is a maximum supported envelope, not a promise of instant rendering
for hundreds of megabytes of history.

Verification commands:

```powershell
corepack pnpm typecheck
node --import tsx --test tests/session-import.test.ts
corepack pnpm build
node scripts/verify-session-import.mjs
```

The native verifier uses synthetic histories, an isolated profile and a local
fake provider. Real Codex/Claude histories, paid model execution and installer
upgrade are separate acceptance, never implied by these tests.

## Local Verification (2026-10-22)

- The standard patch applier replayed the complete Windows manifest against a
  clean checkout of the unchanged pin. Staging with Node v24.16.0 passed and
  advertises `desktop-session-import`. The importer has an explicit system/source
  path environment allowlist rather than inheriting unrelated provider tokens.
- Typecheck and production build passed. Desktop unit tests: 610 passed and
  13 skipped. CI policy and runner tests: 15 passed. Upstream adapter, lifecycle,
  context, compaction and usage regressions: 90 passed across five files.
- `verify-session-import.mjs` passed against source Electron: explicit scan;
  archive opt-in and child exclusion; both Codex and Claude imports; reviewed
  snapshot preservation while the source appends; duplicate skip without overwrite;
  destination chooser IPC with a stubbed native dialog; normal result navigation;
  historical transcript and zero historical spend; a new native continuation
  through the local fake provider; unchanged source files; persisted copies and
  job journals after relaunch.
- Native light/dark theme switching and the 640px minimum window passed. The separate
  browser fixture was visually checked in Chinese/light and English/dark at
  375px, with no horizontal overflow. This fixture is a mock, not the import service.
- General Electron acceptance passed, including real RPC, settings, navigation,
  renamed sessions, MCP, themes, narrow window and renderer Node isolation.

No installer was built, real personal history was not imported, and no paid
provider, remote CI, macOS import or first-install migration was accepted here.

## PR Integration Check (2026-10-22)

Rebased onto main `079540c`, preserving its tool disclosure animation and MCP icon.
Typecheck, production build and 15 CI policy/runner tests passed. The complete
serial Desktop run reported 623 passed, 13 skipped and one failure in the existing
terminal-count test: its nine mock terminal processes did not terminate within
the cleanup deadline. That test and the terminal implementation are unchanged
by this feature. Owned test descendants were explicitly stopped so the runner
could report the failure; this is not a fully green suite.
