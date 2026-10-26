# Desktop Command Inventory

Audited against the staged Windows runtime pin
`b5dbed938d9ae589397cf522dcf2ff89ecf4c494` on 2026-10-23.
The macOS preview still stages `3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8`,
which has no native Usage extension; the Desktop Usage mapping is shared.
`get_commands` remains the authority for runtime extensions, skills and prompt
templates. Desktop adds its own Status, trust and compact entries and the two
core CLM commands absent from that reply.

## Presentation

The discovery menu, editable command markers and sent user messages share
`Desktop/src/command-presentation.ts`. Usage uses the bar-chart icon; Cron
uses the sidebar clock. Workflow uses the flow-node icon, while Ultracode retains
the network. Project trust uses a checked folder; permissions retain the shield.
Context commands share a live context-usage ring with a 3px track: Compact uses
an `o` badge and both CLM entries use `l`. Menu descriptions spell out Compact
compression, CLM status/control and manual CLM organization, together with the
current session's context percentage or an explicit unknown state.
The rings all represent the same current-session usage, not separate Compact/CLM
measurements or historical per-message usage. They reuse the footer ring's
percentage semantics; decorative icons add no focus stops and their badges are
excluded from selection. A pending session switch shows unknown until its
snapshot is available.
Skills use the book icon
and prompt templates the sparkle, even when their names resemble built-ins.
Unknown discovered commands use the command glyph without a repeated slash
label. `todos` is the current upstream spelling; the old `todo` presentation
is retained only for runtimes that actually advertise it.

Commands can be marked after prose, whitespace or newlines, including multiple
occurrences. Code, links and paths remain ordinary source. Decorations do not
rewrite editable text, clipboard content or transport. An inline reference such
as `explain /clm` is not an instruction to execute CLM. Assistant prose and quoted
excerpts do not acquire command markers.
Sent-message matching uses the original Markdown source boundaries and maps
decoded escapes/entities back to the displayed text. The visual slash replacement
retains a selectable slash, so selecting transcript text does not remove it.

## Dispatch

| Entry | Current Desktop behavior | Validation or remaining boundary |
| --- | --- | --- |
| `/usage`, `/usage overview` | Open the existing local Usage overview | Electron fixture verifies no prompt submission |
| `/usage account` | Open Account settings, including existing allowance/balance UI | Electron fixture verifies the selected settings tab; no new balance API |
| `/cron` | Open the existing scheduled-task manager | Electron fixture verifies no prompt submission |
| `/cron list`, `/cron status`, `/cron delete <id>` | Retain upstream parameter handling | Real runtime read-only list tested; this audit does not create or delete live jobs |
| `/status` | Open the existing right-panel Status view | Existing dedicated Desktop mapping retained |
| Model, permissions and MCP actions | Open their existing Desktop controls | Existing discovery acceptance retained |
| `/compact [instructions]` | Call the `compact` RPC with `customInstructions` | Fixture covers success, failure retaining the draft, and busy rejection; actual model summarization is separate acceptance |
| `/todos` | Upstream task-list notification | Empty list tested against the real bundle; a right-panel shortcut remains future work |
| `/workflows` | Desktop read-only top drawer for saved definitions and recent project runs | Bare command only; parameters retain upstream routing; not the current agent inspector |
| `/clm` | Opens the CLM inspector after Context and Status | Read-only active-branch revisions, saved contents and runtime diff; no model request |
| `/clm on\|off\|diff\|reset`, `/clm-compact [instructions]` | Existing core working-context handlers | Parameterized commands retain their native semantics; manual organization may use the model |
| `/plan` | Existing upstream plan-mode handler and Desktop approval flow | On/off state verified against the real bundle; no change to approvals |
| `/goal` | Existing upstream goal handler | Read-only empty status verified; starting/resuming goals is not part of this audit |
| `/ultracode`, `/ultraloop` | Existing upstream multi-agent handlers | Read-only status verified; the redundant alias is hidden when Ultracode is advertised |
| `/plugin`, `/plugin browse`, `/plugin marketplace` | Open installed plugins, Discover or marketplace sources in Desktop settings | Isolated real-runtime management and Electron acceptance cover install/uninstall; mutating commands only prepare a page for explicit confirmation |
| `/skills`, `/mcp` | Open the dedicated Skills or MCP settings | Configuration is distinct from live-session availability; changes require a new session or explicit restart |
| `/feedback` | Existing upstream feedback flow, requiring a configured endpoint | Real category dialog cancelled against a loopback endpoint; no logs, conversation or feedback uploaded |
| `/init` | Upstream submits an initialization task through the normal agent path | Loopback model verifies the AGENTS.md instruction arrives and the turn ends; no real AGENTS.md generation claimed |
| `/trust` | Existing Desktop project-trust confirmation | Existing focused trust tests retained |
| Skills and prompt templates | Runtime-discovered entries, existing expansion/dispatch | Source icons preserved; arbitrary installed resources are not all validated |

Desktop interception requires a complete standalone recognized command with no
attachments or quoted messages. Usage arguments other than `overview` or
`account`, and parameterized Cron commands, are passed through unchanged.
In particular, upstream Usage refresh flags are not yet Desktop aliases.
Compact requires a connected, existing, idle session and is never queued as
ordinary prose while a task is running.

## Desktop Adaptation Backlog

2026-10-23 清点：以下是待讨论和待适配清单，不代表本轮已经实现。
同一类型按 `[Ⅰ]`、`[Ⅱ]` 分阶段；已有能力不重复算作未实现。

### [Ⅰ] 图标与可用性

- [x] `/workflows` 使用 Workflow，`/ultracode` 保留 Network，
  区分工作流记录与多代理编排；同义别名仍复用相同图标。
- [x] `/compact`、`/clm`、`/clm-compact` 统一为上下文图标家族，
  共用当前会话占用圆环，3px 环宽；用 o／l 小角标区分 Compact 与 CLM，
  通过完整备注区分压缩对话、查看状态和手动整理，不伪造两套占用统计。
- [x] `/trust` 使用 FolderCheck，`/permissions` 保留 Shield，
  区分项目信任与会话访问权限。
- 暂缓 `/feedback`：目前没有 Desktop 反馈接收端，本轮不实现发送。
  当前打包体验
  返回 “Feedback endpoint is not configured.”，不能算反馈可用。
  接收地址、提交内容与用户确认方式需另行敲定，不自动上传会话或日志。

### [Ⅱ] 已有后端、缺少专用桌面映射

| 指令 | 现状 | 待适配边界 |
| --- | --- | --- |
| `/todos` | 返回上游清单通知 | 映射到已有右栏清单；保留空状态与历史边界 |
| `/workflows` | 裸命令已接只读顶部抽屉，展示项目／Desktop 保存项与近期项目运行 | 安装包及双平台验收待完成；运行详情、启动、重试与恢复不在本轮范围 |
| `/clm`、`/clm-compact` | CLM 独立页已接真实分支修订查询；面板启停和手动整理复用上游命令 | Windows v0.1.5 增加只读 RPC；旧运行时明确显示接口不可用，尚未声明安装包验收 |

`/plugin` 已映射至专用插件管理页，隔离运行时和 Electron 验收覆盖本地市场安装、
卸载及配置生效；真实第三方登录、首次安装和打包验收仍需分别完成。

`/workflows` 本身只查询列表，不负责启动工作流。工作流执行是上游
`workflow` 工具的能力；保存的工作流定义、历史运行与当前轮代理状态是不同对象，
后续界面不能混成同一个列表。

### [Ⅲ] 参数入口与验收边界

- [ ] `/cron` 带参数操作保留上游语义；核对是否需要复用已有定时管理界面。
  裸命令打开管理页已经完成，不重复列为缺口。
- [ ] `/usage` 刷新等其他参数尚无 Desktop 别名；总览和账户入口已完成，
  后续与 Usage 主线协调，不另造统计页面。
- [ ] `/plan`、`/goal`、`/ultracode` 保留现有模式适配，补齐各自操作场景验收，
  不能因只测过状态查询就宣称全流程可用，也不能整体标为未映射。
- [ ] `/init` 已走正常 Agent 任务链路；真实项目生成结果仍需验收，
  不应为此另造配置页面。
- [ ] 技能和提示模板按运行时来源保留动态入口；逐项资源验收与内置指令映射分开。

`/status`、模型、权限、MCP、`/compact`、`/trust` 等已有 Desktop 映射，
不在本次“未映射”清单中。

### 工作流只读面板

正式接入属于 [TODO P0](../TODO.md) 中 v0.6.0 之后的下一版工作，
尚未声明发布或安装包验收。裸 `/workflows` 在 Desktop 本地打开抽屉，
不发送模型请求；带参数、附件、引用或普通正文仍走原有分流规则。

主进程只读当前项目的 `.stepcode/workflows/saved`、`runs`，
以及 Desktop 隔离存储中的 `workflows/saved`，不读取个人 CLI 配置。
不执行保存的脚本，不将路径或原始运行 JSON 交给渲染进程。
同名保存项以项目为准；最多展示 100 个保存项和最近 20 个运行记录。
损坏、未知格式、部分读取和截断均有提示；历史活动状态未经存活确认显示未知，
不伪装为当前会话仍在运行。定义、项目历史与当前轮代理保持区分。

`Desktop/tests/fixtures/workflow-catalog.html` 使用正式 React 组件和模拟数据，
原 `workflow-panel.html?view=icons` 图标预览保持不变。顶部三次方缓动滑入和收回，
5 秒后自动收起；悬停、聚焦、展开说明或拖动时暂停计时。
底部抓手支持上推至少 48px 收起、短距离拖动回位，以及点击或键盘激活收起；
保留关闭按钮、Esc、亮暗色、空状态、长列表滚动和减少动态效果适配。

## Hidden Shell Commands

`exit`, `quit`, `theme`, `llama`, `clear` and `new` are not offered as Desktop
slash-menu entries. Application lifecycle, appearance and session navigation
use existing Desktop controls. Hiding an entry is not a claim that typing its
raw spelling has been blocked at the runtime.

## Checks

- `Desktop/tests/command-references.test.ts`: positions, multiple occurrences,
  exclusions, shared icons, provenance and Markdown preservation.
- `Desktop/tests/composer-commands.test.ts`: catalog projection, standalone
  matching, argument handling, attachments and quotes.
- `Desktop/tests/slash-runtime.test.ts`: real fixed-bundle read-only handlers,
  dialog cancellation and loopback `/init` delivery with isolated credentials.
- `Desktop/scripts/verify-composer-menu.mjs`: real Electron menu and transcript
  icons, inline editing, clipboard/transport and light/dark/narrow layouts.
- `Desktop/scripts/verify-command-dispatch.mjs`: real Electron UI with mocked IPC
  for local page dispatch and Compact success/failure/busy boundaries; before
  mocking, validates the real Workflow listing IPC and session ownership.
- `Desktop/tests/workflow-catalog.test.ts`: isolated read-only storage, definition
  precedence, bounded reads, path containment, schema and historical-state projection.
- `Desktop/scripts/verify-workflow-catalog.mjs`: production component with fixture
  data; timer, interaction pauses, focus restoration, drag, owner isolation,
  error recovery, reduced motion and responsive themes.

Fixture and loopback results do not establish real-account execution,
marketplace installation, feedback delivery or packaged acceptance.
