# Background Agent Controls

The existing Subagents inspector now has a Background view alongside
Orchestration and Agent records. This is current-runtime control, not the
saved Workflow catalog and not a new conversation with a child agent.

## Data And Ownership

- Electron owns `backgroundAgents(runtimeId, sessionId)` and
  `stopBackgroundAgent(runtimeId, sessionId, laneId)` through the typed preload.
  Both require the exact connected worker and session, with no destructive
  account/history/runtime transition in progress.
- A narrow `desktop_subagents` RPC invokes the registered native `agent_send`
  tool for `status` or `stop`. It does not submit a prompt, invoke a model,
  append a conversation message or grant arbitrary tool access. Reply is
  deliberately not exposed.
- Reads are coalesced per worker/transport/session. Pending operations retain
  the host; identity and transition guards are checked again after the reply.
  Stops have per-lane duplicate protection and no automatic retry.
- The original live `desktop-subagents` snapshot remains the only authority
  for background ownership. Historical messages and the display query never
  establish that a process is still running. Disconnect/suspend clears the
  lane roster. Ordinary parent prompts remain available while children run;
  existing account/history/restart/recycle protections remain unchanged.

## Presentation

The rail's activity indicator uses only the current transport's validated
native lane count (plus the existing Workflow activity). An active background
host opens the Background tab; recorded calls retain the original inspector,
with an explicit foreground/background label and a background-detail shortcut.

Rows show task summary, native status and supplied duration. Shared animated
native disclosures expose steps, model, turns, token/cache usage, current tool,
errors and output excerpts. Missing values are unknown, not fabricated zeroes.
The panel refreshes every 1.5 seconds only while open, connected and selected;
native state changes trigger an immediate refresh. Manual refresh remains
available after errors. Failed reads retain labelled stale rows and disable
stopping. Switching runtime/session resets the display and ignores old replies.

Production and the visual preview share the role presentation component.
Known native role names receive role labels and output headings; the raw agent
name stays visible, and unknown roles use the generic output layout. General
agents remain labelled General rather than Custom. Output stays native Markdown;
the renderer does not infer structured findings, test verdicts or changed files.
Runtime metrics sit in a default-collapsed disclosure. Parallel and chained
steps retain their individual role, ordinal and task.

Each task header has a sibling Agent details button, available without expanding
the task. Single-step tasks open directly; parallel and chained tasks use the
shared anchored menu to choose a step by lane ID and native step index. Details
follow the same current-runtime snapshot and polling owner, not a guessed
transcript match. Returning restores the mounted list's disclosure state,
scroll position and originating button focus. If a selected step leaves the
snapshot, an explicit missing-record message replaces it, never another agent.
These details remain read-only excerpts; stop still targets the whole lane
from the Background tab.

Read limits are 24 lanes, 64 steps in total, 32,000 output characters in total
and 12,000 per step. Native omitted-step counts are preserved. Credential-like
lines are redacted before clipping, both in the runtime projection and the
main-process renderer projection. The main-process service requires the staged
`desktop-subagent-redaction` capability before list or stop, preventing a
control-only runtime from supplying output whose identifying prefix was already
clipped away. If an internal live-output bound starts in
the middle of a line, that unknown first fragment is omitted before display;
later complete lines remain available. Encoded credential labels are detected
in the Electron projection. Task, agent, model, error and output text share the
same safe display boundary, including list previews, menus, details and
accessibility labels. Child transcripts, paths, environments, tool arguments
and raw usage/cost objects are not exposed by this RPC.
The runtime retains at most its 16 recent finished lanes; older transcript
records remain in the existing read-only Agent inspector.

## Historical State And Current Activity

Native `agent_send` tool results carry an array of lane snapshots; the transcript
projection consumes those validated rows in message order, retaining support for
older object-shaped details. A follow-up may reopen the same lane without
changing its original dispatch identity. Unknown lane IDs and malformed rows do
not acquire that identity, and tool-result prose is never parsed as a status.

Historical dispatch records do not own a process. The runtime-summary bridge
supplies a bounded current lane roster from validated live status events, or a
separate read-only observation when unresolved history is loaded. Observations
never modify live ownership. Transport/session changes and newer lifecycle
events invalidate them; failed or unavailable reads do not become empty rosters.
Only a validated current roster revises the display: a known empty roster marks
unresolved historical running/queued records as unknown outcomes, never
completed/failed/stopped tasks. When the current roster is unavailable the
history-derived status persists unchanged, because "not observed yet" cannot
claim that a lane stopped; it also never fabricates a terminal result. Chat,
selected Agent records and summary share that projection, while previously
returned terminal results and completed multi-step steps remain intact.

Moving a conversation checks the source and prepared destination host against
live ownership, the native current registry, and existing task/queue/Cron guards.
Unresolved old history alone does not prevent moving an idle conversation.
Current running/settling ownership, failed registry verification and unsupported
runtime capabilities still block movement. Nothing resumes a child, rewrites its
saved outcome, or adds a reply UI as a fallback.

## Stop Semantics

Stopping requires an inline confirmation. It stops the selected native lane,
which can contain a single child, parallel children or a chain. It is not a
stop for one individual step of such a lane.

An acknowledgment means the request was accepted, not that the child has
exited. The UI remains in a settling state until the native handoff releases
it. A timeout or unconfirmed response has an explicit unknown outcome and is
never retried automatically. The parent, other lanes, queue and account route
are not changed.

## Local Verification

`background-agents.test.ts` covers projection bounds/redaction, encoded free
text, missing data, coalescing, stale session/worker/transport replies, transition
guards, per-lane stop locks and native settlement. The real pinned runtime test adds
two concurrent lanes, read-only/no-model queries, rejected unsupported controls,
targeted stop while the parent runs, peer completion and filtered native output.

`verify-background-agent-controls.mjs` exercises the actual Electron bridge
and RPC with an isolated loopback model, plus explicit read/stop fault
injection. A live child streams an oversized credential-bearing first line;
the typed snapshot and rendered detail retain the safe tail without the clipped
credential fragment. It covers confirmation/cancel, stale rows, no retry, reload, parent
and peer continuity, actual session navigation with a delayed outgoing read,
read-only detail navigation, return focus/scroll, live completion, missing
steps, narrow light/dark focus gutters and reduced motion.
It is registered in the shared Windows/macOS runtime acceptance inventory.

`verify-background-history-liveness.mjs` exercises a real saved conversation,
current-registry reads, unknown chat/Agent/summary presentation, relocation
without changing the historical dispatch, and refusal to relocate a real running
child. The runtime tests also cover a native `agent_send` follow-up and stopping
then reopening the same saved session. Native startup may append resource
discovery entries; pre-existing journal entries are preserved byte-for-byte and
subsequent registry observations do not append or rewrite them.

`tests/fixtures/background-agents.html` uses the production inspector with
sample data. It is a visual preview, not real-account acceptance. Native macOS,
cloud CI, installer and real-account verification remain separate.
