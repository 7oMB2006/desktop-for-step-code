# Upstream v0.1.7 Integration

## Source Identity

Development pin: `29eb460780489801ce8afc8bffc1a2efae7cbded`.
This is the reviewed source baseline associated with the v0.1.7 announcement,
not a verified release tag or a binary/source equivalence claim. The historical
v016 and v015 patch sets and release records are unchanged.

The pin includes the previously carried `7487124e7` and `90a57820c` changes.
The v017 manifest therefore has no upstream overlays. It migrates the existing
19 shared Desktop patches and Darwin additions, with a final compatibility-test/formatting
delta. The production applier checks ordered patch hashes, source preimages and
all postimages, including added files; a failed application rolls back.
Staging rebuilds the agent only after verifying the exact pin and postimages.

## P0 Scope

- Retain Desktop-owned profiles, credentials isolation, narrow preload IPC,
  session import/search, CLM, Workflow, Cron, BTW, background controls, plugin
  exports, template-input provenance and one-shot completion review.
- Keep `--include-live-events` on main/child consumers that require streaming
  frames. Durable session history is not a replacement for live progress.
- Adopt user-only Plan entry and native mode announcements. The old Desktop
  ephemeral user-message injection is removed.
- Keep the existing drawer, local refinement draft, drag dismissal, reopen,
  cancellation and expiry behavior. The Desktop adapter records the native
  pending proposal hash before waiting; cancellation and expiry cannot approve
  or release automatic starters. Decisions check the reviewed snapshot and
  active branch before restoring mutations.
- Preserve upstream's native summary policy, search fixes and incomplete-turn
  recovery. New compaction settings and richer outcome/error presentation are
  separate TODO stages, not bundled UI promises.

## Plan Transport

Main workers opt into `--desktop-plan-review` and `--plan-review-surface`.
Native upstream exposes the latter plus `/plan approve [hash]` and persisted
pending state; it does not expose a structured `plan_review` UI RPC at this pin.
The compatibility adapter intentionally retains Desktop's select/input bridge
inside `exit_plan_mode`, while using native pending state, state transitions
and collaboration-mode prompts. It does not restore the removed entry tool.

Approval is a user decision (`approvalSource: "user"`); RPC child handoffs
remain external decisions. Closing or timing out the drawer ends its request,
not approval. A later ordinary question keeps planning active. Fresh review
still requires resubmitting the current proposal. Command execution retains
normal permissions, so Plan is not a comprehensive read-only sandbox.

## Result Presentation

The Desktop outcome stage reads validated `details.execution` and
`details.thenRun.execution`. Process exit, timeout, signal, cancellation and
unknown outcomes are separate from tool invocation errors. Structured status
is authoritative over redundant flags and legacy check fields. Legacy
`thenRun` metadata remains supported; imported tool history keeps its own
provenance. Command output text is not parsed to invent an execution outcome.

Final applied patches remain in the existing turn-change surface even when
the surrounding call fails after mutation. Pending results and imported
records do not become applied changes; missing snapshots are not synthesized.
No-op mutation receipts do not create partial-diff warnings.

An assistant's native `incomplete` classification prevents a provider `stop`
from being treated as success. Once incomplete recovery is observed, ownership,
timing and completion notification wait for `agent_settled`, including all
intermediate `agent_end` events and recovery starts. Queued work does not drain
in the recovery gap; final failure pauses it. Explicit cancellation takes
precedence. Recovery prompts remain hidden, and the original provider stop
reason is retained. Desktop does not initiate another recovery or rerun tools.

## Acceptance Boundaries

Source patch replay and Windows local simulated-provider tests do not establish
native macOS behavior, real-model quality, installer upgrades or release
readiness. Exact completed checks and remaining gates belong in
[VERIFICATION.md](VERIFICATION.md). No application version bump or public
release is implied by changing the runtime source pin.
