<p align="center">
  <img src="assets/readme/StepCode.svg" width="88" alt="Step Code logo">
</p>
<br>
<p align="center">
  <img src="assets/readme/desktop-for-step-code-banner.png" width="480" alt="Desktop for Step Code">
</p>
<hr>
<p align="center">Let ideas reach the stars.</p>
<p align="center">Windows x64 · macOS Apple Silicon · Electron · React · TypeScript · MIT</p>
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a></p>
<p align="center"><a href="https://calm-falcon-0dc2.page.stepcloud.com/"><strong>Explore the Showcase Website</strong></a> (Chinese) · Product demos, downloads and the people behind the project</p>
<p align="center">
  <img src="assets/readme/home-workspace-v0.6.0.png" width="960" alt="Desktop for Step Code v0.6.0 workspace and new conversation screen in Chinese">
</p>

A community [Step Code](https://github.com/stepfun-ai/Step-Code) desktop client for Windows x64 and macOS Apple Silicon. It provides desktop workspaces, conversations, and session management; Step Code powers agent execution.

### Why This Project

The original idea was to explore a community-built desktop client for Step Code while no official Step Code desktop app has been released. Given my love for StepFun, I also look forward to its official release.

### Features

- Streaming conversations, model and thinking-level selection
- Custom providers (Beta), model discovery, capability settings and connection diagnostics
- Independent sessions and project workspaces, ordering, pinning, archiving and branching
- Concurrent sessions, queued sends, steering, quotes and cross-session links
- Image attachments, tool approvals, subagent status and elapsed-time feedback
- Plan review and execution, Goal controls, and Ultracode workflow inspection and explicit recovery
- Cron task management, session association and explicit recovery (Beta)
- CLM context maintenance, revision browsing and change comparison
- Local usage heatmaps, trends and official-account consumption estimates
- Plugin sources, MCP and Skills management, session import and sidebar search
- Inline commands and links, and persistent turn-status controls
- Summary, context and diff inspection, with bounded recorded-change undo
- A terminal, user-operated browser, file previews and delivery references
- Step account sign-in, MCP configuration, and resource discovery
- Chinese and English UI, with light and dark themes
- GitHub update checks, selectable channels and in-app updates for supported installations
- Background tray operation and window restoration
- Font and size settings for the interface, messages, code and Diff, plus message line spacing

The app keeps its data in a dedicated directory (`%APPDATA%\Desktop for Step Code` on Windows, `~/Library/Application Support/Desktop for Step Code/` on macOS) instead of reusing a personal Step Code CLI profile. Step Code owns agent execution and permission policies; Desktop adds session orchestration and desktop interactions. Concurrent collaboration does not provide file locks or transaction isolation.

On Windows, Step login credentials are encrypted for the current user in `step-runtime/auth.dpapi`. Existing desktop `auth.json` data is migrated on startup, and the plaintext file is removed after the encrypted copy is saved. Windows uninstall removes desktop Step credentials while keeping sessions, settings and independent workspace files; signing out also removes Step credentials. macOS uses Electron safeStorage and Keychain; see [MACOS.md](docs/MACOS.md). This does not protect against software running as the same user. Other configured MCP secrets are outside this credential migration.

If the app fails to start or the Step Code runtime exits unexpectedly, a `crash-<timestamp>-<id>.log` is written to `%APPDATA%\Desktop for Step Code\logs\` with the app version, the startup phase, and the error. That data lives under `%APPDATA%` rather than the install directory, so reinstalling does not clear it; read the newest crash log before reinstalling.

StepPage has explicit preparation, validation and retry controls in the built-in plugin settings, linked from MCP settings. Files and an isolated HOME live under Desktop userData and use the bundled Node runtime. Preparation does not install a global shell wrapper, read personal CLI credentials, silently enable disabled services or restart sessions. Windows login/publication checks and Mac handshake evidence are recorded separately, without cross-platform inference; see [StepPage compatibility and boundaries](docs/STEPPAGE.md).

### Download and Run

**v0.6.0**, published on October 25, 2026, is a joint Windows x64 and macOS Apple Silicon community preview. Its highlights are **Cron task management and recovery Beta** and **CLM context and revision inspection**, followed by local usage statistics, plugin/MCP/Skills management, session import and search, faster session switching and panel improvements. Both platforms use the pinned Step Code v0.1.5 source baseline `b5dbed93`. Custom providers remain Beta.

**[Download the Windows x64 installer](https://github.com/7oMB2006/desktop-for-step-code/releases/download/v0.6.0/Desktop.for.Step.Code.Setup.0.6.0.exe)** · **[Download the macOS ARM64 ZIP](https://github.com/7oMB2006/desktop-for-step-code/releases/download/v0.6.0/Desktop.for.Step.Code.0.6.0.arm64.zip)** · [Release notes and checksums](https://github.com/7oMB2006/desktop-for-step-code/releases/tag/v0.6.0) · [All releases](https://github.com/7oMB2006/desktop-for-step-code/releases)

1. Download the platform-specific file and verify its SHA-256 against `SHA256SUMS.txt`. On Windows, run the installer. On Mac, extract the app into a writable Applications folder; Apple Silicon and macOS 13.5+ are required.
2. Launch the app and sign in under Account Settings with your own Step Plan account or Step Platform API key, or configure a custom provider.
3. Open a local project or choose an independent session, select a model, and start a conversation.

The installer includes Electron and pinned Step Code and Node runtimes; the development dependencies below are not required. Git/Bash, project-specific tools, and MCP server dependencies must be installed separately. Model access and usage limits depend on your account.

**Custom providers (Beta):** Chat Completions, Responses and Anthropic Messages are supported through generic protocol configuration. Compatibility depends on the provider and model; a successful short-request diagnostic does not establish streaming, tool-use, image-input or long-task compatibility. Dedicated integrations for well-known providers currently have low priority, with no promised date.

**Installation notice:** The Windows installer is unsigned and may trigger SmartScreen or an "unknown publisher" warning. The Mac app has no Developer ID signature or notarization and may require Gatekeeper confirmation. Verify the download source and checksum; do not disable or bypass system security protections.

**Updates:** The app checks after startup and every six hours. Check manually or disable automatic checks under Settings → Updates. The default channel includes releases and previews; **v0.6.0 is a GitHub Pre-release and will not appear on the releases-only channel.** Supported Windows NSIS installations can download, verify and explicitly confirm a restart to install in-app. Unpacked `win-unpacked` previews and development runs do not enable this installation flow and require manual downloads. Mac in-app updates require a writable installation location and remain subject to Gatekeeper; older versions depend on their own updater support. See [UPDATES.md](docs/UPDATES.md) for details. Downloads are not automatic and installation requires confirmation.

**Exit and upgrade:** Closing the window keeps the app in the tray and lets running tasks continue. Before upgrading, finish tasks and explicitly quit through File → Exit App or the tray menu, then run the installer over the existing installation.

This release supports Windows x64 and macOS Apple Silicon, not Intel Mac, Linux or WSL. To run from source, follow the Windows instructions below or the [macOS build instructions](docs/MACOS.md).

### Build from Source

Requirements: Windows x64, Git, Node.js 24.16.0 and Corepack. Avoid Node.js 24.0 through 24.15 on Windows: their TCP-connect path can crash the process (nodejs/node#63620). Before building, fetch the pinned Step Code upstream revision in the repository root and apply the Windows/Desktop integration patch maintained here.

Run these commands in PowerShell from the repository root:

```powershell
git clone https://github.com/stepfun-ai/Step-Code.git Step-Code
git -C Step-Code checkout b5dbed938d9ae589397cf522dcf2ff89ecf4c494
node scripts/apply-step-code-desktop-patch.mjs Step-Code patches\v015\step-code-desktop.patch

Push-Location Step-Code
corepack pnpm install --frozen-lockfile
corepack pnpm build
Pop-Location

Push-Location Desktop
corepack pnpm install --frozen-lockfile
node node_modules/electron/install.js
corepack pnpm stage:runtime
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
node scripts/verify-electron.mjs
corepack pnpm dev
```

Both published v0.6.0 packages use this v0.1.5 pin and `patches/v015/`
integration. macOS also includes a Darwin process-tree cleanup patch; see
[MACOS.md](docs/MACOS.md). New builds do not alter the provenance of older releases.

To produce a Windows x64 installer:

```powershell
corepack pnpm package
node scripts/checksums.mjs
```

### Project Status

See the [Development TODO](TODO.md) (Chinese) for planned work and priorities.

v0.6.0 remains a community preview, not an official StepFun product or a stability guarantee. Both packages were built from clean commit `195f10f` and cross-reviewed. The maintainer confirmed the final-package experience and the requested Windows fresh-install/overwrite-upgrade checks. Automated coverage, original failures and resumed runs are recorded in the [final release record](docs/releases/v0.6.0-published.zh-CN.md). This does not establish compatibility with every paid model, OS version, provider or MCP service, or a complete production in-app download-to-restart-install test.

See [VERIFICATION.md](docs/VERIFICATION.md) and the [release preparation record](docs/RELEASE.md) (Chinese) for the evidence and scope. The Summary board shows MCP connection states supplied by the runtime; enabled configuration alone is not a health check, and connection status does not establish successful service calls.

### License

Desktop for Step Code is licensed under MIT. Step Code and its Pi upstream components retain their respective licenses and notices.

### macOS Apple Silicon

v0.6.0 shares one Release with Windows and retains native Command shortcuts, zsh, Dock/menu-bar behavior and Keychain. Download links are above. See [MACOS.md](docs/MACOS.md) for builds, writable installation locations and unsigned-app restrictions, and the [final release record](docs/releases/v0.6.0-published.zh-CN.md) for provenance and acceptance. Earlier candidate and platform-handoff documents remain historical, not the current publication status.
