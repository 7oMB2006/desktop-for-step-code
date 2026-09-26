# Upstream Integration

Repository: https://github.com/stepfun-ai/Step-Code

Pinned commit: `7dd66cb9f11a40ba19285b620084b362892cadea`.

`step-code-desktop.patch` contains the Windows build fix, desktop integration exports, and an opt-in in-memory auth backend. The build fix invokes npm through `process.execPath` and `npm_execpath`. The desktop backend activates only when the desktop client supplies an isolated auth path and credential payload; ordinary Step Code file storage is unchanged. The payload is removed from the child process environment during module initialization.

On a clean checkout of the pinned commit:

```powershell
git apply --check ../patches/step-code-desktop.patch
git apply ../patches/step-code-desktop.patch
```

Do not apply again to the existing prepared checkout. Do not reset an upstream checkout with unrelated local changes. Rebuild upstream before staging the desktop runtime.

Management operations use upstream SessionManager, configuration locking, skills discovery, and login/logout helpers in a separate process. Agent execution uses the upstream JSONL RPC entry.
Electron encrypts the desktop auth snapshot with Windows `safeStorage` before writing it under userData. The runtime and management children receive the decrypted snapshot at launch and do not write `auth.json`. Any future upstream auth write path must be checked against this boundary before updating the pinned patch.
