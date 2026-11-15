# 插件 TTS 接入与交付边界

更新：2026-11-15。宿主源码及本机 r8 验收包已补 `model.tts` 生产适配；r7 不包含此适配。
插件仍须自行接入，宿主升级不会把独立 HTTP 客户端自动改成跟随模式。
本说明不改变协议主版本、runtime pin、安装包指纹或付费授权规则。

## 宿主负责什么

- 只使用当前调用会话的官方 Step 登录账户，凭据留在主进程。
- 按当前账户的国内/海外、Step Plan/API 路由调用 `/audio/speech`，不跨渠道回退。
- 默认 `stepaudio-2.5-tts`；允许 `stepaudio-3-tts`，国内额外允许
  `step-tts-2`、`step-tts-mini`。专用模型由用户在插件设置中选择，不由插件逐次覆盖。
- 逐能力首次确认、账户/会话/模型/模式变化失效、取消、超时、并发和结果大小限制。
- 将提供商二进制音频规范化为 `{ type: 'audio', mimeType, data }`，`data` 为 base64。

`available: true` 仅代表有已知适配路径，不是余额、套餐包含或真实账户权益保证。
当前资源预算不是金额/Token 消费硬上限。没有实际发起付费验收，也没有为插件
开放登录凭据、任意 HTTP、图片生成、上传文件、音色列表、复刻/删除音色等管理接口。

## StepAudio 等插件怎么接

1. 在原项目内放置当前 `examples/plugins/host-client` 的 `client.mjs`、
   `protocol.mjs`、类型及 LICENSE；不要把离线 `testing.mjs` 打进发布物。
2. 包内增加 `dfsc.host.json`，消费者必须与 `step.plugin.json` 的真实 stdio 服务一致：

```json
{
  "schemaVersion": 1,
  "hostApiVersion": 1,
  "consumer": { "kind": "mcp-stdio", "server": "your-server" },
  "capabilities": ["model.tts"]
}
```

3. MCP 入口初始化一次标准 client。它消费的是宿主注入的
   `DFSC_LAUNCH_CONTEXT`，不是全局/包内 `host.json`；不要复制、打印或转交启动环境。
4. `host.mode === 'follow'` 时只走 broker；`independent` 时使用原独立配置读取器，
   并核对 `host.configurationRevision`。两分支失败均不得静默切到另一分支。
5. 通过 context 核对可用性，再提交以下窄请求：

```js
import { createHostClient, HostClientError, newRequestId } from './host-client/client.mjs';

const host = createHostClient({ pluginId: 'your-plugin', consumer: 'your-server' });

async function synthesize(text, voice, format = 'mp3', signal) {
  if (host.mode !== 'follow') throw new HostClientError('CAPABILITY_UNAVAILABLE');
  const context = await host.context({ signal });
  const tts = context.capabilities.find(item => item.id === 'model.tts');
  if (!tts?.available) throw new HostClientError(tts?.reason ?? 'CAPABILITY_UNAVAILABLE');
  return host.invoke({
    requestId: newRequestId(), revision: context.revision, capability: 'model.tts',
    input: { text, voice, format },
  }, { signal });
}

process.on('exit', () => host.close());
```

单次文本最多 1000 个 Unicode 字符；`voice` 是目标专用模型支持的音色 ID，
不是宿主预先验证过的音色列表。`format` 只允许 `mp3`、`wav`、`pcm`，
对应 `audio/mpeg`、`audio/wav`、`audio/pcm`。音频解码后最多 16 MiB。
文本中的括号可能被提供商解释为风格指令，不由宿主修改或剥离。

不接受 `model`、`url`、Key、自选 headers、`outputPath`、`return_url`、
上传/复刻参数或任意原始 API JSON；额外字段会被拒绝。需要这些能力的现有插件
可以保留明确的独立模式，而不能把不支持的动作伪装成跟随模式成功。
播放、文件命名、保存到 `host.dataDirectory` 及工具返回内容由插件负责。
不要把 base64 当 URL、文本音频或已保存的文件路径。

安装/启用不消费；MCP 握手不等于付费成功。第一次合成会等待宿主授权，
拒绝后不反复弹窗；失效租约需要用户显式重启相关会话，不自动续租或重发。
取消不保证提供商已经接受的请求免费。

## 接入验收

- 发布物只含必要文件，重建固定依赖/打包产物；不能直接修改已安装包绕过指纹。
- 无模式时保持延后；独立配置继续可用且跟随不要求占位 Key。
- context 查询、安装及 MCP 发现零模型请求；首次 TTS 必须经过宿主确认。
- 成功后能消费返回的二进制音频；拒绝、过期、换账户、取消、超时均不自动回退。
- 使用真实账户前另行确认模型/音色、套餐覆盖、费用及最小付费请求授权。

宿主已有真实 HTTP broker + 标准 client + 官方 MCP SDK 子进程的离线合成结果测试，
并覆盖四条账户路由、专用模型/地区、授权、失败、取消和音频上限。
另有 r8 包内生产 Electron、原生发现和 SDK 消费者的 TTS 确认/拒绝、
MP3/WAV/PCM 字节返回、授权复用及进行中取消验收。
这些测试使用假账户及合成音频字节，不证明真实音质、音色或扣费结果。
本次不直接修改 StepAudio 仓库、正式安装副本或用户账户。
