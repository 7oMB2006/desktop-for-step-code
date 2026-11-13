# Generated Artifact Lifecycle

This policy covers Desktop builds, acceptance tests, demos and automation. It does not authorize deleting existing files, changing production user-data retention or retiring source checkouts and Git worktrees.

## Ownership And Boundaries

- Each artifact class must define its creator, purpose, output location, rebuildability, retention and cleanup owner. Routine runs need no manual ledger entry; document exceptions that must remain.
- Use unique per-run paths. Remove only exact paths created by that run, never broad temporary-directory prefixes or files inferred disposable from names or age.
- Close owned Electron instances, browsers, servers and child processes before cleanup. Cleanup failures must name the path and error and fail the run; do not silently accumulate residue.
- Keep source checkouts, Git worktrees, build packages, diagnostic evidence and persistent user data distinct.
- Fixes apply only to checkouts that integrate the corresponding Git changes. Other worktrees and already-built demos do not update automatically; do not bulk-edit them.

## Production User Data

Electron production `userData` contains persistent settings, credentials and sessions. It is not a disposable build artifact. Package cleanup and test cleanup must never remove it or the user's personal Step Code profile.

Acceptance tests use isolated `DESKTOP_TEST_USER_DATA`, synthetic credentials and fixture data. Relaunches within the same run may reuse that isolated profile; cleanup occurs after the runner finishes, not between every Electron launch.

## Disposable Profiles And Scratch Directories

Scripts in `Desktop/scripts` must create disposable test/demo directories through `test-profile.mjs`. The helper registers exact canonical paths and removes them when the runner drains, with a synchronous fallback for an explicit exit. It does not scan historical temporary files.

Tests retain their existing process/server teardown. The helper is not a process supervisor; forced termination can bypass hooks, and a hung runner must be reported as a failure rather than an assumed successful cleanup.

For cleanup between cases, call `removeTestProfile(profile)` after shutdown. It refuses unregistered paths and honors `DESKTOP_KEEP_TEST_PROFILES=1`. That opt-in retains profiles and prints each exact path once, including directories registered later in the run. Default success and failure both remove disposable profiles; retained failure evidence must be explicitly requested.

Screenshots, logs and summaries belong outside disposable profiles. A unique fixture directory under an evidence root remains disposable and must not be mistaken for evidence. Keep only evidence needed to support the current verification claim.

The macOS packaging staging directory has its own exact-path `finally` cleanup; it is not an application profile and is not covered by the profile-retention switch.

## Preview Packages

Honor the machine's ignored local build-output override, resolve output paths before packaging, and never fall back silently to an unapproved drive. Do not create large local preview packages in the system temporary directory.

Keep the newest two preview packages by default for concurrent use. Preserve additional named packages needed for active verification or expressly requested by the owner. Before separately authorized deletion, check exact paths, active processes, shortcut targets, reparse points and nested repositories; preserve manifests, receipts and necessary evidence.

## Installer Residue Tests

`verify-residue.mjs verify` and `upgrade` are destructive integration tests. Run them only in a disposable Windows account or VM with `--disposable-account`. Preflight must refuse existing installation, user data, shortcuts, personal Step Code state, uninstall entries, a running app, unknown registry/process state or runtime-storage overrides. Never erase pre-existing state to make the test pass.

Read-only snapshot, diff and environment inspection remain available in ordinary accounts. Unit tests cover preflight refusal, not installation or uninstallation.

## Verification

- `corepack pnpm exec tsx --test tests/test-profile.test.ts` from `Desktop/` checks exact ownership, normal/failure cleanup, retention, late registration, cleanup errors, canonical paths, symlink boundaries and script wiring.
- After building/staging the app, run `node scripts/verify-profile-lifecycle.mjs` from `Desktop/`. The Windows and macOS runtime CI groups run this for their configured source/packaged targets.
- The real Electron check sets a synthetic cookie, relaunches twice with the same isolated profile, verifies persistence, then checks default deletion and explicit retention after runner exit. It removes only its own fixture roots and writes `Desktop/test-results/profile-lifecycle/results.json`, or the configured evidence output.
- This does not prove real-account behavior, installer safety, release readiness or automatic synchronization of other worktrees.
- After any separately authorized historical cleanup, verify protected paths remain intact and report actual free-space change separately from logical folder sizes.
