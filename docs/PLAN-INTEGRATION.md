# Desktop Plan integration

## Scope and implementation order

1. Read authoritative Plan state in the runtime, on the current history branch.
2. Gate `exit_plan_mode` inside the runtime before restoring editing tools. Enable
   this only with the Desktop main-worker flag; RPC children retain upstream behavior.
3. Add ephemeral model context before every provider call while Plan is active,
   including its actual proposal path and the requirement to request review.
4. Show the full proposal with approve, refine and cancel actions. Bind approval
   to the reviewed file contents and current branch. Cancellation, expiry, abort,
   disconnection and restart do not grant approval.
5. Verify model request contents, approve/refine/cancel, stale proposals, restored
   sessions and ordinary RPC children using the pinned runtime and deterministic
   local model responses. Real-model acceptance remains a separate check.

## Boundary

Plan restricts upstream file-editing tools to the proposal file. Commands retain
their normal permission policy, including Full Access; this is not a read-only
sandbox. Model instructions guide planning but do not replace execution controls.
No change to Goal, Ultracode or the upstream commit pin is intended.

## Implemented

- Runtime state and proposal path supply per-call ephemeral context.
- Main-worker `--desktop-plan-review` gates the native exit tool through RPC.
- Full proposal review supports approval, feedback and cancellation in Chinese
  and English, using a non-modal composer-anchored drawer.
- Guarded patch application and staging hashes make the runtime change reproducible.
- Local deterministic acceptance is recorded in `VERIFICATION.md`. Real-model
  acceptance and packaging remain separate steps.

## Review drawer

Review and refinement now use the existing composer-anchored approval drawer.
The two sizes are 50% and 85% of the main chat area, selected through its grip.
The full proposal renders as Markdown with fixed decision controls. Review later
and Escape collapse the drawer without responding; the permission-adjacent review
entry and waiting pulse reopen it. Explicit cancellation still ends the review.
Opening requested changes is local navigation, not a runtime response. Back to
review retains the pending approval and unsent draft; only submitting notes
advances the native refinement handshake.
Review and feedback each expire after four minutes, with no automatic approval.
Ended reviews retain a history-derived permission-adjacent reentry while Plan
remains enabled, including after ordinary follow-ups, renderer reload and restart.
Reentry sends a visible user request asking the model to resubmit `exit_plan_mode`;
it is not approval and requires a fresh runtime review of the current proposal.
It does not reopen an expired request or guarantee a model will obey that request.
Review arrival and expiry advance the renderer revision watermark so an older
snapshot cannot erase or resurrect a request.
Plan files remain ordinary deliverables. This UI revision is packaged in
the local preview builds recorded in `VERIFICATION.md`.

## Approved execution

Successful native `exit_plan_mode` results replace the raw tool row with an inline
approval note, using the model-change note's emphasis. The note and pulse status
expand a read-only Markdown snapshot of the approved proposal, not the current
mutable file. Executing, normally ended, failed and interrupted states belong to
that execution segment. Steering retains ownership; an ordinary user turn ends it.
The settled status appears beside the hidden response actions on hover/focus.
Its trigger stays on the original status line while details expand below it;
running details align to the trigger, and settled details retain right alignment.
"Plan executed" denotes a normally ended execution turn, not an independent audit
that every proposal requirement was fulfilled. Approval alone is never completion.
