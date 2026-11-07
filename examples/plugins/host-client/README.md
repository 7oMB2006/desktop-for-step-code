# DFSC host client 候选

只使用 Node 内置能力的窄调用 client，不是提供商 SDK，也不是拿 Key 的接口。
这是尚未由生产启动器签发的协议候选；完整约定见
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

client 启动时消耗并删除载荷，普通后代不会意外继承它；
多进程插件由登记的 MCP 进程保留 client，以自身业务 IPC 传回结果。
这不阻止作者主动转交 bearer 或同系统用户的恶意读取。
媒体返回字节由作者保存在 `host.dataDirectory`，不能要求宿主写任意路径。
