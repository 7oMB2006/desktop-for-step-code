# DFSC SDK Host Example

宿主维护的协议候选示例，不是正式上架的第三方作品。
本插件使用官方 MCP SDK，发布入口已打包，不需要在安装目录运行 npm/pip。
第三方代码与许可证见 `dist/THIRD_PARTY_LICENSES.txt`。

## 工具

- `host_context`：查询宿主能力，不调用模型。
- `summarize_text`：通过宿主模型接口请求摘要；必须先获用户授权。

**当前正式客户端尚未实现本候选通用接口**，工具会明确提示
`dfsc-host:HOST_UNAVAILABLE`。离线测试中的摘要来自 fixture，不是真实模型。
不会拿已登录 Step 的 Key，不会自动读独立 Key，不会切换 Plan/API 计费。
若将来接入真实宿主，摘要文本会发给所确认的模型，并可能消耗额度。

## 运行条件

PATH 中已有 Node.js 24.16.0 或更高的 24.x。DFSC 不替本插件安装 Node 或依赖。
`DFSC_INDEPENDENT_PLUGIN` 仅是旧版环境兼容标记，不是可调用模型的 Key。
本示例没有独立配置，不需要填写任何 Key。

模型请求失败或授权被拒绝时，请按错误处理，不要用其他账户重试来掩盖失败。
本插件不宣称具备真实 TTS、图像生成、浏览器访问或安全沙箱能力。
