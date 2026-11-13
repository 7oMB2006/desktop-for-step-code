# 通用本机外部委托

本文对应当前源码中的 `dfsc-external-v1`，尚未发布到发行安装包或插件市场。
不能仅凭 DFSC 版本号或安装了 Hermes 插件，判断当前宿主支持本协议。
先确认构建包含「远程访问 → 接入渠道 → 外部 Agent」入口，再核对实际能力。

## 职责与前提

DFSC 内置默认关闭的本机委托接口，负责连接身份、项目授权、专属原生会话、
输入队列、人工审批和退出生命周期。外部适配器负责将这些有限能力提供给
Hermes 等 Agent，不需要把每种机器人或聊天平台内置到桌面客户端。

首个适配位于独立的 Hermes companion 仓库；本仓库没有内置 Hermes 本体、
模型、QQ、微信或 OpenClaw 适配。Hermes 的安装、模型配置、独立 profile
和加载 companion 仍需单独完成。新协议不兼容旧 Hermes 专版的完整工程协议，
也不会在方法缺失或认证失败时自动回退到旧凭据。

DFSC 必须运行，项目须已出现在桌面的项目列表，原生模型须已配置。
建议先授权一个空白测试项目，完成只回复文本的首次任务，再用于实际工程。

## 配对与首次任务

1. 打开「远程访问 → 接入渠道 → 外部 Agent」，启用「允许本机 Agent 接入」。
   初次启用前不会监听端口；以后会保留用户显式设置的开关状态。
2. 填写连接名称，勾选确实允许委托的项目，检查确认界面后授权。
   该授权允许凭据持有者在这些项目发起任务并读取回答，不验证其后续输入来自真人。
3. 复制该连接的 `config.json` 路径给本机适配器。界面不会展示或复制 token。
   不要发送 `model.json`、整个 `external-connectors` 目录或旧人工凭据。
4. 如果使用 Hermes，在 companion 仓库根目录用已配置 Hermes 的 Python
   环境执行以下命令，路径均使用实际生成或选定的绝对路径：

   ```powershell
   python -X utf8 -B companion/install_profile.py --profile-home PROFILE --desktop-connector HOST_CONFIG
   ```

   `PROFILE` 必须是已有 `config.yaml` 的独立 profile。
   需要时按 companion 文档提供 `--hermes-source`。此模式不使用 `--pair`；
   配对已经在 DFSC 完成。安装器会备份既有配置，报告 `backup`、`protocol`
   和 `reloadRequired`，但不重启或重载 Hermes。`paired:false` 不代表连接失败，
   只是安装器未执行配对。不同既有连接默认拒绝覆盖；不要把
   `--replace-connection` 当作凭据失效的自动修复。
5. 用 companion 的独立客户端先查询能力：

   ```powershell
   python -X utf8 -B companion/external.py --config HOST_CONFIG system.capabilities
   ```

   安装文件成功、profile 已加载和宿主当前连通是不同状态。按 profile 原有方式
   激活后，还须确认 `dfsc_engineering` 暴露的方法与宿主能力声明匹配。
6. 首次任务仅要求回复固定文本，不修改文件或运行命令：

   ```text
   system.capabilities {}
   task.create {"key":"first-create-1","cwd":"能力返回的项目根目录","title":"首次连接检查"}
   run.submit {"taskId":"返回的id","key":"first-submit-1","message":"只回复 DFSC 连接成功，不改文件、不运行命令。"}
   task.get {"taskId":"返回的id"}
   ```

   在 DFSC 中打开关联原生会话核对目录、真实回复和审批。提交后让出；
   用户询问时再查询，不循环轮询。`completed` 只代表原生轮次结束，
   不代表测试通过、工程验收或用户接受。

## 管理与存储

所有管理操作仅供主窗口的类型化 preload 桥使用，插件窗口不能启用、
配对或撤销连接。渲染进程只拿到连接名称、身份、授权目录和配置路径，
没有 Node.js、直接文件访问或 bearer token。

文件存放在当前 Electron `userData/external-connectors/`，不回退到个人
Step Code 配置。适配器应使用界面给出的路径，不要猜测某个用户的目录。

| 文件 | 内容 |
| --- | --- |
| `state.json` | 开关、连接名称、目录身份及 token 的 SHA-256，不含明文 token |
| `tasks.json` | 有界路由记录、审计、长期审批策略及绑定摘要，不保存提示词或回答 |
| `agents/<agentId>/config.json` | 不含 token 的连接配置，供显式导入 |
| `agents/<agentId>/model.json` | 当前 TCP 端口和明文 bearer token，仅供适配器读取 |

`config.json` 固定字段如下：

```json
{
  "schemaVersion": 1,
  "protocol": "dfsc-external-v1",
  "agentId": "agent-00000000-0000-4000-8000-000000000000",
  "displayName": "Hermes",
  "bridgeRoot": "C:\\Users\\example\\AppData\\Roaming\\DFSC\\external-connectors",
  "workspaceRoots": ["C:\\Projects\\authorized-project"]
}
```

`model.json` 包含 `version:1`、`protocol:"dfsc-external-v1"`、
`role:"model"`、`agentId`、`transport:"tcp"`、`host:"127.0.0.1"`、
`port` 和 `token`。监听端口由操作系统分配，重启或重新开启后可能变化；
客户端应每次读取当前描述符，不缓存端口。

## 协议

传输是仅监听 `127.0.0.1` 的 TCP JSONL，不是 HTTP、WebSocket 或通用 IPC。
每条 TCP 连接只接受一个以换行结束的 UTF-8 JSON 请求，返回一条 JSONL
响应后关闭；不能在同一连接拼接多帧。

```json
{
  "version": 1,
  "protocol": "dfsc-external-v1",
  "token": "从本机私有描述符读取",
  "method": "system.capabilities",
  "params": {}
}
```

成功响应为 `{"ok":true,"result":...}`，失败为
`{"ok":false,"error":"connector:固定错误码"}`。不返回原始异常。
身份完全由 token 决定，请求不能声明 `agentId`、`source=human`、
`origin` 或其他授权字段。未知顶层字段及各方法未知参数会被拒绝。

| 方法 | 参数 | 语义 |
| --- | --- | --- |
| `system.capabilities` | `{}` | 协议、身份、实际授权根目录、方法白名单和本机审批限制 |
| `task.create` | `key,cwd,title` | 幂等创建专属原生会话，默认 Ask；显式长期策略可选「代我批准」 |
| `run.submit` | `taskId,key,message` | 每任务仅一次提交，走原生队列 |
| `task.list` | 可选 `offset`，默认 `0` | 本身份记录，每页最多 20 条，不含回答摘要 |
| `task.get` | `taskId` | 本身份任务状态及已捕获的有界回答摘要 |
| `task.stop` | `taskId` | 撤回仍可撤回的输入，否则使用原生停止路径 |
| `approval.list` | `taskId` | 仅返回用户已委托且完整可审阅的当前请求，最多 4 项 |
| `approval.respond` | `taskId,requestId,decision,reason`，可选 `answers` | 单次允许、拒绝、回答问题或转交人工；不能授予或延长委托 |
| `events.wait` | `taskIds`，可选 `cursor` | 最多 8 个本身份任务的当前阶段及有效审批引用，不含审批正文 |

宿主的能力响应还包含 `version:1`、`approvals:"local-with-explicit-task-delegation"`、
`oneRunPerTask:true` 和
`completedMeans:"native-turn-ended-not-user-accepted"`。
适配器可以缩小暴露范围；当前 Hermes 适配只接受 `task.list {}`，
尚未向模型暴露宿主的 `offset` 分页参数。

任务投影包含 `id`、`title`、`cwd`、`origin.agentProfile`、`phase`、
`createdAt`、`awaitingLocalApproval`、`resultAvailable`、`submitted`；
存在时还包含 `sessionId`、`runtimeId`、`reason`、`receipt`、
`summary` 和 `summaryTruncated`。不能凭任务 ID 查询别的连接或既有会话。

`phase` 可能为 `creating`、`waiting`、`queued`、`running`、`completed`、
`stopped`、`failed`、`interrupted` 或 `unknown`。`receipt` 可能为
`pending`、`dispatching`、`delivered`、`removed` 或 `unknown`。
`unknown` 是副作用或交付无法确认，不是允许重新建单的成功或失败证明。

## 幂等与原生会话

每个创建和提交操作使用固定 key。同一连接的创建 key、同一任务的提交 key
分别幂等，相同 key 和内容返回已有记录；
同一个创建 key 改目录或标题、同一任务改提交 key 或消息，都会返回
`connector:key-conflict`。key 为 1 到 128 个 ASCII 字符，以字母或数字开头，
后续允许字母、数字、`_`、`.`、`:`、`-`。

创建和提交意图先持久化再产生原生副作用。网络超时不证明未创建或未提交；
先用 `task.list` 或已知 ID 的 `task.get` 查询，保留原 key 和内容。
不要通过换 key、重建任务、再次派工掩盖不确定结果。

一个任务独占一个全新的原生会话，只接受一轮外部派工。默认 Ask，只有主窗口显式
设置的身份与项目长期策略可让新任务使用「代我批准」，不提供 Full Access。任务存续时禁止
本地额外输入及会改变执行策略或会话身份的操作，保留本地查看、审批、
问题回答和停止。结束后本地可以继续使用会话；外部查询不会读取后续本地对话。
原生审批、项目信任、恢复、完成复核、Goal 和后台工作仍由原生生命周期处理。

回答摘要只在确认本次原生终态时捕获一次，仅提取最终回答的文本块并进行
尽力脱敏，最多 8,000 个字符。它不是完整工具输出、思考链或验收证据；
截断会标记 `summaryTruncated:true`。回答仅在当前进程内保存，
重启后 `resultAvailable:false`，应到关联原生会话查看历史。

## 权限与信任边界

### 临时与长期审批委托

在「远程访问 → 接入渠道 → 外部 Agent」刷新后，为具体进行中任务选择
普通命令、文件修改、高风险工具、提问与回答四类独立范围，以及本次任务或
15/30/60 分钟有效期，阅读风险后确认。身份、任务、原生会话、
工作目录和当前传输同时绑定；临时委托不改变权限档位，重启不恢复。
普通文件操作附带 `then_run` 时必须同时授权命令类。

也可以按“此 Agent + 此项目”设置 1/7/30 天或直到手动撤销的长期策略。
策略保存于 Desktop 自有目录，跨任务与正常重启保留，绑定凭据及规范目录身份摘要。
新任务必须重新通过真实连接与目录校验，不恢复旧运行时、输入或审批引用。
凭据/身份/目录改变不能借用旧策略。用户关闭接入或撤销连接会删除相关策略；
正常退出程序不删除。到期同时检查墙钟和本进程单调时钟，观察到的失效不因回拨恢复；
跨重启检测到时间早于保存检查点也保守失效。

长期策略的权限档位只用于新任务，可选 Ask 或「代我批准」。后者由原生权限系统
自动执行常规操作，不代表 Hermes 已审核这些操作。风险审批是否交给 Hermes 仍要
单独勾选。替换、撤销或到期会中止还在使用旧自动权限的任务，并降回 Ask；
到期由 500ms 本机检查收束，不是对已开始系统调用的事务回滚或文件沙箱。
已完成会话不重新附着。单任务撤销仅退出该任务的审批委托，不删除长期策略。
自动权限任务进入终态后，先将原生权限降回 Ask，再释放给本地继续使用；
降级未确认时继续阻止本地接管，失败则保留清理责任。已完成的结果不因权限清理改写，
正常完成或已经停止的任务不额外发送 abort。释放后用户自行设置的本地权限不归旧策略管理。

默认不导出审批内容。只有完整原生工具调用与当前确认请求对应，且类型已选时，
`approval.list` 才返回不透明 `requestId`、完整输入和其他参数。高风险和问题必须各自显式勾选，
不会因授权“永久”而自动加入。无法分析、信息缺失、含被脱敏参数、未知扩展对话、
信任项目和权限切换始终留在本机。
命令仍可能执行错误操作；Agent 审核不是安全证明，目录授权不是文件系统沙箱。

原生 `clarify_user` 的确认和结构化问题都属于 `question`。问题 `input` 是规范化问题数组，
允许回答时传 `answers:[{id,value,wasCustom}]`，数量、顺序、选项及自定义许可须完整匹配。
拒绝问题将取消该次询问；无法判断个人偏好或新增授权时应 `escalate`，不得猜测代答。

`approval.respond` 的 `decision` 仅 `allow`、`deny` 或 `escalate`，`reason` 必填、
最多 500 字符。只回答一次原生确认，不存在“始终允许”。转交人工后该请求不能
由模型再次领取。本机随时可以抢先回答。旧请求、身份/传输变更、目录替换、到期、
撤销或停止都会使在途响应失效；审批和委托意图先落盘再产生原生副作用。

管理页可立即撤销审批委托。临时授权随任务结束、授权断开或重启失效，
长期策略按上述边界保留。保留最近 200 条本机审计，包括身份、任务或长期策略 ID、
请求/Call ID、理由和 prepared/applied/not-applied 结果。
prepared 表示结果不确定，不得据此重放；原始命令和凭据不写入审批审计。
理由仅尽力脱敏，不应主动提交秘密。

### 审批唤醒

`events.wait` 按当前状态长轮询，最长 20 秒，每身份仅一个等待者，不占全局任务变更锁。
返回进程 `epoch`、状态 `cursor` 和当前有效审批 UUID；撤销、停止、到期及重启后的旧请求不重放。
连接关闭最多在下一次 250ms 检查取消等待。通知本身没有批准权限，仍需 `approval.list` 和
`approval.respond` 的实时完整校验。

Hermes companion 后台接收通知，只唤醒发起任务的真实 Hermes 会话，由模型读取当前请求并
独立决定 allow/deny/escalate，绝不延迟后无条件批准。会话来自 Hermes 的可信
turn-local context，不接受模型参数中的路由、不使用全局“最近会话”或环境变量回退。
Hermes 必须保持运行并允许插件消息注入；缺少可信 session key 的旧 CLI、拒绝注入、
旧宿主或卸载状态不自动换会话。companion 重载不猜测恢复旧任务的会话映射。
这不是完整无人值守工作流；旧宿主未公布方法时保持本机审批。

- 默认关闭，只监听 IPv4 loopback，不开放公网、浏览器 CORS 或任意 Desktop IPC。
- 仅允许所选项目根目录本身作为 `cwd`，不自动扩展到任意子目录。
  配对及派工检查规范路径和目录 `dev/ino`；同名目录重建也需要重新授权。
- 拒绝 UNC 等以双斜杠开头的显式网络路径、符号链接和不符合规范身份的目录。
  这不等于已识别或拒绝所有映射盘、挂载盘及网络文件系统。
- 目录授权只是任务路由权限，不是操作系统文件系统沙箱。
  原生工具仍受原生权限和用户审批约束，不能据此承诺进程无法访问目录外文件。
- 不提供 `human.*`、`approval.grant`、权限切换、任意命令、
  自动恢复、续跑、预算托管或工程验收 API。拒绝前导 slash 命令及
  `ultracode:` 控制输入。`awaitingLocalApproval:true` 不代表已委托，
  未出现在有效 `approval.list` 中的请求仍须在本机处理。
- bearer 是当前用户目录内的明文凭据。文件 mode 不证明 Windows ACL 已验收，
  也不能防御以同一用户身份运行的恶意程序。不要把配置目录提交到 Git 或同步给他人。
- 本协议假定可信单用户本机环境，没有服务端身份认证。
  不防御其他本机用户抢占陈旧描述符端口后诱使客户端发送 token；
  loopback 和 token 不是双向认证。本轮不实现 token 轮换，
  不应将此接口用于不可信多用户主机。
- 尽力脱敏和有界摘要不保证最终回答不含敏感工程信息。
  授权连接本身即允许它读取该任务回答，应按凭据持有者能获得这些信息来决定授权。

## 撤销、关闭与重启

在管理页撤销单个连接或关闭整个入口后，会立即使授权失效、关闭关联 socket，
拒绝新请求，并尝试撤回仍可撤回的队列输入。使用长期自动权限的任务会被中止并降回 Ask；
其他已开始的原生工作保留本机查看与停止。撤销不等于删除原生会话。

关闭入口保留已有连接，重新开启会重写当前端点描述符。撤销连接不依赖删除
磁盘上已导出的配置或描述符：旧文件不是有效授权，旧 token 仍会被拒绝。
持久化失败会报错并关闭入口，不把内存中的撤销冒充为已可靠保存。

正常退出先关闭本机入口，再停止原生运行时并收束任务元数据写入。
关闭进程入口会先使本次进程的授权失效，仍活动任务持久化为 `interrupted`，
原因 `authorization-revoked`。这里表示本次进程授权结束，不代表用户删除了
已保存的连接；连接记录及用户开关设置仍会保留。

重启恢复连接设置及仍有效的长期策略，不重放旧消息、任务或审批，也不重新附着旧任务。
如果磁盘上仍有非终态记录，例如上次进程异常结束，启动时才将这些记录标记为
`interrupted`，原因 `desktop-restarted`；已经是终态的记录保留原原因。
原生历史仍由桌面保存。需要重新做任务时，先由用户查看历史并确认新委托。

## 限额与验证

当前实现限制为：最多 8 个连接、每连接 32 个授权根目录、全局 8 个未结束任务、
每连接 50 条及全局 100 条任务记录。记录满额后不自动淘汰历史或重放任务。
标题最多 160 字符，消息最多 32,000 字符，`offset` 为 `0..100` 的安全整数。
字符上限按宿主 JavaScript 字符串长度计算，仍受 UTF-8 帧大小限制。

请求最多 64 KiB，响应最多 128 KiB，存储 JSON 最多 1 MiB；
最多 16 个 socket 和 16 个在途请求，帧超时 5 秒、请求超时 30 秒。
超过边界会被拒绝或断开，断开不撤销已经发生的原生副作用。

相关验证入口为 `Desktop/tests/external-connector-*.test.ts`、
`Desktop/scripts/verify-external-connectors.mjs` 和
`Desktop/scripts/verify-external-connectors-electron.mjs`。
实际执行结果和验收边界以 `docs/VERIFICATION.md` 的当次记录为准。
单元测试、浏览器 fixture 或隔离 Electron 的可控模型测试，
都不能替代真实 Hermes gateway、真实模型、干净机器安装、macOS、
云 CI、发行安装包或插件市场发布验收。
