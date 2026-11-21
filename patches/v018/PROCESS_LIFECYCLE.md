# Process lifecycle candidate

Base: `5309624e5deff3d8fee031f0853fe7e07bc68801`.
`step-code-desktop-process-lifecycle.patch` is an intermediate review delta.
Its applicable changes are already reconciled in `step-code-desktop.patch`.
Replay only the patch named in `manifest.json`.

- Reconcile Windows Git Bash tree cleanup and the Darwin descendant fallback
  with upstream process ownership. Do not reapply the old cleanup hunks.
- Publish only the current session's `{ version: 1, count }` for background
  shell commands in RPC `get_state`. Enable `desktop-background-command-state`
  in the staged runtime manifest only with that protocol present.
- The combined patch keeps native subagent outcomes and Desktop permissions,
  redaction and notification behavior, and includes the Windows bundle
  compatibility work. Do not separately reapply the older platform patches.
