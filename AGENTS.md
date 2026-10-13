# Desktop for Step Code

## Project Boundary

- This repository contains the desktop client in `Desktop/`; Windows is the published target and Linux x64 is an experimental native-build target.
- `Step-Code/` is a separate upstream checkout and is intentionally excluded from this repository.
- Preserve the Windows release boundary and behavior. Linux work follows `docs/LINUX.md` and must preserve renderer sandboxing and fail-closed credential storage. WSL is not a current dependency.
- Preserve changes already present in the Step Code checkout. Do not edit it unless an integration need requires a narrowly scoped change.

## Runtime Boundary

- The Electron main process owns the Step Code child process and its JSONL RPC stream.
- The renderer must not receive Node.js access or filesystem access. Use the typed preload bridge and narrow IPC handlers.
- Store desktop-owned Step Code configuration, credentials, and sessions under Electron's `userData` directory. Never fall back to the user's personal Step Code profile.
- Do not log or display credentials, cookies, or raw child-process environment values.

## Development

- Run the desktop from `Desktop/` using `corepack pnpm dev`; stage its runtime first.
- Run type checks, protocol tests, and Electron acceptance tests before considering runtime integration complete.
- Read `docs/VERIFICATION.md` before claiming release readiness; local fixture tests do not establish real model acceptance.
- Do not add AI-client co-author attribution to commits.
