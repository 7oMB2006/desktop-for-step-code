<h1 align="center">Desktop for Step Code</h1>
<p align="center">Let ideas reach the stars.</p>
<p align="center"><a href="#zh-cn">简体中文版本</a></p>

<p align="center">
  <img src="assets/readme/home-zh.png" width="360" alt="Desktop for Step Code home screen in Chinese">
</p>

A Windows desktop client for Step Code. It provides desktop workspaces, conversations, and session management; Step Code powers agent execution.

### Why This Project

The original idea was to use the window before StepFun officially released Step Code Desktop to explore a community-built desktop client for Step Code, while looking forward to StepFun's official release.

**Windows x64 · Electron · React · TypeScript**

### Features

- Streaming conversations, model and thinking-level selection
- Independent sessions and project workspaces, with session history and renaming
- Image attachments, tool-call confirmations, and recoverable session deletion
- Step account sign-in, MCP configuration, and resource discovery
- Chinese and English UI, with light and dark themes

The app keeps its data in a dedicated directory (`%APPDATA%\Desktop for Step Code`) instead of reusing a personal Step Code CLI profile. Agent execution stays with Step Code; this project does not add another harness.

### Download and Run

This repository currently provides source code. There is no public installer on GitHub Releases yet. The installer and release timing will be decided after release acceptance; locally generated installers are not included in this repository.

Running from source requires Windows x64 and the development dependencies below. On first launch, sign in under Account Settings with your own Step Plan account or Step Platform API key, then open a local project. Git/Bash, project-specific CLI tools, and MCP server dependencies must be installed on the host separately.

### Build from Source

Requirements: Windows x64, Git, Node.js 24.15.0 (or a compatible Node.js version `>=22.19`), and Corepack. Before building, fetch the pinned Step Code upstream revision in the repository root and apply the Windows/Desktop integration patch maintained here.

Run these commands in PowerShell from the repository root:

```powershell
git clone https://github.com/stepfun-ai/Step-Code.git Step-Code
git -C Step-Code checkout 7dd66cb9f11a40ba19285b620084b362892cadea
git -C Step-Code apply ../patches/step-code-desktop.patch

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

To produce a Windows x64 installer:

```powershell
corepack pnpm package
node scripts/checksums.mjs
```

### Project Status

This is a community preview and has not completed full public-release acceptance. Real account authorization, paid-model tasks and real tool-approval flows, plus installation, upgrade, and uninstall on a clean Windows environment, still need verification. MCP status currently reflects whether configuration is enabled, not whether a connection is healthy; some advanced extension UI is also not yet covered.

### License

Desktop for Step Code is licensed under MIT. Step Code and its Pi upstream components retain their respective licenses and notices.

<a id="zh-cn"></a>

## 简体中文

一个面向 Windows 的 Step Code 桌面客户端。它提供桌面工作区、对话和会话管理，Agent 执行由 Step Code 提供。

### 项目初衷

项目最初的想法，是在 StepFun 官方尚未正式推出 Step Code Desktop 的窗口期，尝试开发一个社区版 Desktop；同时也期待 StepFun 早日发布官方版本！

**Windows x64 · Electron · React · TypeScript**

### 功能

- 流式对话、模型与思考等级选择
- 独立会话和项目工作区，会话历史与重命名
- 图片附件、工具调用确认和可恢复的会话删除
- Step 账户登录、MCP 配置与资源发现
- 中英文界面和明暗主题

桌面端使用单独的应用数据目录（`%APPDATA%\Desktop for Step Code`），不复用个人 Step Code CLI 配置。项目沿用 Step Code 的 Agent 运行时，不额外加入新的 Harness 能力。

### 下载与运行

当前仓库提供源码，GitHub Releases 暂无公开安装包。安装包和发布时间将在完成发布验收后另行确定；本机生成的安装文件不包含在仓库中。

从源码运行需要 Windows x64 环境和下方列出的构建依赖。首次启动后，在账户设置中使用自己的 Step Plan 账户或 Step Platform API Key 登录，再打开本地项目。Git/Bash、项目专用命令行工具以及 MCP 服务端依赖需在主机上另行安装。

### 从源码构建

需要 Windows x64、Git、Node.js 24.15.0（或兼容的 Node.js `>=22.19`）和 Corepack。构建前需在仓库根目录获取固定版本的 Step Code 上游代码，并应用本仓库维护的 Windows/Desktop 集成补丁。

在仓库根目录的 PowerShell 中运行：

```powershell
git clone https://github.com/stepfun-ai/Step-Code.git Step-Code
git -C Step-Code checkout 7dd66cb9f11a40ba19285b620084b362892cadea
git -C Step-Code apply ../patches/step-code-desktop.patch

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

生成 Windows x64 安装程序：

```powershell
corepack pnpm package
node scripts/checksums.mjs
```

### 当前状态

这是社区预览版，尚未完成完整的公开发布验收。真实账户授权、付费模型任务与真实工具审批流程，以及干净 Windows 环境中的安装、升级和卸载仍需验证。MCP 状态目前反映配置是否启用，不代表连接健康检查；部分高级扩展界面也尚未覆盖。

### 许可

Desktop for Step Code 源码采用 MIT 许可证。Step Code 及其 Pi 上游组件保留各自许可证和版权声明。
