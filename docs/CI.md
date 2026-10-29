# Pull Request CI

Every pull request starts `PR CI`. The workflow classifies the complete change
against the pull request's merge base, then selects one of two routes:

- Documentation-only changes run `Documentation checks`, which uses
  `git diff --check` to check whitespace errors and conflict markers in added
  lines. It does not validate Markdown rendering, remote links, or release facts.
- All other changes run three independent Windows groups: `Windows interface`,
  `Windows sessions`, and `Windows runtime`. Every group builds the pinned
  upstream, applies the current integration patch, stages runtime, and runs the
  upstream tests, typecheck, unit/protocol tests and application build.
  Electron acceptance is split between groups but remains serial within each
  runner. A failure stops its group; the other groups are not cancelled.

The documentation allowlist lives in `scripts/ci-policy.mjs`. It includes the
root README files, TODO, DESIGN, PRODUCT, explicitly named documentation pages,
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
If branch protection is configured, require the unchanged `CI result` name
rather than conditional jobs.
An old required `Windows integration` check must be replaced by `CI result`
when adopting this workflow.

Policy and inventory regression tests run before classification on every pull
request. The runner tests also run on each Windows job, including owned-process
tree cancellation. Run them locally without installing Desktop dependencies:

```sh
node --test scripts/ci-policy.test.mjs scripts/ci-windows.test.mjs scripts/windows-ci-summary.test.mjs
```

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
The helper filenames also stay outside the macOS workflow's path filters.

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

Each `macos-15` job runs on its own GitHub-hosted virtual machine, as described
in [GitHub's hosted runner documentation](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners).
Different pull requests do not run their jobs on one repository-wide VM.
Simultaneous failures alone do not establish CPU or memory contention between
pull requests. The concurrency group includes both `github.workflow` and
`github.ref`: different pull requests do not block each other through this
group, while `cancel-in-progress: true` cancels an older run superseded on the
same ref. GitHub runner availability and account limits can still cause queues.

One native job builds and stages the pinned runtime, runs typecheck and protocol
tests, then executes the full serial inventory against the source build and
again against the packaged `.app`. Packaged native terminal checks follow.
`scripts/ci-acceptance.mjs` defines the current inventory; no separate script
count is maintained here. The job has a 90-minute timeout and retains the shared
per-script deadlines and owned-process cancellation rules.

Short animation checks capture product-created CSS transitions at the DOM state
change, or WAAPI effects when created, before a native action's response can
outlast the motion. They require finite running effects, check real intermediate
geometry and restore playback before checking natural completion. Required host,
pseudo-element and descendant effects have distinct identities. Reduced-motion
checks retain their own immediate-state assertions. Run the browser-backed helper
regressions from `Desktop/` with `node --test scripts/motion-helpers.test.mjs`;
the macOS source acceptance step also runs them after Chromium installation.

The `macos-fixture-diagnostics-<attempt>` artifact contains the source and package
JSON reports and captured per-script output. Logs use separate paths under
`Desktop/test-results/logs/source/<group>/<script>.log` and
`Desktop/test-results/logs/package/<group>/<script>.log`, so packaged acceptance
does not overwrite source diagnostics. The workflow uses group `all`; the job
summary lists artifact-relative log paths. Console stdout and stderr remain
visible while each script runs, and diagnostic artifacts are retained for seven
days, including after failures.

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
