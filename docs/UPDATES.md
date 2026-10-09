# GitHub 版本检查

已随 Windows x64 社区预览版 [v0.2.0](https://github.com/7oMB2006/desktop-for-step-code/releases/tag/v0.2.0) 发布。`v0.1.0` 安装包不包含本功能，需手动下载安装包升级。下方各预览结果保留为历史验收记录，不代表当前发布状态。

## 使用与边界

- 设置 → 版本更新：独立页面显示 Electron `app.getVersion()`，手动检查更新、版本说明和官方发布页，不挤占通用设置。
- Windows x64 打包版默认在启动后 10 秒检查，此后每 6 小时检查；可以关闭自动检查。开发模式和隔离验收不会自动访问网络。
- 默认通道包括正式版与预览版，因为首版 `v0.1.0` 被标为 GitHub Pre-release。可以选择仅正式版，选择会持久保存。
- 新版在左栏设置入口显示品牌色小点和“有更新”；点击进入版本更新页，不创建会话、不打断任务。已确认的更新提示不会因后台复查或临时断网消失，成功检查确认没有更高版本后才清除。
- “下载安装包”交给系统浏览器下载官方 Release 附件；**不自动下载到客户端，不静默安装，不自动重启**。安装前结束运行中的任务。
- 没有 Windows 安装包时仍显示新版，但不提供下载按钮。不把旧安装包冒充为最新版本。
- GitHub 的断网、超时、限流和响应异常保留为失败状态，不视为“没有更新”。限流期间遵守重试时间；发布页仍可打开。
- 不访问 Step 账户凭据，不修改上游 runtime，不使用本机 GitHub 登录或 Token；检查过程仅请求公开发布信息。

## 比较与请求

客户端优先读取固定仓库 `update-feed` 分支的静态 `latest.json`：

`https://raw.githubusercontent.com/7oMB2006/desktop-for-step-code/update-feed/latest.json`

清单包含 schema 版本、仓库身份、生成时间、正式版及包含预览的通道头；客户端严格验证版本/tag、通道、官方发布地址和安装包地址。**客户端不再调用 `api.github.com`，也不带 GitHub 凭据。** 静态文件仍可能遇到网络故障或站点限制，并非保证 GitHub 永远可用。

仅当清单返回 404（尚未部署）时，默认通道读取官方 `releases.atom` 订阅作为临时发现途径。它只能覆盖近期发布，不能确认 GitHub 的 Pre-release 标记或附件列表，因此页面明确显示“近期发布中未发现更高版本”，不伪造通道身份或安装包。发现新版本时仍显示左下角提示并允许打开该版本发布页。正式版通道不拿 Atom 猜测状态，清单缺失时显示“正式版更新清单尚未发布”。无效清单、限流和其他失败不静默降级成成功。

使用 `semver` 比较版本，不按发布时间或字符串顺序猜测版本高低。同版本和更低版本不提示升级；构建元数据不构成升级。草稿、非版本 tag 及通道不接受的预览版本不参与比较。

每个响应上限 2 MiB，整个请求链超时 15 秒。并发检查共享请求，同一通道检查间隔至少 1 分钟，限流退避跨通道生效。请求重新验证网络缓存；切换通道或退出时取消旧请求，旧结果不能覆盖新通道。订阅使用 XML 解析器，拒绝语法错误、DTD、外部实体及其他仓库的链接，不执行其中的 HTML。

下载入口仅接受对应版本、对应仓库、已上传且尺寸合理的既定 NSIS 安装包名。附件地址必须是固定 GitHub 仓库的 HTTPS Release 下载路径，不允许外部域名、凭据、查询串或额外片段。前端不能提交任意下载 URL。

版本说明以受限 Markdown 展示，不执行 HTML，也不加载其中的远程图片或提供任意链接跳转。该检查不等于对安装包内容或签名的验证；当前公开安装包仍未签名。

## 同类实现调查

2026-10-08 阅读了下列一手文档及源码，没有复制界面或引入它们的更新控制器：

- [Electron 更新文档](https://github.com/electron/electron/blob/main/docs/tutorial/updates.md)：内置自动更新依赖平台专用 feed，不等于发现一个 `.exe` 就能更新。
- [OpenChamber 更新说明](https://github.com/openchamber/openchamber/blob/main/packages/docs/content/docs/updates.mdx)及 [检查控制器](https://github.com/openchamber/openchamber/blob/main/packages/electron/updater-check.mjs)：将检查结果、下载和用户确认安装分开。
- [OpenCode 更新控制器](https://github.com/anomalyco/opencode/blob/dev/packages/desktop/src/main/updater-controller.ts)：显式区分检查、下载、准备就绪和安装状态，并合并并发请求。
- [GitHub Releases API](https://docs.github.com/en/rest/releases/releases)：正式版与预览版的 API 语义不同。
- [Codex++ 更新服务](https://github.com/BigPizzaV3/CodexPlusPlus/blob/main/crates/codex-plus-core/src/update.rs)及[静态清单发布流程](https://github.com/BigPizzaV3/CodexPlusPlus/blob/main/.github/workflows/release-assets.yml)：把有凭据的发布阶段 API 查询与无凭据的客户端静态文件查询分开。
- [electron-updater GitHub Provider](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/GitHubProvider.ts)：使用公开发布订阅作为发布信息来源。

本项目首版资产是手动上传的 NSIS `.exe` 和校验文件，没有 `latest.yml` 等自动更新 feed。本轮先建立检查/通知/官方下载安装入口，不切换打包技术、不替换已有 Release。若后续做客户端内下载或自动安装，需要单独规划校验、签名、更新元数据、失败恢复以及运行中任务保护。

## 清单发布

`.github/workflows/update-feed.yml` 在 Release 发布、撤回、编辑、删除及正式/预览状态变更时运行，也支持手动刷新。发布工作流仅检出 `main` 的脚本，不执行 Release tag 的代码；通过工作流自己的仓库令牌查询发布目录，生成并验证两类通道头，再以普通非强制 push 更新专用 `update-feed` 分支的 `latest.json`。不修改 `main`、安装包或其他 Release 附件。分支保护和仓库 Actions 权限可能阻止发布，需要维护者处理，不绕过。

首次启用须先合并这套代码到 `main`，然后手动执行一次 **Publish Update Manifest**。之后应在附件上传齐全后发布 Release；单独增删附件不保证触发 Release 事件，需手动刷新清单。生成器筛选草稿、非版本 tag，并保留最新版缺失安装包的真实状态；删除/降级为草稿的发布在下一次生成时移出。

本地只生成验证文件、不部署：

`corepack pnpm exec tsx scripts/generate-update-feed.mjs test-results/update-manifest-live.json`

这条维护命令使用本机 `gh` 授权；**不是客户端路径**，不会把凭据写入清单。工作流和静态清单的部署状态应另行核对，不以本地生成成功作为部署证据。

## 验收

- `corepack pnpm typecheck`
- `corepack pnpm exec tsx --test --test-concurrency=1 tests/*.test.ts`
- `corepack pnpm build`
- `node scripts/verify-app-updates.mjs`：本地 fixture，状态、可信链接、缺失安装包、失败与限流、明暗、窄窗、中英文、减少动态效果、偏好和重启。
- `node scripts/verify-app-update-source.mjs`：可选真实匿名 GitHub 检查，不纳入 CI、不下载可执行文件、不使用日用 profile。`--local-proxy` 仅在这次隔离验收显式使用本机临时代理，不改生产配置。
- 通用 Electron、左栏排序和账户设置回归。

截图保存在 `Desktop/test-results/app-updates-*.png`。fixture 中的 `0.2.0` 是隔离测试数据，不代表存在该公开版本。

### 第一版 API 预览结果（2026-10-08，已被静态方案取代）

类型检查、232 项单元/协议测试、构建、更新页面 fixture、通用 Electron、左栏排序和账户设置验收通过。版本更新移为独立设置页后，重新通过类型检查、11 项更新单测、构建和页面验收；最终打包版也通过更新页面、通用 Electron 和账户设置验收。验证了通用页不再包含更新区，以及“有更新”直接进入版本更新页。

- 安装包：`Desktop/release/github-updates-preview/Desktop for Step Code Setup 0.1.0.exe`
- 大小：156,743,898 字节；本次输出目录约 0.70 GiB，包含安装包与免安装体验目录。
- SHA256：`9f794c75553987b7d33433578a6dd375f516de7c110a756e224310a0941c170f`
- 未签名；仍为本地 `0.1.0` 预览，不替换公开首版、不代表新 Release。
- 包内 runtime 固定为 `519e4de4ed2162d3667be1821cb92ada6b884e5a` / Node `v24.15.0`；包含 semver 许可证。

真实匿名 Electron 请求在当前网络出口遭遇 GitHub API 限流，因此**真实匿名联网成功路径尚未通过**，不能将 fixture 通过当成实网通过。另用研究阶段的 GitHub 元数据验证了版本投影：公开 `v0.1.0` 被识别为预览版，其 Windows 安装包大小为 156,676,739 字节，仅正式版通道没有版本。该研究请求不属于产品检查流程，产品不会读取或注入本机 GitHub 凭据。

这一旧包未验证安装/卸载生命周期，没有下载或安装模拟新版；随后按用户要求更新了日用快捷方式。公开 Release 和已有应用进程未改动。历史包及误安装生成的根目录 `node_modules/` 未清理，不纳入提交。

### 静态清单版预览结果（2026-10-08）

类型检查、236 项单元/协议测试、生产构建通过。最终打包版通过更新页面 fixture、匿名真实联网、通用 Electron 和账户设置验收。覆盖静态清单身份/通道/官方附件校验、清单缺失后的 Atom 发现、正式版不猜测、后台复查失败保留提示、提示进入独立页面、偏好保存及重启、明暗/640px/英文/减少动态效果。

验收脚本对异步 checkbox 保存增加了完成等待，并在窄窗检查后恢复桌面尺寸再断言左栏提示可见；未弱化保存或可见性断言。真实联网的源码版及打包版均返回 `current` / `0.1.0` / `release-feed`，无需测试代理参数或 GitHub 凭据。静态生成器根据实际 Release 生成的本地验证文件为 `test-results/update-manifest-live.json`：正式版为 null，包含预览的通道为 `0.1.0`。发布工作流通过 YAML 校验，但尚未上云运行，静态清单尚未部署。

- 安装包：`Desktop/release/github-static-updates-preview/Desktop for Step Code Setup 0.1.0.exe`
- 大小：156,939,973 字节；输出目录 748,233,389 字节（约 0.70 GiB）。
- SHA256：`16ed83bcba762428d194652a00743f1c7acb9d7b87ccb7134908c9350574df56`
- Authenticode：`NotSigned`；本地版本仍是 `0.1.0`，不是新的公开 Release。
- 包内 runtime 仍为固定 `519e4de4ed2162d3667be1821cb92ada6b884e5a` / Node `v24.15.0`，包含 semver 与 xmldom 许可证。
- 桌面 `Desktop for Step Code.lnk` 已核验指向该目录的 `win-unpacked/Desktop for Step Code.exe`，工作目录及图标一起更新；旧包进程未中断。

证据：`test-results/app-updates-sidebar-badge.png` 为模拟新版的独立左下角提示，`test-results/app-updates-live-github.png` 为实际联网检查。没有安装/卸载新候选、没有下载安装模拟新版，没有创建 PR、发布静态分支或修改公开 Release。用户新增的 TODO 项和根目录生成产物保持原样。

### 软件内操作菜单版预览（2026-10-08，已被设置选择器取代）

更新通道已由浏览器原生 select 改为现有 AppMenu，复用自绘展开箭头、选中标记及三次方缓动。类型检查、生产构建和源码/打包版更新页面验收通过，覆盖鼠标选择、键盘打开与导航、Escape 焦点返回、点击外部关闭、640px 窄窗边界、减少动态效果及偏好重启保留；打包版账户设置与通用 Electron 回归通过。未修改更新源或上游 runtime。

- 历史体验包：`Desktop/release/github-updates-menu-preview/Desktop for Step Code Setup 0.1.0.exe`
- 大小：156,940,505 字节；输出目录 748,234,761 字节（约 0.70 GiB）。
- SHA256：`23b00f195d3adf833adf7c687184b5695f087904508ca8a61526aff2580f6922`
- Authenticode：`NotSigned`；本地版本仍为 `0.1.0`，未发布新 Release。
- 桌面 `Desktop for Step Code.lnk` 已改指向此包的 `win-unpacked/Desktop for Step Code.exe`，工作目录与图标同步更新。
- 菜单截图：`test-results/app-updates-channel-menu-light.png`、`test-results/app-updates-channel-menu-narrow.png`。

上一静态清单包仍有用户进程运行，未停止或删除；新包在独立目录生成。未创建 PR、推送或部署更新清单。

### 统一设置选择器预览（2026-10-08）

用户指出更新通道应与通用设置的会话排序一致，而非使用右对齐的操作菜单。已移除 AppMenu，直接复用通用设置使用的 `base-select` 与共享样式：等宽选择面板、选中底色、右侧勾选，无操作图标。没有修改共享选择器或其他设置项。

类型检查、生产构建、源码及打包版更新页验收通过。验证共享 appearance、选择面板宽度、键盘打开、Escape 焦点、外部点击关闭、窄窗选项可见、减少动态效果及通道保存/重启；打包版账户设置回归通过。

- 当前体验包：`Desktop/release/github-updates-settings-select-preview/Desktop for Step Code Setup 0.1.0.exe`
- 大小：156,940,214 字节；输出目录 748,233,378 字节（约 0.70 GiB）。
- SHA256：`54cbee1ff4282ebe23964ad1a1a34998efe9e0d4245e456245ba58ce155b38c9`
- Authenticode：`NotSigned`；本地版本仍为 `0.1.0`，未发布新 Release。
- 桌面快捷方式的目标、工作目录及图标已同步指向新体验包，参数为空。

原操作菜单包仍有用户进程运行，未覆盖、停止或删除。截图沿用 `test-results/app-updates-channel-menu-light.png` 与 `test-results/app-updates-channel-menu-narrow.png`，已重新生成。没有创建 PR、推送或部署。
