# First Checklist

Use a short piece of non-sensitive text whose facts you can check yourself.
Return to your conversation and submit:

```text
/dfsc-example Release checklist: version and changelog are updated.
Typecheck passed. Packaging has not been run. No model billing was checked.
```

This sends a prompt to the current model. It does not run packaging,
recheck TypeScript or query billing.

## Check the Result

The response should distinguish supplied facts from unverified work.
It must not turn "packaging has not been run" into a successful package claim,
or claim that it independently verified the stated typecheck result.

You have completed this example when the command is available, a real response
returns, and you can identify the completed and still-unverified items.
The answer is not an independent audit of your project.

Do not include keys, cookies or credentials. For a failed request, inspect the
conversation's actual error before retrying; see [Troubleshooting](troubleshooting.md).
