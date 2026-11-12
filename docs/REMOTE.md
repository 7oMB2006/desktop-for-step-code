# Desktop Remote

## Scope

The first integration is a Desktop-hosted Feishu channel, not a standalone
service. Desktop must remain running and its host must stay awake and online.
Closing the window to the tray is different from quitting the application.
The independent Remote page is opened by the phone icon immediately to the
right of Settings; channel selection and channel configuration are separate.

This Desktop Beta supports one locally authorized human private chat with a
locally approved project scope and a separately selected current session.
It supports remote session listing, selection and creation, text and opt-in image input,
bounded assistant-text cards, explicit workspace image delivery, task stopping,
known one-time tool permission confirmations, structured questions and Desktop
Plan review/refinement. It does not expose a Web URL, public
listener, tunnel, mobile application, group chat, arbitrary file transport, remote
login, arbitrary extension forms, permission-tier changes or project trust.
It does not fulfill the separate self-hosted Windows/Linux Web Remote TODO.

## Connection And Binding

1. Open Remote, choose Feishu and explicitly start pairing. The authorization
   link is opened by a separate user action in the system browser.
2. After platform authorization and the socket's readiness handshake, generate
   a two-minute verification code. Send it to the bot in a private chat.
   A matching code receives an `OK` reaction on that message. If reactions are
   unavailable, a pending-confirmation card provides the acknowledgment instead.
   This only confirms the code match, not permission to access a session.
3. Choose an idle starting session (including saved Desktop history), review
   the allowed projects and confirm the received candidate locally. The starting
   session's project is required; additional known projects are opt-in.
   Each authorization is limited to twenty projects.
   Authorization alone never grants chat access, and an arbitrary first message
   cannot claim the authorization.
4. Configure card callbacks through the official platform link and send a
   verification card. Its button only tests callbacks; it approves no tool.
   A connected message socket does not establish callback readiness.

After authorization, credentials are encrypted with Electron `safeStorage` in
`userData/remote/connection.dpapi`, separate from model credentials. Confirmed
chat identity, project scope, current session ID and stable session-handle map are saved there too. Normal
quit, update installation or an application restart retains this snapshot.
Reopening Desktop revalidates the bot and projects, creates a fresh binding,
and prepares only the selected saved session in Ask without activating its local
view or sending inference. No standalone process runs while Desktop is closed.
The first version without persistence still needs one final pairing after
upgrading; an already-lost in-memory connection cannot be recovered.

Manual Disconnect (including `/disconnect`) removes the local saved connection
and requires pairing again. Unbind removes only chat/project access, retaining
the bot connection. Neither operation revokes the app on Feishu's platform.
Unavailable encryption or invalid ciphertext affects only Remote, with a visible
storage error and no plaintext fallback. A moved/unavailable project requires
fresh access confirmation; an unavailable session leaves no selected target,
never a replacement chosen implicitly. Fatal transport errors retain saved
credentials for a deliberate Retry.

Disconnect revokes routing and approvals immediately, but retains ownership of
an unconfirmed helper shutdown. Concurrent shutdown calls share the in-flight
stop; a failed stop is retried against that same transport. Until cleanup and
the remaining disconnect work finish, neither pairing nor automatic restoration
may create a replacement helper. This barrier does not restore the old binding,
accept late input or treat a failed process-tree termination as success.

The confirmation allows listing session titles and selecting or creating
sessions in the approved projects. Future assistant replies in attached
sessions are forwarded, including locally initiated rounds. Existing transcript history,
thinking blocks and raw tool results are not forwarded. Files are not exported
merely because a reply mentions them. Images require the separate opt-in below. A response
may intentionally describe local information, so use a suitable session and do
not treat redaction as a general data-loss-prevention system.

The helper retains the exact sender and private-chat identity and one fresh
authorization ID. Main separately retains each attached runtime ID, session ID,
worker object and RPC object. Changing the locally viewed session never changes
the remote target; remote selection never changes local focus or drafts.
Replacing/disconnecting one worker invalidates that target, not the private-chat
authorization or other targets. At most eight runtime targets remain attached.
Opening another target may release an older idle, noncurrent attachment, never
a running or waiting one. Its saved conversation remains available for selection.
Attached hosts are not reused for a new session or recycled as idle workers.
History changes and runtime replacement still require unbinding first.
Non-restarting executable-plugin and runtime-configuration writes may retain
healthy, idle attached targets. Their shared runtime write barrier refuses new
Remote input and approval responses until the operation finishes; rejected input
is not queued or retried. Active tasks, queued messages, pending approvals, Goal,
side questions, background work and scheduled resource use remain protected.
Connection observations and worker/RPC/session identity are revalidated before
writes, including when process exit automatically clears a Remote attachment.
Remote does not gain authority over unrelated files, and saving configuration
does not mean an existing worker has hot-applied it.

Marketplace maintenance uses a separate management lease, not the runtime
settings lock, so it does not detach targets or block Remote input/approvals.
Data-only theme installation, replacement and removal can also retain targets
after host-side package proof and resource checks. Theme selection is a
renderer preference, not a runtime restart. Unknown capabilities or occupied
resources fail closed. Catalog/document/configuration reads never recover an
interrupted plugin update; recovery separately checks the journal's actual
plugin and revalidates its identity before writes. Unconfirmed management
worker cleanup quarantines further management writes instead of retrying them.
An unconfirmed executable writer or unfinished admitted runtime recovery also
keeps runtime input blocked for the rest of the process; a clean worker exit
alone does not prove that its on-disk update was recovered.

## Feishu Commands

These are Desktop-owned private-chat text commands, not upstream TUI commands
or a provisioned Feishu-client command menu. Pairing sends an initial help card.
Unknown commands and invalid arguments are rejected, never sent to the model.

| Command | Behavior |
| --- | --- |
| `/help` | Show this command set and local-only boundaries. |
| `/sessions [p1] [page]` | List ten authorized sessions per page, optionally in one project, without loading history or starting runtimes. |
| `/session <s1>` | Select a stable session handle or exact known session ID for future messages. |
| `/new [p1]` | Create a new session in an authorized project; default to the current project. |
| `/projects` | List the locally approved project handles, display names and session counts. |
| `/current` | Show the current remote target. |
| `/status [s1]` | Show execution, model, effort, permission and queue state without loading a cold session. |
| `/tasks` | Read-only overview of authorized resident sessions; attention first, no cold runtime startup. |
| `/sharing` | List sessions forwarding future output, separately from the current input target. |
| `/detach [s1]` | Stop one session's forwarding without stopping local work or removing accepted queue entries. |
| `/stop [s1]` | Stop only the matching task observed when accepting the command. |
| `/disconnect` | Disconnect and forget the local connection without stopping accepted local queues or tasks. |

The `/tasks` card uses the Desktop language instead of repeating every line in
Chinese and English. A separate input-target note precedes attention and
in-progress groups; each row keeps its literal session name, typed state,
nonzero queue count and exact saved-handle commands together. An empty result
has a short empty state and `/sessions`, not a fabricated `s1` task shortcut.
At most eight complete rows are shown, attention first, with omitted sessions
explicitly counted. This is a read-only snapshot, not a continuously updated
dashboard, and does not start or attach other resident sessions.

Aliases: bare `/session`, `/list`, `/switch <s1>`, `/session list [p1] [page]`,
`/session switch <s1>`, `/session new [p1]`, `/session current`.
Session and project handles last for the locally confirmed authorization,
including normal quit/relaunch and transport recovery. Session handles are saved
with the encrypted connection; removed conversations leave reserved handles rather
than recycling them. At most 10,000 session handles are retained per authorization.
Unbinding and explicitly pairing again starts a new authorization. Older saved
connections without a handle map must explicitly request `/sessions` before short
handles can control sessions; previously displayed numbers are not silently used.
New short handles are published and accepted only after their mapping is saved.
If storage fails, confirmed handles remain usable; selected/new-session feedback
uses the exact session ID until a save succeeds. Failed provisional mappings
cannot become confirmed merely through a same-process transport retry.

Session lists use a project-to-session tree: `p1` is a locally granted project,
with its `s1`, `s2` session entries beneath it. The current session is explicitly
marked. Project headings use the Desktop display name when available, otherwise
the directory name, and show the total session count across pages. Same-named
granted projects include distinguishing path suffixes. The list header always
identifies the current project/session, even when it is on another page or outside
the project filter. Empty known projects remain visible on page one with a
`/new pN` entry. Known projects are separate from their non-archived conversations,
so archiving the final conversation does not revoke that project or prevent its
first new conversation.
Lists fit within the system card's 5,000-character body budget. If necessary,
project names are shortened in the middle while preserving distinguishing path
suffixes; the current-target header, session handles and command hints are not
discarded by tail clipping.

Each unfiltered/project-filtered list uses its own in-memory pagination snapshot.
Later pages retain the same membership and order; `/sessions` or `/sessions pN`
refreshes that list from page one. A vanished snapshot entry cannot bypass the
live session/scope check on selection. Pagination may repeat a project heading
but never reassigns session handles. This is not a
filesystem browser or recursive project grant: nested directories and same-named
projects remain separate, explicitly authorized handles.

Selecting cold history and creating a new session use non-activating runtime
preparation. They do not send inference or consume local composer/Goal settings.
Cold/new hosts start in Ask; existing connected hosts retain their effective
configuration. Project trust, login, model/permission changes and arbitrary
upstream slash commands remain local. Remote commands cannot name an arbitrary
filesystem path, create a project or broaden their authorized project scope.
Canonical directory checks reject redirected workspace targets before startup;
equivalent path spelling retains the exact local grant after preparation.

Each accepted input retains its ordered selection barrier. Switching affects
only later inputs; it does not reroute accepted messages or stop older work.
Failed or malformed selection/creation attempts mark the target unconfirmed.
Later text and images are rejected, not cached or delivered to the previous
target, until an explicit selection/creation succeeds. Read-only commands do not
implicitly confirm a target. `/detach` of the current target also requires a
new explicit selection. Detaching a noncurrent session leaves the input target alone.
Replies identify their source session. Older attached sessions remain stoppable
with `/stop s1` and retain exact-request approval tokens after switching.
Working cards do not create Stop buttons; old Stop-card callbacks are ignored.
Selecting an already running resident observes its continuing task and known
pending tool approvals immediately, without backfilling existing prose.

## Process And Permission Boundaries

- Electron main owns the agent, message queue, session routing and approvals.
  The renderer has only typed `remoteState` / `remoteAction` IPC and receives no
  Feishu credentials or authorization URL.
- A separate Node helper owns the SDK socket and in-memory Feishu credentials.
  It does not launch a second agent or receive the model's API keys, transcript,
  personal Step Code profile, or arbitrary parent environment. Only the platform
  executable/temp variables and explicit HTTP proxy variables are inherited.
  Process separation is not an operating-system sandbox.
- The main process alone encrypts/decrypts the narrow saved connection; private
  helper responses carry credentials only to main, never renderer events or
  child-process environment. Ordinary quit destroys the helper but retains the
  encrypted snapshot. Manual disconnect deletes it; normal uninstall removes
  it and update installation retains it. Same-user malware is outside this
  at-rest protection boundary.
- The known native permission `confirm` envelope, tied to the exact pending
  tool call and runtime, becomes an Allow once / Deny card. For `clarify_user`,
  that permission card instead says Allow question / Deny question: it only
  permits asking, never selects an answer or authorizes workspace mutation.
  Actionable permission cards recover the complete, redacted tool input from that
  call, not the upstream's shortened summary. Unrecoverable inputs and details
  exceeding the card's 5,000-character limit stay local rather than offering
  approval for clipped content. Existing native permission policy still applies.
- A known structured Desktop clarification becomes a native answer form only
  while its exact `clarify_user` call is pending. It preserves the original
  question IDs and option values, supports 1-12 questions with at most eight
  options each, and limits each permitted custom answer to 1,000 characters.
  Nothing is preselected; incomplete, conflicting or oversized answers cannot
  settle the request. Cancel is explicit and never implies an answer.
- Desktop Plan review offers Approve plan, Request refinements and Keep planning,
  with the complete bounded proposal. Approval alone may exit Plan; refinement
  opens a feedback form and does not approve implementation. The exact pending
  `exit_plan_mode` call and native reviewed-snapshot gate still apply.
  Unknown extension forms, login, project trust and permission-level
  acknowledgments stay local. Oversized or malformed known forms also stay local.
- Both ends answer the same pending request. The first valid response wins.
  Remote tokens are opaque, single-use, bound to the chat, valid for at most ten
  minutes, and revoked on local completion, expiry or unbinding. A token never
  grants a standing permission or answers a replacement request. The complete
  request and exact live tool call are revalidated before any remote response.
  Expired or handled cards lose their inputs/buttons and show their state.
  `/status s1` can refresh only the exact original request if it remains pending,
  with a fresh single-use token on the same card. It cannot revive an answered,
  replaced or changed tool request.

## Delivery And Lifecycle

Remote text uses the existing Desktop pending-message queue and the session's
effective model/account configuration. It does not change billing mode, consume
local one-shot composer selections, or launch a Goal. Pending local approvals,
armed/active Goals, failed/interrupted workers and configuration transitions can
reject remote input rather than silently recover or resubmit it.

Accepted model input receives a `Typing` reaction on the original Feishu
message, not a separate Received card. Main associates it with the exact local
queue receipt ID. Ending a run clears reactions only for inputs delivered to
that run, leaving later queued messages marked. Queue withdrawal, dispatch
failure, interruption, worker disposal, unbind and orderly disconnect clear
the corresponding outstanding indicators without replaying or canceling local
work. A slow add response is followed by removal of that exact returned
reaction ID if completion has already arrived. Reaction errors never retry
model work; failed removals can retry when the socket reconnects. Indicators
are transient, never persisted, and abrupt process termination or an unavailable
platform can prevent best-effort removal.

Received, queued, dispatching and unknown receipts are separate. `/status`
reports observed receipt counts and typed blockers; it never infers login or
approval state from arbitrary dialog prose. Reactions are a best-effort
processing indicator, not proof that a queued input has begun executing.
Recalling the sender's exact message removes only its never-dispatched queue
entry, including while its image download is pending. Other senders, local
queue entries and already-dispatched/uncertain input are not withdrawn. Recall
does not roll back a running task and never implicitly issues `/stop`.

Inbound text is limited to 12,000 characters; only the command whitelist above
is accepted for leading slash input. Text, image messages and rich-text posts
with text and up to five images are supported; other content receives bounded
unsupported-content feedback from the authorized private chat.
The pinned upstream gate validates message age
and deduplicates eligible IDs. Main adds bounded, connection-local deduplication
and queue limits. This is not durable exactly-once delivery across restarts.
On restored bindings, messages timestamped at or before recovery are rejected
rather than replayed. Offline input is not a durable queue. Approval readiness,
tokens, run IDs, output cards, attached workers and pending tasks are never saved.
Old approval buttons and obsolete Stop callbacks cannot act on a restarted process.

Assistant text is coalesced into updates to one card per round, with a bounded
5,000-character visible budget. Truncated replies explicitly identify that only
the tail is visible; the full answer remains in Desktop, with no remote paging
or task rerun. Normal replies use JSON 2.0 Markdown components for headings,
lists, tables, inline code and fenced code, splitting after four tables per
component. Model-supplied raw HTML, mentions and embedded images are rendered
literally instead of invoking platform features; non-HTTP(S) links are disabled.
Explicit native image delivery remains separate. Replies show a
small plain-text session-source footer, without Working or Completed headers.
Before text arrives, the same card shows a replying placeholder; an empty
finished response explicitly says that no text was returned. Interrupted
responses retain their partial body and an interruption note, never a success
label. Approval and system notices retain literal text and meaningful headers.
Known credential-shaped strings are redacted;
this cannot identify every possible secret in generated prose. Thinking and
tool payloads are excluded. Actual tool execution events produce one bounded,
coalesced category/count line on the same reply card. Results arriving are not
reported as passing tests or task completion; missing/cancelled/failed receipts
remain distinct. Only authoritative task completion settles a reply;
failures and user cancellation are not successes. A delayed `/stop`
cannot stop a later round.

Socket reconnection pauses remote input and retains the current binding while
Desktop work continues. Reconnection reports the current selection and warns
that offline input is not replayed and missed replies may not be recovered.
An application restart instead reports restored connection/selection only,
not restored execution, queues or approvals. Fatal connection errors release all targets and the helper,
not the local task. Disconnect/unbind immediately fences old events and tokens.
Already accepted queued messages and running tasks remain in Desktop; unbinding
is not a stop or queue withdrawal operation. Card-delivery failures are shown
locally and do not retry model work. Ambiguous card POST failures are not retried
automatically, since their receipt may be unknown. Missed output is not a
durable replay log. Quitting Desktop also stops its hosted agent runtimes.

## Image Input And Delivery

Image access is a separate local checkbox during binding or in Access scope.
Old saved grants default to disabled. New grants become usable only after
successful storage; revocation immediately blocks new input/download results
and pending outgoing sends. Failed storage is visible and must be retried or
the connection explicitly disconnected before relying on restart behavior.

Supported types are PNG, JPEG and WebP, at most five input images, 10 MiB per
image and 32 MiB total input. Both processes validate actual bytes, bounds and
sequential 24 KiB chunks instead of putting oversized base64 into JSONL.
Input requires a model declaring image support. The applied model is checked
again when queued image input dispatches; an incompatible change retains the
draft and pauses the queue instead of silently omitting its images.
Downloads are tied to the exact accepted private-chat message image keys.
Partial downloads never enqueue partial prompts. Transfer state is memory-only,
bounded and cleared on cancellation, recall or binding changes.

`desktop_send_image` is a normal runtime-permission tool, not auto-allowed.
It uses the authenticated per-worker sessions broker and requires image opt-in
plus that worker's active attached Remote run. Only explicit regular image files
canonically inside its workspace are allowed; traversal, network/URL paths,
symlink escapes, replaced files and arbitrary neighboring files are rejected.
The helper uploads and sends a native Feishu image message, rechecking the
captured chat/session scope after asynchronous boundaries. Upload success alone
is not delivery; uncertain message sends are never retried automatically.
An optional caption (maximum 500 characters) is a separate literal card only
after image delivery is confirmed; caption failure does not resend the image.
Switching the input target does not reroute a running session's image delivery.
No history-image export, arbitrary file download or extra completion notification is added.

## Staging And Automated Verification

The browser chat fixture drives the same `remote-manager-core.ts` as Electron,
with a synthetic host, Feishu gate/transport and deterministic workload only.
The production wrapper retains Node crypto/path operations; encrypted storage and
Node/Electron APIs are not included in the browser fixture. Commands, selection
barriers, handle allocation, approval tokens and disconnect fencing are not
independently reimplemented in a presentation reducer. Local simulated jobs may
continue after disconnect, but no further cards or approvals are delivered.

`Desktop/scripts/build-remote-adapter.mjs` bundles the unchanged
`packages/lark-adapter` from pin
`81e79bc4b699148d6823fedde9b5e70d9a80255f` with its locked Feishu SDK 1.76.0.
It rejects a different pin, modified adapter sources or an unexpected SDK.
`stage-runtime.mjs` includes this step. The existing whole-runtime packaging
rule includes the helper, adapter and bundled dependency notices. No runtime
pin upgrade or change to the upstream checkout is part of this feature.
Desktop-owned form/card helpers and the bundled Markdown parser are staged
alongside the adapter and load offline, without exposing Node to the renderer.

From `Desktop/`, with the fixed runtime staged:

```powershell
corepack pnpm typecheck
corepack pnpm exec tsx --test --test-concurrency=1 tests/*.test.ts
corepack pnpm build
node scripts/verify-remote-access.mjs
$env:PLAYWRIGHT_CHANNEL = 'msedge'
node scripts/verify-remote-access-preview.mjs
```

The Remote Electron verifier is registered in the shared runtime CI group. It
uses the real staged SDK/helper for offline loading and gate checks, then an
isolated fake network helper and loopback model provider for the complete
Desktop route. Injection exists only in the test process; production has no
fake-transport environment switch. Unit tests cover the helper through an
injected SDK boundary. These checks never authorize Feishu, call a paid model
or send user content to an external chat.

The earlier `tests/fixtures/remote-access.html` remains an interactive design
preview with illustrative data, not proof of a working platform connection.

### Local Chat Simulation

Run `node scripts/preview-remote-chat.mjs` from `Desktop/` to open the local
`tests/fixtures/remote-chat.html` chat fixture. It supports editable simulated
messages, normal/empty/interrupted replies, pairing acknowledgment, approvals,
two-stage questions, Plan review/refinement, Markdown tables/code,
pause/speed/completion controls and an illustrative old-layout comparison.
The fixture reuses `remote-card.mjs` for the outgoing card document and the
production `remote-manager-core.ts` for slash commands, selection, receipts and
approval capabilities. Its host catalog, job execution and Feishu-like HTML
shell remain synthetic, not live account/runtime operations.
The simulated reaction appearance and Markdown renderer are approximations,
not Feishu's actual renderer. No external messages, credentials, model requests
or platform authorization are involved.

`verify-remote-chat-preview.mjs` starts and stops its own Vite server and browser.
It is explicitly registered as local-only UI acceptance, not a substitute for
the production Remote verifier or real platform acceptance.

## Manual Acceptance Still Required

Use a test bot/private chat, a disposable project and an Ask session. The owner
must explicitly perform real platform authorization; automated tests do not.

1. Cancel authorization, retry, authorize and confirm that message transport
   and card callback readiness are reported separately.
2. Verify that the wrong/expired code, another human, a group and another chat
   cannot bind or control a session. A correct code must receive a reaction or
   pending-confirmation fallback, without authorizing access before Desktop
   confirmation. Confirm that no old transcript is sent.
3. Authorize one test project with starting session A, view session B locally,
   and send a harmless text request remotely. List saved history, switch to it
   and create a session with `/new`. Check that selection/creation alone sends
   no inference, that the effective account/model is correct, and that B and
   its draft remain unchanged. Sessions/projects outside the local grant must
   neither appear in lists nor accept selection or creation. Accepted input
   should gain a processing reaction on the original message, not a Received
   card; the reaction should clear after the matching input finishes. Check
   Markdown replies with a small session footer, no Completed heading, one
   updated card per round, and explicit interruption without false success.
4. Request a harmless tool operation that requires Ask. Answer locally and then
   remotely, and repeat in the opposite order. Exactly one original request
   may settle; old cards must not authorize subsequent operations. Verify that
   login, project trust and unknown forms remain local. For `clarify_user`,
   separately test permission to ask and the subsequent real answer form:
   allowing the question must not choose an answer. Test grouped options,
   permitted custom answers, incomplete submission, cancellation and competing
   local/remote answers. For Plan, test approval, refinement feedback and keeping
   planning; only explicit approval of the current proposal may exit Plan.
5. Start a harmless task in A, switch remotely to another session, then answer
   A's approval card or `/stop s1`. It must still act on A, not the newly selected
   session. An old round's approval or queued `/stop` must not act on the next round.
   Working replies must not display an automatic Stop button.
   Unbind/disconnect without stopping another running task and
   inspect any accepted queue locally.
6. Interrupt network access, reconnect, close to tray, and quit/restart.
   Check actual SDK reconnection, encrypted connection/scope recovery, fresh
   token generation and helper cleanup. Recovery itself must not send inference,
   replay offline messages or resume interrupted tasks. Manual disconnect must
   prevent auto-reconnection after the next restart; unbind must retain only the
   bot, not chat access. Restored history is not a resumed process.
7. Fail a selection or creation, then immediately send text and images. Neither
   may reach the previous target or be replayed after a later successful
   selection. Check `/sharing`, detach one running session and ensure local work
   continues while no later output from it is forwarded.
8. Queue two remote inputs behind a held turn and recall only the second.
   Confirm it is withdrawn without changing the first or a local draft. A late
   recall after dispatch/uncertain acknowledgement must not claim cancellation.
   `/tasks` must show the resident queue and typed attention states without
   opening cold history. Expire an approval, then refresh with `/status s1`;
   only the same still-pending request may get a fresh button.
9. Explicitly enable image access. Send an image and a text-plus-image post to
   an image-capable model, then request a workspace image with
   `desktop_send_image`. Verify an ordinary Ask permission, an actual native
   image message and no false delivery claim after upload alone. Revoke access,
   end the owning run or cancel while uploading and check that no later send
   is issued. Test unsupported models/types, oversized/partial input,
   workspace escapes and image permission across restart.
10. Check one-line coalesced tool counts on a streaming reply, with no thinking,
    raw inputs/outputs or extra progress messages. Long output must say that
    only the tail is visible and point to Desktop without rerunning the task.
    Verify a native table, inline code, fenced code and literal model-supplied
    mention/image tags on both mobile and desktop Feishu clients.
11. Check the staged resources in a newly built installer and run the same
   acceptance against that exact package. Native macOS and cloud CI are
   separate gates.

No real-account, packaged, macOS-native, cloud-CI or release readiness is
established by the source-only deterministic acceptance.
