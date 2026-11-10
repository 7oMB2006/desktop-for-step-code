# Get Started

This resource turns text you supply into an evidence-aware checklist.
It does not install an external service or connect to an account of its own.

## Prepare

1. Install DFSC Example from the supplied local marketplace.
2. In an existing conversation, explicitly restart that conversation to load
   the new skill and `/dfsc-example` command. Do not interrupt running work.
3. Confirm that the current conversation has a model and account you intend
   to use. Sending the command may consume that account's quota.
4. Complete the [first checklist](first-task.md).

Opening this workspace makes no model request. The visible workspace confirms
that the installed resource exposes these pages, not that a model request,
account login or task has succeeded.

## Expected Boundaries

The MCP service switch is unavailable because this package declares no service.
There is no API key, installer or configuration form to fill in.
The skill is model guidance, not a deterministic validation engine.

If the command is missing, follow [Troubleshooting](troubleshooting.md).
