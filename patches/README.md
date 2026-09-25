# Upstream Integration

Repository: https://github.com/stepfun-ai/Step-Code

Pinned commit: `7dd66cb9f11a40ba19285b620084b362892cadea`.

`step-code-desktop.patch` contains the pre-existing Windows build fix and the new desktop integration exports. The build fix invokes npm through `process.execPath` and `npm_execpath`. The exports expose existing `loginStepOAuth` and `writeStepLoginCredential` implementations without changing their behavior.

On a clean checkout of the pinned commit:

```powershell
git apply --check ../patches/step-code-desktop.patch
git apply ../patches/step-code-desktop.patch
```

Do not apply again to the existing prepared checkout. Do not reset an upstream checkout with unrelated local changes. Rebuild upstream before staging the desktop runtime.

Management operations use upstream SessionManager, configuration locking, skills discovery, and login/logout helpers in a separate process. Agent execution uses the upstream JSONL RPC entry.
