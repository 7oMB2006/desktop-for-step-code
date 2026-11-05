# Desktop Remote

## Scope

The first integration is a Desktop-hosted Feishu channel, not a standalone
service. Desktop must remain running and its host must stay awake and online.
Closing the window to the tray is different from quitting the application.
The independent Remote page is opened by the phone icon immediately to the
right of Settings; channel selection and channel configuration are separate.

This Desktop Beta supports one locally authorized human private chat with a
locally approved project scope and a separately selected current session.
It supports remote session listing, selection and creation, text input,
bounded assistant-text cards, task stopping, and known one-time tool permission
confirmations. It does not expose a Web URL, public
listener, tunnel, mobile application, group chat, attachment transport, remote
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
chat identity, project scope and current session ID are saved there too. Normal
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

The confirmation allows listing session titles and selecting or creating
sessions in the approved projects. Future assistant replies in attached
sessions are forwarded, including locally initiated rounds. Existing transcript history,
thinking blocks, raw tool results and attachments are not forwarded. A response
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
History and configuration mutations require unbinding first.

## Feishu Commands

These are Desktop-owned private-chat text commands, not upstream TUI commands
or a provisioned Feishu-client command menu. Pairing sends an initial help card.
Unknown commands and invalid arguments are rejected, never sent to the model.

| Command | Behavior |
| --- | --- |
| `/help` | Show this command set and local-only boundaries. |
| `/sessions [page]` | List ten authorized sessions per page without loading history or starting runtimes. |
| `/session <s1>` | Select a stable session handle or exact known session ID for future messages. |
| `/new [p1]` | Create a new session in an authorized project; default to the current project. |
| `/projects` | List the locally approved project handles. |
| `/current` | Show the current remote target. |
| `/status [s1]` | Show execution, model, effort, permission and queue state without loading a cold session. |
| `/stop [s1]` | Stop only the matching task observed when accepting the command. |
| `/disconnect` | Disconnect and forget the local connection without stopping accepted local queues or tasks. |

Aliases: bare `/session`, `/list`, `/switch <s1>`, `/session list [page]`,
`/session switch <s1>`, `/session new [p1]`, `/session current`.
Session and project handles last only for the current authorization. Reordering
the catalog does not reassign a handle to another conversation.

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
- Only the known native permission `confirm` envelope, tied to the exact pending
  tool call and runtime, becomes an Allow once / Deny card. Unknown forms,
  clarifications, login, project trust and permission-level acknowledgments stay
  local. Actionable cards recover the complete, redacted tool input from that
  call, not the upstream's shortened summary. Unrecoverable inputs and details
  exceeding the card's 5,000-character limit stay local rather than offering
  approval for clipped content. Existing native permission policy still applies.
- Both ends answer the same pending request. The first valid response wins.
  Remote tokens are opaque, single-use, bound to the chat, valid for at most ten
  minutes, and revoked on local completion, expiry or unbinding. A token never
  grants a standing permission or answers a replacement request.

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

Inbound text is limited to 12,000 characters; only the command whitelist above
is accepted for leading slash input, and all non-text messages are rejected.
The pinned upstream gate validates message age
and deduplicates eligible IDs. Main adds bounded, connection-local deduplication
and queue limits. This is not durable exactly-once delivery across restarts.
On restored bindings, messages timestamped at or before recovery are rejected
rather than replayed. Offline input is not a durable queue. Approval readiness,
tokens, run IDs, output cards, attached workers and pending tasks are never saved.
Old approval buttons and obsolete Stop callbacks cannot act on a restarted process.

Assistant text is coalesced into updates to one card per round, with a bounded
5,000-character visible tail. Normal replies show Markdown body text and a
small plain-text session-source footer, without Working or Completed headers.
Before text arrives, the same card shows a replying placeholder; an empty
finished response explicitly says that no text was returned. Interrupted
responses retain their partial body and an interruption note, never a success
label. Approval and system notices retain literal text and meaningful headers.
Known credential-shaped strings are redacted;
this cannot identify every possible secret in generated prose. Thinking and
tool payloads are excluded. Only authoritative task completion settles a reply;
failures and user cancellation are not successes. A delayed `/stop`
cannot stop a later round.

Socket reconnection pauses remote input and retains the current binding while
Desktop work continues. Fatal connection errors release all targets and the helper,
not the local task. Disconnect/unbind immediately fences old events and tokens.
Already accepted queued messages and running tasks remain in Desktop; unbinding
is not a stop or queue withdrawal operation. Card-delivery failures are shown
locally and do not retry model work. Ambiguous card POST failures are not retried
automatically, since their receipt may be unknown. Missed output is not a
durable replay log. Quitting Desktop also stops its hosted agent runtimes.

## Staging And Automated Verification

`Desktop/scripts/build-remote-adapter.mjs` bundles the unchanged
`packages/lark-adapter` from pin
`81e79bc4b699148d6823fedde9b5e70d9a80255f` with its locked Feishu SDK 1.76.0.
It rejects a different pin, modified adapter sources or an unexpected SDK.
`stage-runtime.mjs` includes this step. The existing whole-runtime packaging
rule includes the helper, adapter and bundled dependency notices. No runtime
pin upgrade or change to the upstream checkout is part of this feature.

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
pause/speed/completion controls and an illustrative old-layout comparison.
The fixture reuses `remote-card.mjs` for the outgoing card document and the
actual slash-command parser; its conversation state, command results and
Feishu-like HTML shell are samples, not live account/runtime operations.
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
   clarification, login and project trust remain local.
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
7. Check the staged resources in a newly built installer and run the same
   acceptance against that exact package. Native macOS and cloud CI are
   separate gates.

No real-account, packaged, macOS-native, cloud-CI or release readiness is
established by the source-only deterministic acceptance.
