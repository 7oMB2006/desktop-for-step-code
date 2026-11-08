# 插件宿主模型协议 v1 候选

状态：2026-11-08，**可执行候选，不是当前正式版承诺**。
已交付声明校验、模式提交参考实现、host client、官方 MCP SDK 打包及离线验收。
后续实现了通用 broker、确认回调、Step provider adapter 和原生启动绑定，
见 [代理服务及其边界](PLUGIN_HOST_BROKER.md)。
生产启动器仅在 runtime 能力标记和已提交模式均有效时签发一次性上下文，
已接主动失效和既有确认抽屉；用户模式选择入口与完整 UI 验收仍未交付。
没有模式时原生消费者保持延后，安装示例不会自动获得宿主模型调用能力。
本候选与凭据隔离 PR #215 分开交付，组合发布门槛不变。

## 作者从哪里开始

1. 只做提示、技能或离线工具：沿用原生资源或 `config-starter`，不用申请宿主模型。
2. 需要独立服务：使用 `dfsc.settings.json`、既有 `json-file-v1` 读取器及独立 Key。
3. 需要跟随 DFSC 账户：参考 `examples/plugins/sdk-host-starter` 和本候选。
   安装、声明、启用服务和 Full Access 都不是付费授权。

作者可以继续在 BVR、StepAudio 等原项目内维护适配子目录，
不要求另建“DFSC 专用仓库”。作者仓库负责源代码、固定依赖、构建及许可；
市场快照负责可安装资源与内容锁。用户安装不执行 npm/pip 或作者构建脚本。

## 四份声明

| 文件 | 作用 |
| --- | --- |
| `step.plugin.json` | 原生资源、MCP 启动和版本；身份仍以它为准 |
| `dfsc.plugin.json` | 作者、说明、分类与显式外链，不是前端执行入口 |
| `dfsc.settings.json` | 可选独立配置；不存宿主授权开关或账户凭据 |
| `dfsc.host.json` | 可选宿主能力申请；不含授权结果、账户、模型、地址或 token |

```json
{
  "schemaVersion": 1,
  "hostApiVersion": 1,
  "consumer": { "kind": "mcp-stdio", "server": "example" },
  "capabilities": ["model.text"]
}
```

声明最大 64 KiB、每包一个消费者、1–4 个不重复能力。
首版能力为 `model.text`、`model.video`、`model.asr`、`model.tts`。
`model.image` 尚未纳入；未知能力或主版本不能获得部分授权。
JSON Schema 在 `plugin-schemas/dfsc.host.schema.json`，
有效/无效公共样例在 `examples/plugins/host-client/declaration-cases.json`。
Schema 只做结构检查，运行时还要核对实际原生服务、安装来源与 transport。

### 原生启动字段

固定 pin 的原生 MCP 支持 `command`、`args`、`cwd`、`env`、`url`、
`bearer_token_env_var`、`http_headers`、`env_http_headers`、`enabled`、
`startup_timeout_sec`、`tool_timeout_sec`、`enabled_tools`、`disabled_tools`、
`oauth`。其中 OAuth 子字段为 `client_id`、`client_secret`、`scopes`、
`callback_port`。字段存在不代表通用 host API 支持相应 transport。

本候选只绑定原生清单内联 `mcpServers` 中的一个 stdio 服务：
必须有非空 `command`，不能同时带 URL、HTTP 认证/头字段或非 stdio transport。
`args` 至多 64 个，每项至多 8192 字符；`cwd` 若提供，只能是包内相对目录。
未提供 `cwd` 时原生 runtime 将工作目录锚定到安装包，因此示例入口使用
`["dist/server.mjs"]`。没有 `${PLUGIN_DIR}` 等自创变量替换约定。
本候选不把个人 HOME、调用项目目录或 DFSC 内置 Node 路径作为作者依赖契约。
命令使用 `node` 时，本机 PATH 必须已有受测 Node；宿主不自动安装。

`DFSC_HOST_*`、`DFSC_LAUNCH_*` 环境名由宿主保留，大小写不敏感地拒绝作者覆盖。
运行时以真正的启动记录绑定消费者，拒绝全局 transport 覆盖、冲突来源、
含糊身份和未完成安装；单靠候选声明校验器不能替代这项原生核验。
手工原始 MCP 和远程 MCP 首版不获得通用 broker 身份。

`DFSC_INDEPENDENT_PLUGIN` 是旧版环境兜底的兼容标记，不是 Key 或授权凭证。
新隔离 runtime 不靠它保护账户；既有 `json-file-v1` 配置绑定仍要求其原有声明，
本轮不顺带改变旧配置消费者的识别条件。

## 唯一模式与提交

`PluginHostBindingStore` 是主进程实现，不能作为插件工具调用或 renderer 接口。
它要求宿主已有有效安装 receipt、唯一实例、精确安装路径和匹配的包指纹。
宿主每个 profile 只能持有一个实例，且将配置、更新、模式操作放进同一个管理队列；
当前类不是跨进程锁或任意两个 writer 的事务服务。

持久化形式：

```text
step-runtime/desktop-plugins/
  host/selections/<instance>/<revision>.json
  host/bindings/<instance>.json
  data/<instance>/
```

先写不可变 snapshot，再重核旧 revision，最后原子替换唯一 binding 指针。
指针包含 snapshot 字节哈希；中断产生的未引用 snapshot 不会自行成为有效模式。
同一 writer 并发保存使用旧 revision 时只有一次成功，不能覆盖较新的选择。
包/清单变更、卸载或损坏的指针直接拒绝，不猜测最新文件来恢复权限。

- `follow` 不读取独立配置、不要求独立 Key，`configurationRevision` 为 `null`。
- `independent` 必须引用已提交且符合必填规则的独立配置修订，启动不含 broker。
- 独立配置改变后旧选择仍可显示，但 `configurationCurrent` 为假，拒绝启动；
  可以显式重新绑定有效配置或切回跟随，不会被坏旧配置困住。
- ASR/TTS 模型选择位于宿主模式 snapshot 的 `models`，
  键仅允许已申请的 `model.asr`、`model.tts`；改变选择生成新 revision。
  这里是用户请求的专用模型，不是已验证的 provider 支持结果。
  文本/视频始终由 broker 读取实际调用会话的已应用模型，不接受存储的聊天模型覆盖。
- 失败发生在指针提交前，旧指针保持不变；提交后的账户/配置变化属于撤销/待重启，
  不能伪装成原模式仍有效。现有配置、更新及启动核验已共用管理队列并撤销租约；
  模式设置入口尚未交付，未来模式写入也必须进入同一队列。
- 数据目录由宿主在包外创建并校验，同源更新保留实例和数据。
  重装新建实例，不自动接走旧数据。卸载清理数据必须另行确认。

参考实现通过 corruption、orphan snapshot、并发修订、无 Key 跟随、
独立配置变化恢复和 junction 越界测试，不等于更新恢复全链路已接入。

## 受信启动上下文

格式为 `dfsc-launch-v1`，经宿主保留环境 `DFSC_LAUNCH_CONTEXT` 单次注入，
JSON 最大 16 KiB。不是包内配置、全局 `host.json` 或插件自报请求。

| 字段 | 含义 |
| --- | --- |
| `version`、`mode` | 协议与唯一有效模式 |
| `pluginId`、`consumer` | 从包声明及真实启动记录确定的身份 |
| `instance`、`fingerprint`、`declarationHash` | 安装实例、包和能力声明绑定 |
| `revision`、`configurationRevision` | 宿主选择及独立配置引用，不含秘密 |
| `launchId`、`runtimeId`、`sessionId` | 本次进程启动、runtime 和调用会话 |
| `accountRevision`、`capabilities`、`models` | 账户选择修订、申请集合与专用模型选择 |
| `dataDirectory` | 宿主分配的实例包外目录，不是任意文件授权 |
| `broker` | 仅跟随模式包含 `origin`、`token`、`expiresAt` |

broker origin 必须是精确的 `http://127.0.0.1:<port>`，
不含 userinfo、路径、查询或片段。调用 token 为 32 字节随机值的 base64url，
每次启动独立，剩余有效期不超过 30 分钟。SDK 不续租，不接受其他地址。
提供商 Key、OAuth、Cookie、独立配置秘密均不在上下文中。

标准 client 先删除环境载荷，再解析和核对编译时 pluginId/consumer；
解析失败也不把载荷留给普通后代。连接资料只保存在闭包，不出现在 client 的 JSON 中。
它不能认证一个由用户手工伪造的启动环境；可信来源必须由生产 launcher 保证。
token 是 bearer，持有被复制的有效 A token 者仍可能冒用 A。
不以 PID、自报身份或这个 SDK 宣称本机恶意代码沙箱。

独立模式先读取该上下文确认模式，再调用既有配置读取器并核对配置 revision；
跟随模式绝不为了通过配置校验而保存空 Key。两种分支失败均不自动改走另一分支。

## 窄请求协议

所有请求是携带租约 Authorization 的 JSON POST；无浏览器接口和任意 fetch。
实际 broker 必须拒绝 Origin、错误 Host、错误方法/路由、过期及撤销租约。
client 禁止 HTTP 重定向，并核对响应结构，不将原始错误体转交作者工具或界面。

| 路径 | 请求 | 成功响应 |
| --- | --- | --- |
| `/v1/context` | `{}` | `version: 1`、context `revision`、逐项能力可用性/原因与已应用模型、地区、Plan/API |
| `/v1/invoke` | `requestId`、context `revision`、`capability`、`input` | `version: 1`、同一 `requestId`、规范化 `result` |
| `/v1/cancel` | `requestId` | `version: 1`、同一 `requestId`、`cancelled` |

上下文查询不调用模型，也不授权。invoke 的 revision 是这次 context 的修订，
不是磁盘模式 snapshot 的 revision；账户、会话、模型或权限变化后必须拒绝旧值。
首个付费请求应等待宿主确认，后台无法确认时返回 `AUTHORIZATION_REQUIRED`。
只有同一租约能取消自己的请求。client 不重试、不自动刷新 revision 重发、
不读取环境中的独立 Key、不从 Plan 切 API。

输入为有界消息、内联 video/audio，或 TTS 的文本、voice、格式；
不接受任意 URL、输出路径或自选请求头。文本结果至多 2 MiB；
请求 JSON 32 MiB；响应 JSON 24 MiB；TTS 解码音频 16 MiB，
且 MIME 必须与所请求的 mp3/wav/pcm 一致。
能力申请不证明账户实际支持该能力或模型，未知组合必须明确不可用。

候选 broker 资源预算为每插件每会话并发 2、全局并发 8；
排队 30 秒、确认 60 秒、provider 180 秒，client 总等待不超过 270 秒。
broker 已实现这些预算及取消/撤销，生产启动链按能力标记启用；
过期/撤销后必须显式重启，不自动续租。
取消、断连或撤销不保证提供商已经接受的请求不计费。

失败形状为 `{"version":1,"error":{"code":"DENIED"}}`，不附原始 provider body。
错误码与 TypeScript 类型、边界检查共用 `host-client/protocol.mjs`：
`HOST_UNAVAILABLE`、`UNSUPPORTED_VERSION`、`INVALID_REQUEST`、
`CAPABILITY_UNAVAILABLE`、`AUTHORIZATION_REQUIRED`、`DENIED`、
`STALE_CONTEXT`、`CANCELLED`、`TIMEOUT`、`TOO_LARGE`、
`PROVIDER_FAILED`、`BUSY`、`CLOSED`。

## 下一阶段门槛

仍须交付模式选择/授权状态界面、未来模式写入的管理队列接入、
完整 Electron/实包确认流程、真实账户权益验收及 BVR 旧桥退场。
原生启动绑定、全局 transport/来源核验和主动撤销已接入候选源码，
实际 runtime/SDK 回归使用隔离 provider，不能替代真实权益验收；
Cron 恢复不自动接线，TTS 明确尚不可用。
市场作者入口、固定 SHA 同步和未知旧宿主提示也须跨仓库验收；
本轮不改市场仓库或 StepAudio/BVR 发布物，不宣称整个计划 [Ⅱ]/[Ⅲ] 已完成。
离线 `mockHost` 只测 wire contract，不是可部署 broker，也不证明真实 TTS 可用。
