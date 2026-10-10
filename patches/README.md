# Upstream Integration

Repository: https://github.com/stepfun-ai/Step-Code

Pinned commit: `39ec6e0adeca09d50c8897023ea4e471371634cd`.

`step-code-desktop.patch` contains the Windows build fix, desktop integration exports, and an opt-in in-memory auth backend. The build fix invokes npm through `process.execPath` and `npm_execpath`. The desktop backend activates only when the desktop client supplies an isolated auth path and credential payload; ordinary Step Code file storage is unchanged. The payload is removed from the child process environment during module initialization.

On a clean checkout of the pinned commit:

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
Electron encrypts the desktop auth snapshot with Windows `safeStorage` before writing it under userData. The runtime and management children receive the decrypted snapshot at launch and do not write `auth.json`. Any future upstream auth write path must be checked against this boundary before updating the pinned patch.
