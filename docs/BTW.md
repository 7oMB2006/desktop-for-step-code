# Side Questions

`/btw` opens the independent right-rail side-question panel.
`/btw <question>` opens it and submits the question. The right-rail question-bubble
icon opens the same component, without a duplicate composer icon. A connected existing conversation is required;
opening BTW never creates a worker or a saved session.

## Design Model

BTW is a contextual side inference, not another agent loop or a durable fork.
Each submitted question takes a fresh snapshot of the available main context,
combines it with temporary side exchanges and the current question/references,
then runs one model response with no tools. The answer stays in side history;
there is no automatic path back into the main task's conversation.
The snapshot does not keep receiving subsequent main-task updates while that
answer streams. A later side question takes a new main-context snapshot.

This is a general application orchestration pattern, not a Step-specific model
capability or a claim that every coding client implements the same contract.
The pinned Step Code TUI implementation explicitly references Claude Code's
side-question pattern. Its `handleStepBtwCommand` uses the current system
prompt, effective conversation and temporary `BtwHistory`, then calls
`modelRegistry.complete` with the applied model and a 2,048-token output limit.
It creates no tool-enabled agent/session and appends no main transcript entry.
Comments in Step Code about another product's internals are not independent
verification of that product's implementation.

Desktop preserves that behavioral boundary, but supplies a narrow RPC,
streaming, per-request cancellation/ownership, incomplete-tool-message
sanitization and right-rail presentation because the interactive TUI handler
cannot run in Desktop's headless RPC mode. Selected text narrows what the user
is asking about; it does not replace the rest of the available main context.
Unlike a delegated child agent, BTW cannot inspect fresh files, run commands
or carry out an executable task. It can explain information already in context.
The model row labels this answer-only/no-tools boundary, with a tooltip for
the snapshot and no-main-write semantics.

Desktop reinforces the side-only reminder in the system prompt as well as
the current question. A structured tool invocation or bare leading
`<tool_call><function=...>`-style envelope is an unsupported-tools error.
No tool is executed, no automatic retry/fallback occurs, and the failed
exchange never enters future side history. The renderer replaces that invalid
stream with an explicit "no action was executed" outcome, not a successful
answer. Detection is deliberately conservative: fenced code, blockquotes
and prose explaining a tool protocol remain ordinary answer text. It is not
a universal detector for every provider's malformed output.

Source basis: pinned upstream
`packages/coding-agent/src/step/slash-commands.ts` and
`packages/coding-agent/src/render/btw-panel.ts`; Desktop's native compatibility
implementation is reviewed in `patches/v017/step-code-desktop-btw.patch`.
Token/accounting and temporary-history limits are described below.

## Selected References

Selecting user or assistant prose/code exposes **Ask in side** beside the
existing Quote and Annotate actions. It opens the same right panel, attaches
the selected excerpt and focuses the side-question editor. It does not send
anything until the user enters a question and explicitly submits.

Inside BTW, the same toolbar provides Quote, Annotate and Copy only; there
is no recursive Ask in side action. Both user questions and assistant prose
can be selected. These references and annotations go to the side composer,
not the main draft. Source navigation stays within the originating
transcript and verifies stable entry identity even after history indices
shift. Main and side inline annotation highlights coexist; hiding BTW
removes only its own markers and highlights. Submitted side annotations
remain visible alongside their quoted text.

Each sent side question uses the shared user-message timestamp/copy footer.
Its timestamp is the local send time, not the answer's completion time.
Editing/retrying a previous question is not implemented or advertised.

Pending references reuse the main composer's compact count entry and anchored
quote popover, including removal and source navigation. Opening references
does not displace the editor; Escape dismisses the popover before the side
panel, including when focus remains on its trigger. Closing the side panel
hides the popover without discarding its references.
They are independent from the main composer's draft, references
and attachments. Repeated selections are deduplicated, with at most eight
references. Question and formatted references together must fit the existing
8,000-character native request limit. Oversized submissions retain both the
draft and references; they are never silently truncated.

Submitted references appear above their question, retaining source identity
and the original Markdown/code fences in the request. Source navigation
requires a matching message entry and verified text range; missing or replaced
content is reported explicitly rather than jumping to an unrelated message.
Sending consumes the pending references only for that question. Successful
followups still include the previous formatted question in the bounded native
history, so its references are not reattached as a new selection.

Closing/reopening retains the independent side draft and pending references.
Clear removes the pending references and temporary exchanges; switching
conversations discards the side draft, references and history together.

### Reference Review

- ZCode's `packages/ui/src/v4/SelectionActionMenu.tsx` separates Add to current
  task from Ask in side chat, while preserving the selection during menu use.
  Its `conversationSelectionReference.ts` separates visible reference text
  from source metadata and applies references on send.
- OpenChamber's `packages/ui/src/components/chat/message/TextSelectionMenu.tsx`
  retains plain text, Markdown and message anchors, with a distinct
  `requestBtwComposer` action for selected text. This is the OCB project
  referenced here.
- The requested Codex comparison does not establish its private desktop
  implementation or reference lifetime. Official documentation retrieval was
  blocked during this pass; no unsupported Codex behavior is assumed.

Desktop reuses its own typed quote objects, source verification and temporary
BTW lifecycle rather than importing another product's child-session semantics.

## Context And Routing

The pinned upstream TUI handler requires an interactive terminal UI. Desktop
adds a narrow `desktop_btw` RPC rather than submitting `/btw` through `prompt`.
The upstream pin is unchanged. Both native builds receive the same helper.

Each request snapshots the current effective conversation, system prompt and
actual runtime model. An incomplete tool-call suffix is excluded, not sent as
unpaired tool messages. Previous successful side answers are included in
followups, up to 20 exchanges and 64,000 text characters. Failed or cancelled
answers are not included. The UI retains the same successful window plus at
most five unsuccessful attempts.

The native ModelRuntime resolves the applied provider, credentials, endpoint
and headers, just as upstream BTW does. A next-turn model preselection does
not replace the current actual model. No tools or agent session are created.
There is no fallback from Plan to direct API or to another provider on failure.
Each answer is limited to 2,048 output tokens, 64,000 displayed characters and
120 seconds. Reaching the model's answer limit is disclosed.

The main task can continue while the side question streams. Stopping or closing
BTW cancels only the side request, never the main task or queue. Stopping the
main task does not cancel an independently running side question. While it is
active, runtime recycling, history mutation and account/configuration changes
remain protected; foreground task activity and completion notifications remain
independent. Quit review includes active side requests.

## Lifetime And Usage

History is temporary renderer/native memory. Closing or switching right tools
cancels an in-flight answer but retains the panel's temporary records for reopening. Clear removes
the followup history. Switching conversations, renderer reload or application
exit discards it; switching back does not resubmit an old slash command.
Questions and answers are never appended to the main transcript or JSONL.

Side questions still consume model tokens on the applied account. Reported
input (including cache) and output are shown per answer. An all-zero provider
default, such as an aborted request without final usage, is unknown and not
presented as a free request.

**Local Usage overview, session cost estimates, context totals and the main
performance strip do not yet include BTW usage.** No durable usage ledger or
account-charge estimate is added here. Official account allowance/balance remains
the authority for account-level consumption, subject to its normal refresh delay.
This implementation must not be described as complete local billing coverage.
The panel does not repeat permanent explanatory notes below the editor; the
per-answer Token tooltip discloses the missing local-total integration.

## Ownership And UI

Main-process validation binds runtime, session, UI scope and request identity.
Only allowlisted text, terminal state, model identity and validated numeric usage
cross the preload bridge. Raw provider errors, credentials, request headers and
cost payloads are not forwarded. Late or foreign events cannot change another
panel. Ambiguous acknowledgements require confirmed cancellation before host
ownership is released; transport failure does not silently make the host idle.

The production component is reused in `Desktop/tests/fixtures/btw-panel.html`.
The independent right-rail panel reuses the shared standard/wide/fullscreen
width control, side handle, theme tokens and cubic motion, with a reduced-motion
fallback. Escape restores fullscreen before closing; closing returns focus to
the rail entry. Switching tools keeps temporary answers, and clearing returns
focus to the enabled editor after the update commits.
The idle model strip reflects the current applied conversation model, not a
previous answer's model. During an answer it reflects that request's reported
model; changing models does not discard the temporary answer list.
Embedded browser pages are hidden while it is open. Composer focus reserves the
shared four-pixel gutter inside all clipping ancestors. Answers reuse the main
conversation's Markdown rendering, configurable body typography and user-message
presentation; wide code blocks and tables scroll inside their own surfaces
without expanding the panel. Live replies reuse the main responding indicator,
with locally observed request elapsed time. Settled replies reuse the main
copy/elapsed/timestamp footer; they never expose a saved-session branch action.
Failed, cancelled and length-limited replies retain explicit outcomes.
The compact editor is the same `ComposerInput` used by the main conversation,
including ProseMirror editing, multiline input and input-method guards. Its
surface and toolbar use the shared `.composer`/`.composer-tools` styles, and
Send/Stop reuses `ComposerActionIcon` with its existing transition. The side
composer does not acquire main-task attachments, permissions or model controls.
It grows and shrinks with its draft; the shared focus ring follows the whole
composite field with the required four-sided clearance. Oversized drafts are
retained for correction and rejected before sending, rather than truncated.
The editor receives Escape before ProseMirror consumes it, preserving the
quote-popover/fullscreen/panel dismissal order. It is mounted only while the
panel is present; the side draft and references remain in panel state.

## Verification

- `Desktop/tests/btw.test.ts`: owner validation, projection, cancellation,
  fail-closed host retention, disposal, stale results, reference formatting,
  combined request bounds and exact formatted-prompt history limits.
- `Desktop/tests/btw-runtime.test.ts`: actual staged JSONL RPC with an isolated
  loopback provider, applied model/auth route, streaming, followups, clearing,
  simultaneous main task, independent main/side cancellation, errors and no
  main-history writes.
- `Desktop/scripts/verify-btw.mjs`: production-component interactions, right-rail
  entry, three width modes, handle, Escape restore/close, themes,
  320/390/1100/1600-pixel layouts, rich text, main-draft preservation, focus extent,
  clear-focus restoration, selected-reference handoff without auto-send,
  independent drafts/references, deduplication, source identity, oversize
  rejection without data loss and reduced motion.
- `Desktop/scripts/verify-btw-electron.mjs`: real renderer/preload/main/native
  path, slash dispatch, main context/draft, concurrent task, cancellation,
  applied model changes, right-tool switching during streaming, fullscreen
  restore, in-flight session switching, fresh followup scope, the minimum
  desktop layout, native selection-to-BTW handoff, provider-received Markdown
  references, unchanged main draft/references and unchanged JSONL.

These use deterministic local model fixtures, not a real paid account.
Cloud CI, native macOS execution, installation and real-account acceptance
remain separate gates.
