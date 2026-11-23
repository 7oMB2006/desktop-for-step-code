# DFSC host client 候选

只使用 Node 内置能力的窄调用 client，不是提供商 SDK，也不是拿 Key 的接口。
候选源码的启动器已按原生记录签发，插件中心提供通用模式设置与授权状态快照。
安装和保存不自动授权，也不自动重启会话；完整约定见
[插件宿主模型协议](../../../docs/PLUGIN_HOST_CONTRACT.md)。

作者源码可以复制本目录的 `client.mjs`、`protocol.mjs`、对应类型和 LICENSE
到原项目自己的适配目录，再调整 import。无需另建 DFSC 专用仓库。
`testing.mjs` 仅供离线测试，不打入插件发布物。

```js
import { createHostClient, newRequestId } from './host-client/client.mjs';

const host = createHostClient({ pluginId: 'your-plugin', consumer: 'your-server' });
if (host.mode === 'follow') {
  const context = await host.context();
  const result = await host.invoke({
    requestId: newRequestId(),
    revision: context.revision,
    capability: 'model.text',
    input: { messages: [{ role: 'user', content: 'Summarize supplied text.' }] },
  });
  // Consume result.text; do not return the launch environment or connection information.
} else {
  // Read the existing committed json-file-v1 configuration and check configurationRevision.
  // An independent failure must not silently enable follow mode.
}
host.close();
```

缺少或无效的启动上下文会抛出 `HostClientError`，`code` 是有界错误码。
作者可以让工具显示该能力不可用，不能捕获后偷偷改用环境 Key。
`context()` 不触发调用；`invoke()` 本身不证明已获得用户同意。

## 按能力混用

只有已经实现逐项派发的插件才应在 `dfsc.host.json` 中设置 `independentCapabilities`。
收到该字段后，不要再用 `host.mode` 给整个插件选择供应商：

1. 在 `host.independentCapabilities` 中的能力只走插件自己的连接。调用前读取并核对
   已提交独立配置的修订与 `host.configurationRevision` 一致。
2. 其他能力只有在 `host.mode === 'follow'` 且 `host.context()` 对该项返回可用时才可用 Broker。
3. 两边都没分配的能力不可用。任一来源失败，均不改走另一条路。

`host.independentCapabilities` 缺失时，沿用旧版的整套模式。插件能读取的仍仅是为它保存的
独立配置；官方账户的 Key 不进入插件。保存来源不是扣费授权。

插件自己的工具需要独立配置，但不需要占用模型行时，可声明 `independentTools: true`，
并提供同一消费者的 `dfsc.settings.json`。这不增加可直连的模型行，也不自动授权。
使用支持空路由的新客户端：`host.independentCapabilities` 为 `[]` 时，表示独立配置已启用、
没有模型行分配给直连。使用配置前同样核对 `host.configurationRevision`。

client 启动时消耗并删除载荷，普通后代不会意外继承它；
多进程插件由登记的 MCP 进程保留 client，以自身业务 IPC 传回结果。
这不阻止作者主动转交 bearer 或同系统用户的恶意读取。
媒体返回字节由作者保存在 `host.dataDirectory`，不能要求宿主写任意路径。

## TTS

宿主源码自 2026-11-15 已有受限 TTS adapter，r7 及更旧的包仍不可用；
是否支持必须查询 context，不能仅检查声明或应用版本号。
申请 `model.tts` 后，标准 client 的调用形状为：

```js
const context = await host.context({ signal });
const tts = context.capabilities.find(item => item.id === 'model.tts');
if (!tts?.available) throw new HostClientError(tts?.reason ?? 'CAPABILITY_UNAVAILABLE');
const result = await host.invoke({
  requestId: newRequestId(), revision: context.revision, capability: 'model.tts',
  input: { text: 'Hello.', voice: 'cixingnansheng', format: 'mp3' },
}, { signal });
const audio = Buffer.from(result.data, 'base64');
// result.mimeType identifies the audio; saving and playback belong to the plugin.
```

上述片段沿用前例的 client，并需从 `client.mjs` 导入 `HostClientError`。
跟随只使用官方 Step 账户与所选渠道，默认专用模型 `stepaudio-2.5-tts`；
不沿用聊天模型、不接收 Key/URL/输出路径、不自动拆单或重试。
Step adapter 单次最多 1000 字符，音频最多 16 MiB，支持 MP3/WAV/PCM。
可用性不保证套餐权益或免费，音色也必须适用于所选专用模型。
完整模式分支、声明及接入验收见
[TTS 接入说明](../../../docs/PLUGIN_TTS_ADAPTER.md)。
