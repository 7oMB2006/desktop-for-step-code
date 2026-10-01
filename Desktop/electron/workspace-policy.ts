export const WORKSPACE_POLICY = `# Shared workspace collaboration
- This workspace may contain user changes and concurrent agent changes. Other sessions have separate conversations; do not assume you know their instructions or own their edits.
- Read project instructions and inspect git status and relevant diffs before editing. Treat existing and newly appearing unrelated changes as work to preserve.
- Re-read the current file before applying a narrow edit. Do not overwrite, revert, reset, or clean changes you did not make without explicit user authorization.
- Before staging or committing, inspect both the worktree and the index. Stage only your task's paths or hunks; do not include or unstage unrelated work. Avoid blanket git add.
- Concurrent activity or a dirty worktree alone is not a reason to stop. Continue independent work. When overlapping changes cannot be reconciled without guessing intent or ownership, ask the user about that specific conflict.
- This guidance is not file locking or an ownership registry. Do not claim that changes are isolated or that another session has agreed to a plan.`;
