# Pull Request CI

Every pull request starts `PR CI`. The workflow classifies the complete change
against the pull request's merge base, then selects one of two routes:

- Documentation-only changes run `Documentation checks`: whitespace and added
  conflict markers, plus the existing runtime-pin and patch-command contracts.
  These checks need no Desktop dependency install or runtime build. They do not
  validate Markdown rendering, remote links, or release facts.
- All other changes run three independent Windows groups: `Windows interface`,
  `Windows sessions`, and `Windows runtime`. Every group builds the pinned
  upstream, applies the current integration patch, stages runtime and builds the
  application. Only `runtime` runs the shared upstream tests, typecheck and full
  unit/protocol inventory. The other groups start their native acceptance without
  waiting for duplicate executions of these tests.
  Electron acceptance is split between groups but remains serial within each
  runner. A failure stops its group; the other groups are not cancelled.

The documentation allowlist lives in `scripts/ci-policy.mjs`. It includes the
root README files, TODO, DESIGN, PRODUCT, explicitly named documentation pages
(including plugin authoring, themes, Cron and macOS guidance),
release Markdown under `docs/releases/`, acceptance Markdown and images under
`docs/acceptance/`, and README images under `assets/readme/`. It does not include
arbitrary Markdown or images elsewhere in the repository. Application files,
dependencies, installation/version configuration, upstream patches, CI scripts,
workflows, `AGENTS.md`, and unknown paths require Windows integration. A mixed
documentation/code change also requires integration. Renames and copies examine
both source and destination paths; an empty change defaults to integration.

`CI result` runs after both routes and validates all dependency outcomes. It
passes only when classification succeeded and either documentation succeeded
with all three Windows groups skipped, or all three Windows groups succeeded
with documentation skipped. Missing/unknown jobs, missing outputs,
classification errors, failures, cancellations, and unexpected skips cannot
produce a successful result. Preparation and acceptance belong to the same
group job, so a failed build cannot bypass the gate. Each successful group must
also return its own group ID and completion receipt; swapped inputs, duplicate
group execution or a skipped acceptance step cannot satisfy the final gate.
The runtime group must additionally attest that every shared test stage succeeded.
The other two groups must explicitly attest that those same stages were skipped
as not applicable. Missing, partial or wrongly assigned shared receipts fail the
gate even when all three native groups report success.
If branch protection is configured, require the unchanged `CI result` name
rather than conditional jobs.
An old required `Windows integration` check must be replaced by `CI result`
when adopting this workflow.

Policy and inventory regression tests run before classification on every pull
request. The runner tests also run on each Windows job, including owned-process
tree cancellation. Run them locally without installing Desktop dependencies:

```sh
node --test --test-concurrency=1 scripts/ci-*.test.mjs scripts/windows-ci-summary.test.mjs
```

## Documentation Scope and Evidence

Classification uses the complete PR merge-base diff, including both sides of
renames and copies. It never chooses the lightweight route from only the latest
commit or the location of a merge conflict. Schemas, executable examples,
dependencies, CI configuration and unknown paths still require full integration.

A feature PR with a later documentation-only commit therefore still runs full
integration. Cross-run green-evidence reuse is deliberately not implemented:
proving equivalent tested merge trees, bases, workflow versions and complete
trusted outcomes is a separate change. Do not interpret an old head's success as
current-head acceptance or silently cancel a required check. Exceptional bypasses
remain an explicit owner decision after reviewing the unverified scope.

`scripts/ci-docs.mjs` shares its pin and patch-command checks with
`Desktop/tests/runtime-staging.test.ts`; the lightweight route is not a way to
bypass those existing contracts. Run `node scripts/ci-docs.mjs` locally, or provide
`BASE_SHA` and `HEAD_SHA` to also check the cumulative Git diff.

## Bounded Protocol Tests

Both native platforms use `scripts/ci-protocol.mjs` for the full, sorted
`Desktop/tests/*.test.ts` inventory. Files execute serially through the existing
`tsx --test --test-concurrency=1` with default process isolation. Test assertions,
individual test timeouts, platform skips and the job's total deadline are unchanged.
Each file now has an external five-minute deadline covering assertion failure
and cleanup; there is no retry or `--test-force-exit`.

`Desktop/test-results/protocol/` retains an independent TAP and console logfile
per file plus `summary.json` with expected files, active file, results and completion.
Multiple TAP streams are not concatenated into an invalid report. A failure stops
the suite and names its file; an empty or partial inventory cannot complete.

Termination targets only the owned Windows process tree or POSIX detached group.
If cleanup cannot be confirmed within a short secondary deadline, the runner
closes its own pipe handles, records `cleanup-unconfirmed` and fails rather than
waiting indefinitely. An exited Windows leader is never targeted by its stale PID.
Unconfirmed cleanup is not evidence that descendants were removed.

Use `node scripts/ci-protocol.mjs --list` without Desktop dependencies to inspect
the inventory. After installing dependencies and staging the correct runtime,
run the same command without `--list` for the full suite.

## Native Canvas Prebuilds

Windows x64 and macOS ARM64 prepare the existing pinned `canvas@3.2.3`
official Release archive before installing the frozen upstream dependencies.
`scripts/ci-canvas-prebuild.mjs` restricts the platform selection, downloads
only from Automattic/node-canvas's GitHub Release or the same asset's official
GitHub API endpoint, and verifies the asset's recorded SHA-256 before atomically
publishing the local archive. An existing
archive is also checked before reuse. Downloads have finite deadlines and at
most two retries per endpoint; HTTP errors, interrupted downloads and checksum mismatches
fail preparation rather than becoming successful installation evidence.
The API fallback uses the fixed official asset ID and the same digest, without
credentials or a third-party mirror. It runs only after Release download fails.

The original `prebuild-install` lifecycle consumes this archive through its
supported `npm_config_canvas_local_prebuilds` setting. It still installs the
native module; no lifecycle scripts or dependencies are skipped. This avoids
falling back to unrelated native compilation when the installer's single
30-second download attempt fails. That installer can report a non-200
download response as "No prebuilt binaries found"; this message alone does not
prove that a matching platform asset is absent.

Each runner has its own temporary prebuild directory. Nothing is shared with
user profiles or across jobs, and there is no mirror, dependency/runtime
version change or weaker test gate. Updating the pinned dependency requires
reviewing the official assets and digests again. Windows failure summaries
include preparation as a named stage. Local checksum and Windows native
rendering checks do not replace cloud installation or macOS native acceptance.

## Electron Download Preparation

After the normal Desktop dependency install, `scripts/ci-electron-prebuild.mjs`
prepares the unchanged `electron@44.4.5` archive in a runner-owned
`electron_config_cache`. It uses the installed `@electron/get` cache
implementation instead of duplicating its layout. The installed Electron
package's published `checksums.json` supplies the required digest. The same
bounded official-Release/API downloader verifies the archive before caching it.

The normal `node node_modules/electron/install.js` still extracts and validates
Electron. No checksum checks or install steps are bypassed. A future Electron
version or another platform requires reviewing the official asset IDs; a
missing checksum fails preparation. This is an isolated CI cache, not an
application/runtime upgrade or a change to the author's running package.

## Acceptance Inventory

`scripts/ci-acceptance.mjs` is the single assignment list. Its three groups retain
all 41 Electron scripts from main `45ff68e`, including the composer-menu check.
The explicit `localOnly` list records the 14 scripts that were already outside
PR CI; this scheduling change does not silently expand or reduce coverage.
Every `Desktop/scripts/verify-*.mjs` must be listed exactly once. New files,
missing files, duplicate assignments, unknown groups and empty groups fail
classification. New coverage belongs in an acceptance group; changing local-only
coverage requires an explicit review decision.

The reusable `.github/workflows/windows-integration.yml` keeps preparation in
one place, using the caller's checkout. Each runner independently builds current
code; no build/runtime cache or cross-job build artifact is used in this version.
Shared tests run only in `runtime`, with an explicit outcome receipt checked by
the final gate. Installation and native-module preparation remain per runner.
The three callers all depend only on classification, not on one another.
No matrix fail-fast can hide another group's diagnosis.

`scripts/ci-windows.mjs` runs each group's scripts in the Desktop directory,
stops on the first failure and prints named log groups. Every script has a
five-minute deadline, within the 45-minute group job limit.
Timeouts/cancellation terminate only the
owned test process tree. Logs and the job summary report per-script durations;
`acceptance-timings-<group>-<attempt>` contains a JSON report including expected count,
executed checks and completion status. Failure screenshots also have group-specific
artifact names, including the run attempt to avoid rerun collisions. Records
remain available for seven days.

The Windows workflow also runs `scripts/windows-ci-summary.mjs` after preparation
or acceptance, including on failure or cancellation when checkout and Node setup
succeeded and the runner can still execute cleanup steps.
It identifies failed/cancelled stages, a failed or last-recorded active
script, checks not started and the five slowest recorded checks. The Markdown
summary is included in the existing timing artifact. An active record without a
result means interrupted/incomplete evidence, not necessarily a timeout.
Missing reports never imply success; malformed or inconsistent reports fail the
diagnostic step without echoing their unvalidated contents.

The diagnostic helper receives only explicit stage outcomes and allowlists
script names against the group's existing inventory. It does not collect raw
environment values, credentials, child-process output or conversation content.
It does not retry tests, change deadlines, grant completion receipts, or modify
the shared runner, acceptance assignments or macOS workflow.
The helper cannot select the documentation route or grant macOS acceptance.

Inspect the assigned scripts without building:

```powershell
$env:CI_WINDOWS_GROUP = 'interface' # or sessions / runtime
node scripts/ci-windows.mjs --list
```

After building and staging the runtime in a Windows checkout, remove `--list`
to run that group. Do not run multiple groups on the same interactive desktop:
separate user-data directories alone do not isolate clipboard and window focus.

The October 13 serial baseline runs `38341876201` and `38336441946` took about
14m43s and 15m16s. The first spent 11m06s in serial Electron acceptance.
Compare several cloud runs' total elapsed time, slowest group, preparation
time, failure rate and total runner-minutes before claiming a speed improvement.
An 8-10 minute wall-clock target is experimental, not a guarantee; runner
queueing and duplicated preparation affect both duration and cost.

No installer build is required for a CI-only change. Real model and release
acceptance still follow `VERIFICATION.md`.

## macOS Apple Silicon Preview

`.github/workflows/macos-integration.yml` runs separately from `PR CI`.
The shared `CI result` includes classification, documentation and the three
Windows groups; it does not include macOS acceptance. A green shared result
therefore does not establish macOS readiness.

Every PR now creates a lightweight classification job and the fixed final macOS
check, rather than filtering the entire workflow away by path. A documentation
route must pass its document checks, explicitly skip preparation and all native
groups, and must not download, validate or promote any candidate artifact.
The final check reports the selected route, not fictitious native acceptance.
Pushes to the existing special branches and manual dispatches always run full
integration; only complete PR diffs can select documentation mode.

Each `macos-15` job runs on its own GitHub-hosted virtual machine, as described
in [GitHub's hosted runner documentation](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners).
Different pull requests do not run their jobs on one repository-wide VM.
Simultaneous failures alone do not establish CPU or memory contention between
pull requests. The concurrency group includes both `github.workflow` and
`github.ref`: different pull requests do not block each other through this
group, while `cancel-in-progress: true` cancels an older run superseded on the
same ref. GitHub runner availability and account limits can still cause queues.

A preparation job builds and stages the pinned runtime, runs the existing
upstream, typecheck, protocol and helper tests, packages one fresh `.app`, and
verifies all package resources against that build. It archives the app with
`ditto`, preserving executable permissions and symlinks. The preview and
versioned updater ZIPs are identical copies of this archive.

Three independent callers (`interface`, `sessions`, `runtime`) then each use
`.github/workflows/macos-acceptance.yml` on a separate native runner. Each freshly
builds its source environment using `.github/actions/setup-macos`, runs its source
inventory, and tests the same candidate downloaded by artifact ID from this run.
The candidate commit and SHA-256 are verified before extraction. This is not a
cross-run build cache or a separately rebuilt package per group. Packaged native
terminal tests run in the runtime group. Checks remain serial within each
runner; a failing group does not cancel its siblings.
`scripts/ci-acceptance.mjs` remains the assignment list, without coverage changes.
Preparation retains its 90-minute limit; each group has a 60-minute limit.
Per-script deadlines and owned-process cancellation rules are unchanged.

The final `ARM64 build, tests and packaged acceptance` check preserves the old
required-check name and runs even after failures. `scripts/ci-macos-policy.mjs`
validates classification and documentation outcomes before choosing its route.
The full route requires exactly preparation plus the three successful groups, distinct artifact
IDs, matching commit/hash, and both complete reports from every group. Every
report must contain the exact ordered assigned inventory, successful results
and no active check. Missing, swapped, duplicate, malformed, partial, failed,
cancelled or skipped evidence cannot satisfy this gate.

Before acceptance the artifact is explicitly named
`macos-arm64-unvalidated-<run>-<attempt>`. Only after the gate validates all reports
is the identical archive rechecked and promoted to
`macos-arm64-preview-<sha>-<attempt>`. Neither artifact is a published Release.
Require the final macOS check separately when macOS protection is desired;
the Windows `CI result` gate is unchanged.

Short animation checks capture product-created CSS transitions at the DOM state
change, or WAAPI effects when created, before a native action's response can
outlast the motion. They require finite running effects, check real intermediate
geometry and restore playback before checking natural completion. Required host,
pseudo-element and descendant effects have distinct identities. Reduced-motion
checks retain their own immediate-state assertions. Run the browser-backed helper
regressions from `Desktop/` with `node --test scripts/motion-helpers.test.mjs`;
the macOS source acceptance step also runs them after Chromium installation.

The `macos-fixture-diagnostics-<group>-<attempt>` artifacts contain the source and package
JSON reports and captured per-script output. Logs use separate paths under
`Desktop/test-results/logs/source/<group>/<script>.log` and
`Desktop/test-results/logs/package/<group>/<script>.log`, so packaged acceptance
does not overwrite source diagnostics. Preparation has its own diagnostic artifact; the job
summary lists artifact-relative log paths. Console stdout and stderr remain
visible while each script runs, and diagnostic artifacts are retained for seven
days, including after failures.

Run dependency-free scheduling and gate regressions locally:

```sh
node --test --test-concurrency=1 scripts/ci-*.test.mjs scripts/windows-ci-summary.test.mjs
```

## November 10 CI Refactoring Baseline

Runs `42642599418` and `42651701558` both passed before this change. Their Windows
interface jobs took about 31m40s and 32m31s; full protocol tests occupied roughly
six to eight minutes in each of three Windows jobs, followed by about twenty
minutes of interface acceptance. Moving shared tests to runtime removes duplicate
work from the longest group's critical path without introducing a common-test
dependency before native groups can start.

This is a scheduling hypothesis, not a measured speedup. Compare the new cloud
run's job/queue time, per-stage duration, total runner-minutes and failures before
claiming an improvement. Sharing complete native build artifacts is deferred
until transfer cost and fixture/native dependency packaging have been measured.

For macOS, the last serial baseline (run `41477155903`) took 47m27s, including about 20.6
minutes of source and 20.5 minutes of packaged acceptance. Compare cloud elapsed
time, queue time, group durations, artifact-transfer cost, failures and total
runner-minutes before claiming a speedup. Parallel acceptance duplicates native
source preparation and can consume more runner-minutes even with lower wall time.

## Local Split Validation (2026-10-13)

On baseline `45ff68e`, actionlint 1.7.12, the 12 CI policy/runner tests, Desktop
typecheck/build and all 344 Desktop tests passed. Structured YAML comparison
confirmed unchanged preparation steps and exact migration of all 41 acceptance
scripts and their per-step timeouts. The new runner then passed all groups
sequentially on one Windows desktop: interface 16/16 (159.3s), sessions 12/12
(221.1s), runtime 13/13 (254.5s). Completion receipts and aggregate policy were
checked against the resulting reports.

These are local fixture results, not a cloud parallel-speed measurement. Local
dependencies and staged runtime `3ba89e0` were reused via junctions; cloud jobs
must each install/build/stage independently. The local build produced about
6.6 MiB in `Desktop/dist` and 16.7 MiB of reports/screenshots in
`Desktop/test-results`. No installer, shortcut change, upstream source edit,
publication or cleanup of existing packages was performed.
