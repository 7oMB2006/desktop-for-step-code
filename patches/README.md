# Upstream Integration

Repository: https://github.com/stepfun-ai/Step-Code

Windows pinned commit: `b5dbed938d9ae589397cf522dcf2ff89ecf4c494`
(v0.1.5 announcement baseline). Its patches and reviewed pre/post-image hashes
live in `patches/v015/`. Apply with:

```powershell
node scripts/apply-step-code-desktop-patch.mjs Step-Code patches/v015/step-code-desktop.patch
```

macOS remains frozen at `3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`
with the original patches below. Do not apply the Windows patch set to this source.

The v0.1.5 Plan bridge preserves `planHash`, `planModeExited` and
`approvalSource` in reviewed results. RPC child external-approval handoffs
are not user approvals. Desktop main workers still wait for review, bind the
decision to the displayed snapshot and stop on cancellation or stale content.
The upstream usage activity worker must load from a copied runtime bundle,
without its original checkout or build directory.

`patches/v015/step-code-session-import.patch` backports the offline Codex/Claude
adapters and reviewed-snapshot service from Step-Code PR #291
(`6a0984573275d2398faa812bbf661a9dc5557e06`). It also supplies historical
context projection and usage exclusion, so source tools are evidence rather than
live execution protocol and source model selection is not resumed. The v0.1.5
port uses a local callback type because that baseline predates the source's
session-index notification interface; Desktop refreshes its catalog instead.
Source/preimage and resulting hashes are part of the existing Windows manifest.
The frozen macOS patch set does not include this addition. See
`docs/SESSION_IMPORT.md` for boundaries and verification.

The Windows manifest also applies the shared Cron observer and management patches,
then `step-code-desktop-cron-recovery.patch`. This **Beta** addition gates native
Cron delivery only when both `DESKTOP_CRON_STATE=1` and
`DESKTOP_CRON_RECOVERY=1` are explicitly supplied. The one-use
`desktop_cron_resume` RPC requires an idle trusted session. Desktop verifies
the selected session, account, model, Ask policy and loaded tasks before release.
The patch does not replace the scheduler, alter its shared task schema or bypass
expiry. macOS does not include or advertise this recovery patch. See `docs/CRON.md`.

Windows-specific compatibility also keeps branch preparation read-only:
`STEPCODE_DESKTOP_BRANCH_SOURCE` suppresses startup usage discovery only for
that exact original file, while the newly forked session records normally.
The ordinary strict leaf check is unchanged. Whole-session copies compare
the copied source leaf before newly owned usage-lineage records.
Subagent temporary-directory cleanup is single-flight, retried and nonfatal;
a Windows `EPERM` during cleanup must not terminate the parent runtime.
The Windows patch also carries Workflow test-fixture portability and mixed
Workflow/parallel-subagent admission regressions; these do not change the
production scheduler or the frozen macOS test sources.
Foreground shell cancellation also waits for Windows cleanup and snapshots the
selected Git Bash invocation's MSYS descendants, whose Windows parent chains
can be broken by fork/exec. Only that invocation's exact PIDs are targeted;
unavailable MSYS discovery retains the ordinary Windows-tree fallback.
The focused process-tree tests and gated real-command cancellation/isolation
acceptance cover this Windows-only addition. It does not change command
approval policy, timeout defaults or the frozen macOS patch.

Permissions, risk acknowledgment, legacy migration, bounded model-error continuation and default CLM remain upstream behavior. The original integration patches below remain unchanged for the frozen macOS baseline. These are reproducible source commits, not GitHub release tags.

The applier also installs `step-code-desktop-plan.patch`. Its explicit
`--desktop-plan-review` flag is supplied only to Desktop main workers. It adds
ephemeral Plan context before each model call and blocks proposal submission on
RPC review before restoring editing tools. Approval is checked against the
current history leaf, proposal path and full file contents. Cancellation or
expiry terminates the review turn while keeping Plan active. RPC child workers
do not receive this flag and retain the upstream auto-exit behavior. Plan is not
a read-only sandbox: command permissions remain unchanged.

`step-code-desktop.patch` contains the Windows build fix, desktop integration exports, and an opt-in in-memory auth backend. The build fix invokes npm through `process.execPath` and `npm_execpath`. The desktop backend activates only when the desktop client supplies an isolated auth path and credential payload; ordinary Step Code file storage is unchanged. The payload is removed from the child process environment during module initialization.

On a clean checkout of the frozen macOS commit:

```powershell
node ../scripts/apply-step-code-desktop-patch.mjs . ../patches/step-code-desktop.patch
```

Do not apply again to the existing prepared checkout. Do not reset an upstream checkout with unrelated local changes. Rebuild upstream before staging the desktop runtime.

If the existing `Step-Code/` checkout must be preserved, build a separate checkout of the pinned commit with the integration patch applied, then stage it from `Desktop/`:

```powershell
corepack pnpm stage:runtime 'D:\path\to\prepared-step-code'
```

`DESKTOP_STEP_CODE_SOURCE` can supply the same source directory when using `pnpm package`. The explicit argument takes precedence, and the default remains `../Step-Code`. Staging refuses a different upstream commit before modifying the runtime. Updating the pinned baseline requires updating the staging check as well as CI and the integration patch applier.

Management operations use upstream SessionManager, configuration locking, skills discovery, and login/logout helpers in a separate process. Agent execution uses the upstream JSONL RPC entry.

The applier additionally installs `step-code-desktop-clarification.patch`, a
**Beta** opt-in `--desktop-clarification` bridge for `clarify_user` in main RPC
workers. It transports the unchanged question group and validated answers over
the existing cancellable input request. CLI/TUI and child RPC behavior remain
unchanged. No unattended timeout, automatic answer or durable pending-question
semantics are introduced. See `docs/UPSTREAM_QUESTIONNAIRE_BETA.md` for boundaries,
Plan integration and the follow-up upstream proposal.
Electron encrypts the desktop auth snapshot with Windows `safeStorage` before writing it under userData. The runtime and management children receive the decrypted snapshot at launch and do not write `auth.json`. Any future upstream auth write path must be checked against this boundary before updating the pinned patch.
