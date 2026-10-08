# 首版发布准备

> 本页保留首版发布前的历史记录，不表示当前尚未发布。第二版候选见 [v0.2.0 草稿与验收记录](releases/v0.2.0-draft.zh-CN.md)，版本规则见 [VERSIONING.md](VERSIONING.md)。

状态：发布文案已准备，尚未发布。核对日期：2026-10-08。

## 定位与候选基线

建议首版定位为 **Windows x64 社区预览版**，而不是稳定版承诺。暂定应用版本 `0.1.0`、tag `v0.1.0`，GitHub Release 勾选 Pre-release；版本和发布操作仍需维护者确认。若需要先公开候选测试，可另定 `0.1.0-rc.1`，并同步应用版本、tag 与说明，不使用同一个 tag 覆盖不同包。

准备工作从 `f3d83c3`（PR #70 合并后的 main）开始。该提交只是本次整理基线，不是已经验收的最终发布提交。文档和必要修复合并后，应重新记录最终 commit，再从该提交构建唯一候选包。

PR #70 的 Windows integration 已通过：
https://github.com/7oMB2006/desktop-for-step-code/actions/runs/37619401736/job/112789625500

这不等于最终 main 安装器通过验收。现有工作流仅由 pull_request 触发，没有 main/tag 发布构建；发布前需要在精确候选提交上执行检查并保存记录。

## 首版范围

纳入已经合并的 Desktop 能力，不为首版继续扩张功能：

- Step Plan / API Key 登录、独立 Desktop 凭据存储、模型和思考等级选择、工具审批。
- 项目和独立会话、拟创建会话、排序与拖动、项目置顶、归档、恢复和永久删除。
- 并发会话、队列与插队引导、会话分支、文本引用、跨会话链接及协作工具。
- 流式正文、思考耗时、子代理状态、摘要板、上下文检查、会话导航。
- 单轮记录改动预览与有限撤销、Git 工作目录及分支差异查看。
- 用户操作的 PowerShell 终端、内置浏览器、只读文件预览、网页和产物引用、文件打开偏好。
- 中英文界面、明暗主题和减少动态效果；新建会话英文语录的扩充延后。

中文新建会话从“让想法阶跃星辰”和“星辰因你而阶跃”中等概率选择首句，随后进入普通语录轮播；英文首句暂时保持不变。保留低频开发者座右铭“踽踽而行 步履不停”。

执行、权限和模型行为仍由固定 Step Code 运行时提供。Desktop 的并发与协作功能不提供文件锁或事务隔离。

当前版本不提供自动检查或自动获取 GitHub 新版的更新机制。后续版本请手动查看项目 Releases 页面并下载安装包。

## 必须通过的发布门槛

以下未勾选项均未在本轮获得最终候选证据，不因历史验收或用户日常使用自动通过。

| 状态 | 门槛 | 通过条件 |
| --- | --- | --- |
| 已核对 | 准备基线 | 最新 main 已包含 PR #70；保留旧脏工作区，不从中直接发包 |
| 已通过 | 版本及候选冻结 | 版本 `0.1.0`；最终 main 提交为 `226a0d629ba2e35e0d6e1e7386942c559c6907e2`；候选源码无未提交修改 |
| 已通过 | 源码验收 | frozen-lockfile 安装、typecheck、串行 unit/protocol tests、build、PR CI 中全部 Electron 检查通过；默认并发 test runner 的卡住情况已单独记录 |
| 已通过 | 补充交互回归 | 候选包的 Context、Diff、撤销、引用、流式滚动专用检查通过；明暗与窄窗截图已生成，仍需发布者最终目视确认 |
| 已通过 | 候选安装器 | 从最终 main 提交生成 NSIS x64 包；未用旧 exe 或只用 unpacked 目录替代 |
| 已通过 | 包内资源 | 已核对 runtime manifest、Node、Step bundle、Desktop helpers、terminal host 及文件打开辅助资源；未发现账户、个人会话、fixture profile 或意外构建目录 |
| 已通过 | 许可证及签名 | 已核对包内许可证与版权声明；Authenticode 实际状态为 `NotSigned`，Release 文案明确说明 SmartScreen 风险 |
| 已通过 | 打包版回归 | 34 项 Electron 验收使用候选包 unpacked executable 与隔离测试 profile；明细见下方 2026-10-07 记录 |
| 已通过 | 真实模型烟测 | Windows Server 2022 云桌面上，真实账户登录、项目/会话加载、Agent 对话、工具改动、审批、产物打开及重启后的历史恢复均已由用户完成验证 |
| 已通过 | 安装生命周期 | 一次性 Windows 云桌面已完成全新安装、登录与基础使用、覆盖安装、卸载和重装；会话/设置保留，卸载后凭据按预期需要重新登录 |
| 已准备 | 文档与校验值 | Release 文案、最终安装器 SHA-256 与 `SHA256SUMS.txt` 已整理；实际上传后的下载核验仍待发布操作 |

详细历史证据保留在 [VERIFICATION.md](VERIFICATION.md)。其多次 source-only / preview package 记录不可拼接为同一个最终安装器的通过记录。

## 安装生命周期

在一次性 Windows VM / 专用测试用户中：

1. 全新安装，确认无需 Desktop 开发依赖即可启动。主机仍需自行提供任务所需 Git/Bash、项目工具和 MCP 服务。
2. 登录，创建项目会话和独立会话；保存测试文件，关闭并重新启动，检查凭据及历史恢复。
3. 从选定的旧预览安装器覆盖升级到候选包，核对会话、设置、文件及凭据保留。旧包也标为 `0.1.0` 时，只能记录为 build-to-build 迁移，不宣称正式跨版本升级。
4. 正常卸载，确认 Step 凭据 `auth.dpapi`、`auth.json`、`legacy-auth.json` 被移除；会话、设置、独立工作区和外部项目文件保留。
5. 重新安装，检查保留数据能读取、账户需重新登录；排查卸载残留进程及注册项。

**不要在日用主机运行 `verify-residue.mjs verify/upgrade`。** 该脚本涉及固定安装目录及清理操作；必须先在一次性环境核对其路径和行为。凭据清理仅指 Desktop Step 凭据，不包括任意 MCP 配置中的秘密，也不表示删除全部个人数据。

## 构建与证据记录

当前 main 的 `pnpm package` 会 build、stage runtime，再调用 electron-builder。不能假设旧工作区的 `scripts/package.mjs` 已合并，也不能跳过固定 runtime 校验复用未知来源的 dist。

运行时预期：Step Code `519e4de4ed2162d3667be1821cb92ada6b884e5a`，Node `v24.15.0`，应用仓库维护的 Desktop 集成补丁。独立 `Step-Code/` checkout 与 staged runtime 分开管理；此次整理不修改该 checkout。

候选证据记录应包含：

```text
应用版本 / tag：`0.1.0` / `v0.1.0`（待创建）
候选 Desktop commit：`226a0d629ba2e35e0d6e1e7386942c559c6907e2`
构建日期及 Windows 环境：2026-10-08，本机 Windows x64
Step Code commit / patches / Node：`519e4de4ed2162d3667be1821cb92ada6b884e5a` / manifest 中记录的 Desktop 集成补丁 / `v24.15.0`
安装器文件名 / 字节数 / SHA-256：`Desktop for Step Code Setup 0.1.0.exe` / `156676739` / `7b1fc243a73bb1c650e67d03f9f54a74ed1de2381ac8cc8c532555c80f39d5ee`
Authenticode 状态：`NotSigned`
源码与打包版检查结果：已通过；默认并发 test runner 的卡住情况已单独记录
真实账户烟测：2026-10-08 Windows Server 2022 云桌面完整 smoke 通过，不保存凭据
安装 / 迁移 / 卸载 / 重装：2026-10-08 测试云桌面通过；旧包同版本覆盖安装按 build-to-build migration 记录
未验收项与已知限制：默认并发 test runner 的稳定性风险、未签名安装器的 SmartScreen 提示、Server 2022 单环境边界及文案中列出的其他限制
发布授权：尚未获得；尚未创建 tag、GitHub Release 或上传附件
```

构建完成后只生成该候选的 `SHA256SUMS.txt`，避免把 release 目录中旧 exe 一起当成首版附件。大型产物先盘点精确路径、占用及进程；删除旧包另行获得授权。

## 发布步骤

1. 完成门槛并把证据摘要写回 VERIFICATION；未通过的关键项阻止发布。
2. 确认 [首版说明草稿](releases/v0.1.0-draft.zh-CN.md) 与实际候选能力、版本和限制一致。
3. 维护者明确授权后，创建指向冻结提交的 tag 和 GitHub Pre-release，上传 NSIS 安装器与 SHA256SUMS；发布前不要在 README 声称已有下载。
4. 读取已发布元数据、下载附件并核验哈希，确认链接后再更新 README 下载入口。
5. 仅保留当前候选与必要证据；历史包清理不与发布授权混同。

## 2026-10-07 本地候选记录

这份记录用于发布准备，不表示发布门槛全部通过。候选应用代码来自 `f3d83c30ecdc82df46542c773e1ef9c8f44319f3`；随后修改的是验收脚本和发布文档，不涉及候选应用代码。发布文档尚未合并，最终 tag 提交仍待冻结。

- 本地日用工作区已备份并 fast-forward 到 main；备份 ref 为 `refs/backups/pre-release-workspace-2026-10-07`。原来的独立 Step-Code 开发 checkout 保留。
- 从独立 worktree 的 pinned Step Code 应用仓库补丁，frozen-lockfile 安装、构建并重新 staging 成功。上游构建联网生成模型目录，tracked 差异只有 `.manifest.json` 生成时间戳，结构哈希未变；不宣称构建逐字节可复现。
- Desktop typecheck、串行模式下 220 项 unit/protocol tests 和 production build 通过。默认并发 test runner 本轮曾在 `terminal-sessions.test.ts` 停住；该测试随后以 `--test-concurrency=1` 单独和全套复验均通过，暂记为测试编排/fixture 并发稳定性风险，而不是产品用例失败。构建仍提示 renderer 大 chunk，不作为已经优化的性能承诺。
- NSIS 安装器：`Desktop/release/v0.1.0-candidate/Desktop for Step Code Setup 0.1.0.exe`，`156676788` bytes。
- SHA-256：`6d20c9c911e7832c0f1af6feeee15a9a51d0152f738e31d4ae7177552bcb1db0`；同目录包含仅记录该安装器的 `SHA256SUMS.txt`。
- 安装器 Authenticode 为 `NotSigned`。electron-builder 的 signing 日志不代表实际具有签名证书。
- 包内 manifest、Node、Step entry bundle、两份 Desktop helpers、terminal host 和文件打开辅助脚本与 staged/build 资源哈希一致。app.asar 根目录仅有 `node_modules`、`dist`、`package.json`，无旧 release/test-results 或源码工作目录。
- 包含 Desktop/Step MIT、Step NOTICE/THIRD_PARTY_NOTICES、Node LICENSE、Electron/Chromium 许可与依赖许可文件；这不是对所有第三方材料的法律审计。
- 候选安装器与 unpacked 合计约 712 MiB。旧包尚未删除，日用中的 `file-opening-persistent-preview` 进程未中断。
- 候选包 34 项 Electron acceptance 通过，使用 `DESKTOP_VERIFY_EXE` 指向候选的 `win-unpacked` 可执行文件和隔离 fixture profile。覆盖 account settings、归档、auth vault、background subagents、browser、chat quotes、composer、context、conversation timing、crash log、cross-session、file preview、message feedback/links/order、拟创建会话、permission approval、review/diff、queue、branching、concurrency、sidebar order/scrollbar、StepPage registration、stream motion、subagent status、summary board/resize/runtime、terminal、theme bootstrap、turn artifacts/changes/undo。结果清单为 `Desktop/test-results/release-candidate-checks.json`；fixture pass 不等同于真实账户验收。
- 候选包的通用 `verify-electron.mjs` 和 `verify-cross-session.mjs` 通过。后者发现指定 packaged executable 会绕过 Playwright loader 注入 `CDPScreenshotNewSurface`；已在脚本里显式补上该 feature 并复验。初次两次截图超时记录留在本地日志，不计为产品故障。
- 候选应用源码 typecheck、串行 `--test-concurrency=1` 下 220 项 unit/protocol tests 和 production build 已通过；默认并发 runner 的本轮卡住已复现并停止，不能表述为并发模式通过。runtime manifest 仍匹配 Step Code `519e4de4ed2162d3667be1821cb92ada6b884e5a` 和 Node `v24.15.0`。
- 截至该日记录，真实账户烟测及一次性 Windows VM 对此候选安装器的全新安装/升级/卸载/重装尚未完成；后续 2026-10-08 云桌面完整补测已补齐这些证据。此前 Issue #5 VM 测试针对另一候选，不能替代本次候选证据。未创建 tag、GitHub Release 或上传附件。

## 2026-10-08 Windows Server 2022 云桌面基础烟测

用户在阿里云无影个人云桌面的 Windows Server 2022 Datacenter 21H2 环境安装并启动候选安装器，以自己的账号进行了基础交互测试，并确认“一切正常”。截图可见应用版本 `0.1.0`、Step Code 已连接、项目会话已加载、Agent 对话已返回，输入区及本轮/会话上下文统计可用。此次观察支持该安装包在此 Server 2022 云环境完成安装、启动、登录和基础对话；不外推为 Windows 10/11 覆盖，也不把未见证的任务细节记作通过。

该记录只覆盖基础安装、启动、登录和对话；审批、应用重启后的历史/凭据恢复、真实工具改动、产物打开及安装生命周期在下面的补充记录中完成。候选文件 SHA-256 再次核对为 `6d20c9c911e7832c0f1af6feeee15a9a51d0152f738e31d4ae7177552bcb1db0`；该包构建于 2026-10-07，早于当前发布准备提交，仍需在最终冻结提交上重建并复验哈希。PR #72 已在当前发布准备提交上通过 Windows integration CI。

## 2026-10-08 Windows Server 2022 云桌面完整烟测补充

用户继续在同一台阿里云无影 Windows Server 2022 Datacenter 21H2 云桌面上完成剩余验收，结果全部成功：Agent 实际修改小文件并完成审批，产物可打开；退出并重新启动应用后登录状态与会话历史恢复；在测试云桌面完成覆盖安装、卸载和重新安装，确认会话/设置保留且卸载后的账户凭据按预期需要重新登录。该结果将真实模型烟测和安装生命周期门槛提升为已通过，但仍只代表该 Server 2022 测试环境，不等同于 Windows 10/11 全覆盖。

这些测试针对前一份候选包完成；最终 main 候选已按下方记录重新构建并复核哈希。当前尚未创建 tag、GitHub Release 或上传附件。

## 2026-10-08 最终 main 候选

PR #72 已合并，最终 main 提交为 `226a0d629ba2e35e0d6e1e7386942c559c6907e2`。已从该提交重新生成 Windows x64 NSIS 安装器：

- 文件：`Desktop/release/Desktop for Step Code Setup 0.1.0.exe`
- 大小：`156676739` bytes
- SHA-256：`7b1fc243a73bb1c650e67d03f9f54a74ed1de2381ac8cc8c532555c80f39d5ee`
- Authenticode：`NotSigned`
- runtime：Step Code `519e4de4ed2162d3667be1821cb92ada6b884e5a`，Node `v24.15.0`

该安装器对应最终 main，且包内资源核对通过。`Desktop/release/SHA256SUMS.txt` 只记录此安装器。尚未创建 tag、GitHub Release 或上传附件；发布后仍需从 GitHub 下载附件复核哈希。
