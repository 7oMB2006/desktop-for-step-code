# Pull Request CI

Every pull request starts `PR CI`. The workflow classifies the complete change
against the pull request's merge base, then selects one of two routes:

- Documentation-only changes run `Documentation checks`, which uses
  `git diff --check` to check whitespace errors and conflict markers in added
  lines. It does not validate Markdown rendering, remote links, or release facts.
- All other changes run the full `Windows integration` job, including the pinned
  upstream build, runtime staging, typecheck, unit/protocol tests, application
  build, and Electron acceptance scripts. Each check has its own step; execution
  order and failure behavior are preserved.

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
passes only when classification succeeded, the selected job succeeded, and the
unselected job was skipped. Missing outputs, classification errors, failures,
cancellations, and unexpected skips cannot produce a successful result. If
branch protection is configured, require `CI result` rather than either of the
conditional route jobs.

Policy regression tests run before classification on every pull request. Run them
locally without installing Desktop dependencies:

```sh
node --test scripts/ci-policy.test.mjs
```

Windows acceptance remains serial within one job. Parallel Windows jobs and
build/runtime artifact transfer are intentionally outside this change; individual
step durations can inform a later split. No installer build is required for a
CI-only change. Real model and release acceptance still follow `VERIFICATION.md`.
