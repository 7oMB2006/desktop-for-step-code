# StepAudio 发布目录与检查

日期：2026-11-14。状态：本地源码、测试与隔离验收；未提交、公开发布或修改日常安装。

## 进入安装包的路径

只读检查正式 Desktop profile 后确认：

- StepAudio 安装凭据来自本地测试市场 `dfsc-stepaudio-local`，不是公共市场收录。
- 对应市场根的 `.step-plugin/marketplace.json` 将插件 `source` 设置为 `"."`。
- 市场根和安装副本均包含 `.git`、`node_modules`、`src`、`test` 和 `scripts`。
- 插件原生声明执行 `dist/index.js`。该产物约 643 KB，作者构建脚本已将官方 MCP SDK
  打包进去；SDK 和 esbuild 在 `package.json` 中均属于开发依赖。
- 当前原生 `addMarketplaceSource` 对本地目录做递归复制，随后
  `installMarketplacePlugin` 对 `entry.sourcePath` 再次递归复制；两者不读取
  `.gitignore` 或 npm 的发布文件规则。因此忽略开发依赖的 Git 规则并不能阻止本地
  市场把这些文件复制进插件安装目录。

可确认的问题是：本地测试市场指向了包含开发内容的包根，安装按该来源完整复制。
不能从现有副本断定原开发目录的绝对路径、首次添加市场的时间，或依赖最初何时生成。
复制来的 `.git/config` 没有远端 origin；仅凭目录里存在 `.git`，重新枚举来源还会
将其推断为 Git 来源，不能把这个推断当作最初通过 Git 克隆的证据。

本轮没有读取正式凭据正文、改写安装凭据、清理正式包，或在开发原仓库提交修复。
后续维护者应在作者仓库采用以下发布约定，再通过正常更新交付，而不是直接删改
用户安装目录、使旧指纹失效。

## 发布工具

`Desktop/electron/plugin-release.mjs` 导出只读
`auditPluginRelease(directory)`，用于检查目标插件目录；不扫描整个市场、不计算完整
内容指纹、不修改或过滤候选。返回的错误只有代码和相对文件路径，不读取秘密正文。

规则为发布卫生检查，不是第三方代码审计或恶意插件沙箱：

- 拒绝 VCS 目录、实际 `.env` 等常见秘密文件名、开发缓存和测试输出。
- `.env.example`、`.env.sample`、`.env.template`、`.env.defaults` 可作为示例交付；
  工具不会保证这些文件的内容一定没有真实秘密，作者仍需自行核对。
- 默认拒绝 `node_modules`；确实无法打包的运行依赖须在包内 `dfsc.release.json`
  逐路径声明用途，检查仍然递归核对其内部的文件名、链接和体积。
  声明一个依赖根会覆盖该根内部的嵌套依赖目录，不要求为每个传递依赖重复声明。
- 允许合理源码执行，`src`、`test`、`scripts` 仅给出提示，不强迫所有语言/插件做 bundle。
- 保留与现有包校验一致的 10000 条目、128 MiB 上限。发现已拒绝目录后不再进入其内容，
  因而失败报告的文件/体积是已检查范围，而不是原始依赖树的完整统计。
- 检查不负责判断声明是否诚实，不执行包内脚本，也不代替原生清单和真实安装验收。

作者可以在项目根添加如下 `dfsc.release.json`：

```json
{
  "schemaVersion": 1,
  "files": ["step.plugin.json", "dfsc.plugin.json", "dist", "docs", "README.md", "LICENSE"],
  "runtimeDependencies": []
}
```

`files` 是明确的相对路径白名单，不接受 glob、绝对路径、父目录或链接。
示例必须按实际清单补上设置、图标、业务数据、许可证以及消费者真正引用的文件。
`files` 供 staging 使用；安装前检查不会静默删除白名单之外的文件。

Git 市场引用仓库根 `source: "."` 时，克隆目录本身含 `.git`，同样会被拒绝；
不能靠 `.gitignore`、声明来源为 Git 或 `runtimeDependencies` 例外绕过。
作者应在开发仓库之外先生成干净发布目录，再将该产物放入市场仓库的独立
`plugins/<id>` 子目录，让市场 `source` 指向这个子目录，或者提供本身不含 VCS
元数据的独立本地发布目录。Git 市场根可以保留自己的 `.git`，但它不应成为被安装的
插件根。已有安装和普通目录浏览不因此被自动删除或阻断；需要安装/更新时才检查候选。

```powershell
node scripts/plugin-release.mjs stage C:\plugin-source D:\new-plugin-release
node scripts/plugin-release.mjs check D:\new-plugin-release
```

也可传 `--manifest C:\release-manifest.json` 使用外置草稿清单，不必改写只读开发源。
输出目录必须尚不存在，且不得与源目录嵌套或重叠；出错时仅清理由本次调用独占创建
的输出目录，不覆盖、清理源仓库或既有发布目录。

必要的依赖例外是声明，不是安全许可：

```json
{
  "schemaVersion": 1,
  "files": ["step.plugin.json", "server", "node_modules", "LICENSE"],
  "runtimeDependencies": [
    { "path": "node_modules", "reason": "The native addon must remain loadable at runtime." }
  ]
}
```

## StepAudio 隔离验收

`Desktop/scripts/verify-stepaudio-release.mjs` 对显式提供的本机开发副本只读取发布文件，
使用外置白名单生成干净包，在独立 profile 中走原生市场发现、安装、配置及卸载。
保留配置 CLI 需要的 `scripts/configure.mjs` 与两个纯工具模块，不复制开发依赖。

验收报告：`D:\Desktop For Step Code\output\session-startup-plugin-gate-20261114\release-check-native-staging-final\verification.json`。

- 原副本被明确拒绝：`.git`、未声明的 `node_modules`。
- 干净发布副本和原生安装副本均为 27 文件、758036 字节，无开发依赖目录。
- 原生安装凭据与声明式配置生效，配置只包含合成 Key 和本机 HTTP fixture。
- 官方 MCP SDK 完成真实 stdio 握手并发现 `clone_voice`、`list_voices`、
  `text_to_speech` 三个工具。
- 唯一一次接口请求发给本机 fixture，返回受控错误后正确读取随包 39 项音色目录。
  空文本合成被拒绝，没有第二次请求；未请求真实模型、TTS 或付费账户。
- 原生卸载通过；测试客户端、服务及一次性 profile 正常关闭和清理，外部证据保留。
- 测试探针使用原开发副本中的官方 MCP SDK；被测安装子进程本身仅运行干净包里的
  `dist/index.js`，不从该开发依赖目录加载模块。

复现命令须显式提供三个绝对路径，`--output` 必须为新目录：

```powershell
node scripts/verify-stepaudio-release.mjs --source C:\plugin-source --runtime D:\runtime --output D:\new-evidence
```

本机检查器与目录生命周期测试共 34 项通过；类型检查通过。该结果不证明真实语音生成、
真实账户费用、市场公开发布、macOS 或现用客户端已经更新。
