# Experimental Linux x64 port

Linux support is an experimental source-build target. Published v0.3.0 Windows
installers remain Windows-only. This work does not claim Linux release readiness,
real-account/model acceptance, or compatibility with every distribution.

## Build prerequisites

- A glibc-based Linux x64 system with Git, Python 3, make and a C++ compiler
- Node.js 24.15.0 or compatible Node >=22.19, Corepack and pnpm 9.15.9
- Electron's GTK3, NSS, X11/Wayland, GBM and ALSA runtime libraries
- A regular, non-root graphical desktop session that supports Chromium sandboxing
- GNOME Keyring/libsecret or KWallet, unlocked, for saved Step login credentials

Build natively on the destination platform. The staged Node executable and native
PTY module come from the build host; Windows artifacts cannot be reused on Linux.
Archives built on newer distributions may require newer glibc/libstdc++ versions.
Do not work around an unsupported host by adding `--no-sandbox` or changing OS
security settings.

From the repository root, in a new checkout:

```sh
corepack enable
# Corepack's pnpm shim must precede any unrelated global pnpm on PATH.
(cd Desktop && corepack pnpm --version)  # 9.15.9
git clone https://github.com/stepfun-ai/Step-Code.git Step-Code
git -C Step-Code checkout 3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8
node scripts/apply-step-code-desktop-patch.mjs Step-Code patches/step-code-desktop.patch
(cd Step-Code && corepack pnpm install --frozen-lockfile && corepack pnpm build:offline)
cd Desktop
corepack pnpm install --frozen-lockfile
node node_modules/electron/install.js
corepack pnpm stage:runtime
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
node scripts/verify-linux.mjs
corepack pnpm dev
```

`build:offline` uses upstream's checked-in model data; dependency installation
still needs network access. Staging checks the pinned revision and the exact
Desktop integration patch hashes before rebuilding the upstream bundle.

For a virtual X11 display on a host that supports it, run
`xvfb-run -a node scripts/verify-linux.mjs`. The acceptance must run as a non-root
user and refuses disabled Chromium sandbox switches. An explicit
`DESKTOP_VERIFY_HEADLESS=1` selects Chromium's Ozone headless backend, but still
requires the host's ordinary IPC and sandbox facilities.

## Packaging

```sh
corepack pnpm package:linux
node scripts/checksums.mjs
DESKTOP_VERIFY_EXE=./release/linux-unpacked/desktop-for-step-code \
  node scripts/verify-linux.mjs
```

The package is `release/Desktop-for-Step-Code-0.3.0-linux-x64.tar.gz`. Extract it
and run `desktop-for-step-code` as a normal user. This first-stage portable archive
needs no FUSE mount, but does not install desktop/menu entries or system packages.
The existing `package` command and Windows NSIS target remain unchanged. A
before-pack guard verifies the native target and staged Node hash, rejecting
cross-platform or stale runtime packages.

## Platform behavior

- Runtime Node is `runtime/node/node`, with executable mode and platform/architecture
  recorded in the manifest. Linux PTY native binaries are included in the package.
- Terminals use Bash without personal startup files, or `/bin/sh` if Bash is
  unavailable. Terminal history saving is disabled and the existing environment
  allowlist excludes credentials. Linux shutdown waits for owned descendants and
  escalates only those still alive, checking process identity before signalling.
  Natural shell exit also cleans jobs remaining in the captured PTY session.
  Deliberately daemonized jobs that have both reparented and entered another
  session can escape that fallback; this is not a general OS process supervisor.
- Workspace paths are case-sensitive on Linux. Case-distinct projects and terminal
  scopes stay independent, including sidebar rename/pin, archives and file previews.
- Closing the Linux window quits the application and its managed runtimes/terminals.
  Windows retains its existing tray behavior. Linux tray integration is deferred.
- Electron owns the profile under its Linux `userData` location, normally
  `~/.config/Desktop for Step Code`. It never adopts a personal Step Code profile.
- The historical credential filename `step-runtime/auth.dpapi` is retained, but on
  Linux its contents are encrypted by the OS keyring through Electron safeStorage.
  New vault files are owner-readable/writable only. `basic_text`, unknown or missing
  secure storage backends fail closed. An empty profile can open without a keyring;
  saving or unlocking credentials cannot silently fall back to weak storage.
  Clearing the last credential removes the Linux vault without requiring a keyring,
  so the next empty-profile launch retains that no-keyring behavior.
  Windows vaults are not portable to Linux. Other configured provider/MCP secrets
  retain their existing storage behavior; this is not a general secret migration.
- The current public update feed is Windows-oriented. Linux can open release notes
  but is never offered its Windows installer. Linux update artifacts/feed support
  is deferred. Windows-only StepPage registration is not applied on Linux.
- Linux file launching uses Electron's default application. Windows-specific
  application enumeration and the "Choose another app" picker are not offered;
  direct requests for those unsupported destinations are rejected.

## Verification boundary

`verify-linux.mjs` creates a disposable profile/project and local deterministic
HTTP provider. The full path checks the renderer sandbox/Node isolation, a real
Step Code file-read tool and reply, native POSIX terminal lifecycle, restart
history, and clean quit. No real credentials or paid model are used.

Where Electron cannot launch, `DESKTOP_VERIFY_RUNTIME_ONLY=1 node
scripts/verify-linux.mjs` explicitly verifies only the staged RPC runtime, real
file read, persisted history and clean child-process exits. It reports
`PASS_RUNTIME_ONLY`; it is not GUI, Chromium sandbox, keyring or terminal acceptance.
The same environment variable may be combined with `DESKTOP_VERIFY_EXE` to check
runtime resources from the unpacked package.

PR CI adds a Linux x64 job on Ubuntu 22.04: build, staging, typecheck, all protocol
tests, sandboxed Xvfb acceptance, portable packaging, and packaged acceptance.
Both Windows and Linux jobs must succeed for code changes. Local test success
must not be described as a successful remote CI run.

Real graphical startup on X11/Wayland, secure keyring login, real-model behavior,
file associations, hardware rendering, distribution compatibility, package
installation/uninstallation and public release qualification remain separate
acceptance work. See `VERIFICATION.md` for the actual evidence from this port.
