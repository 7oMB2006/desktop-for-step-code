# 官方 MCP SDK 自包含交付示例

此示例解决“不能在用户安装时跑 npm/pip，作者是不是必须零依赖”的疑问：
**作者可以用官方 SDK；依赖在作者构建时打包，并连同许可证一起交付。**
这不是没有第三方代码，也不提供恶意代码沙箱。

当前 host API 是候选，尚未接入正式客户端。这里的模型结果仅由离线 fixture 产生。
本轮没有接真实 Step 账户、计费或网络模型。

## 文件

```text
package.json / pnpm-lock.yaml     作者开发依赖，含官方 MCP SDK
src/server.mjs                   使用 McpServer / StdioServerTransport / Zod
scripts/build.mjs                作者侧 esbuild 打包与许可证归集
test/bundle.test.mjs              Schema 与无依赖目录真实 MCP 验收
plugins/dfsc-host-example/        唯一可安装快照
  step.plugin.json
  dfsc.plugin.json
  dfsc.host.json
  README.md / LICENSE
  dist/server.mjs
  dist/THIRD_PARTY_LICENSES.txt
```

源码导入相邻 `../host-client/` 的标准候选 client，不导入 BVR 私有代码。
要移入原项目，可复制 client 的源码、类型和 LICENSE 到自己的适配目录并修改 import；
构建脚本和示例属于作者侧项目，不要求被宿主动态执行。

## 作者侧构建

在本目录使用 **Node.js 24.16.0，或更高的 24.x**：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm test
```

这里可以运行作者开发依赖的构建脚本；**市场安装不会执行这三条命令**。
lockfile 锁定官方 MCP SDK 1.27.1，与当前固定 runtime 的 SDK 主线一致；
不是声称它是最新 SDK。构建会扫描实际打入 bundle 的依赖并归集许可证，
输出至多 8 MiB 单文件、32 MiB 总计、1000 个文件的市场限制内。
发布物不能混入 `node_modules`、真实 Key、Cookie、profile 或本机绝对路径。
`dist/` 被跟踪和复制，不靠改成其他目录名规避同步规则。

测试将可安装目录复制到全新的临时目录，从其外部启动入口，
使用真正的官方 MCP client 握手及调用；该目录没有 `node_modules`。
依赖许可证、无 Key 跟随、授权前拒绝、撤销和后代不继承分别验证。
这不是作者仓库到社区固定提交同步或正式客户端验收，后两者仍需另做。

## 安装与依赖

本地市场根目录是本目录；只为隔离验收使用，未正式投稿。
原生 `command: "node"` 依赖本机 PATH 已有受测 Node。
DFSC 内置 Node 不是第三方插件的已公开启动别名。
同一发布物不带原生扩展，但原生 Windows/macOS CI 仍须分别验证。

没有 host API 的旧宿主能加载工具，但返回 `dfsc-host:HOST_UNAVAILABLE`；
不会把声明误当授权，也不会改走独立 Key。当前示例只有跟随能力，
不需要 `dfsc.settings.json`；独立配置另参考 `config-starter`。

## 投稿

在自己的原项目内提交适配目录和构建后的 `plugins/dfsc-host-example`，
改成自己的 ID、名称、版本、工具和署名，再以完整提交 SHA 与子目录登记。
保留第三方许可证，披露上传的数据、模型请求和费用影响。
不能把此候选协议写成当前所有 DFSC 客户端都支持；生产宿主能力标记、
最低兼容版本与正式市场适配尚待后续实现。
