# v0.1.6 Development Integration

## Source Identity

The development pin is `81e79bc4b699148d6823fedde9b5e70d9a80255f`, the
public source baseline associated with the October 23 v0.1.6 announcement.
The official `0.1.6/manifest.json` identifies version 0.1.6 and artifact hashes,
but does not provide a source SHA. This is not an official Git release tag or
a claim that the source build is byte-identical to an official binary.

`patches/v016/manifest.json` pins 13 shared patches and their source pre/post
images, with two additional Darwin patches. `patches/v015/` and dated 0.6.0
release records remain unchanged. The applier supports both manifests.

## Compatibility

- Preserve Desktop-owned configuration, credentials and sessions. No personal
  Step Code profile is imported or used as a fallback.
- Preserve Plan approval identity, Cron scope/recovery, CLM RPC, plugin exports,
  session import and automatic-continuation provenance.
- Session import uses upstream's native `SessionFilePersistedEvent` type.
  The new session-index service remains upstream-owned; search UI is separate.
- The Node ESM bundle supplies module-relative CommonJS filename globals for
  dependencies such as the Lark SDK, without embedding build-machine paths.
  Fixing CLI startup does not enable a Desktop Lark connection workflow.
- Staging checks the activity, session-index and image-resize worker artifacts.
  The copied-bundle probe requires a working SQLite index, not JSONL fallback,
  and exercises usage totals, cache, cancellation and session search.

## Background Ownership

The lane lifecycle publishes an internal RPC `setStatus` snapshot under
`desktop-subagents`: `{ version: 1, parentActive, lanes: [{ id, status }] }`.
Only active lanes are included. `running` owns an executing lane; `settling`
retains it through final-notification delivery. Generation checks prevent a
retired completion from clearing a newer turn's pending final notification.

`parentActive` carries the native handoff into the parent turn, including
pre-prompt CLM before `agent_start`. Desktop keeps the host busy during this
gap; `agent_settled` also releases a wake-up cancelled before model execution.

Desktop treats foreground idleness and background ownership separately:

- Ordinary foreground input is still allowed while a lane runs.
- Account/provider application, runtime restart, history mutation and manual
  compaction cannot silently invalidate active background work.
- Idle/count-based recycling retains the owning host across navigation.
- Quit review includes the host as an active task. Suspension/disconnection
  clears live ownership; loading old history never revives a task.
- A parent response that merely delegates work does not emit task completion.
  The final successful parent response uses the existing per-run deduplication.
- Malformed/unknown live snapshots retain protection until valid state or
  transport disposal; these internal payloads are not rendered as status text.

The existing transcript projection continues to update each original lane by
identity. New lane-management controls, Workflow catalog UI, full-text search
UI, `/btw`, recent models and Lark UI are not included in this workstream.

## Acceptance Boundary

See [Verification](VERIFICATION.md) for actual runs. Windows local tests,
Darwin patch replay on Windows, native macOS CI, an installed package and
real-account acceptance are separate evidence. No package or release is
created by this integration.
