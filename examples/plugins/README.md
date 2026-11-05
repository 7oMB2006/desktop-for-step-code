# DFSC 插件示例

先阅读 [开发与界面约定](../../docs/PLUGIN_AUTHORING.md)。
这里包含可安装资源、可安装配置示例和不可动态加载的宿主字段模板。

## 可安装的最小资源

`resource-starter/` 是一个完整本地市场：

```text
resource-starter/
  .step-plugin/marketplace.json
  plugins/dfsc-example/
    step.plugin.json
    dfsc.plugin.json
    LICENSE
    README.md
    docs/assets/capabilities.png
    commands/dfsc-example.md
    skills/dfsc-example/SKILL.md
```

在新构建的「插件 → 市场来源 → 添加市场」中填写本机
`resource-starter` 的绝对路径，在「发现」安装 DFSC Example。
已有会话手动重启后加载技能和 `/dfsc-example`。
命令是提示模板，发送后仍然使用当前会话模型，可能消耗当前账户额度。
安装和浏览本身不调用模型。

它故意不包含 MCP、本体安装器、远程地址、Key 或账户桥。
因此其服务开关不可用，这是正确行为，不是插件安装失败。
不声明不存在的仓库地址，不借用 BVR 或 DFSC 的图标伪装来源。
正式投稿前换掉示例 ID、版本、命令、技能内容和作者归属。
README 的本地图来自真实隔离 Electron 安装验收，不是概念效果图；
改名或改变能力后应重新截图，不沿用不符事实的展示。

验收发现/安装/资源加载/卸载，不请求模型：

```powershell
cd Desktop
node scripts/verify-plugin-starter.mjs --output "D:/Temporary/dfsc-plugin-starter-check"
```

输出目录必须尚不存在。验收只使用该新目录和已有 staged runtime。

## 宿主专用表单

`host-adapter/` 不属于可安装资源，不应一起上传市场。
它是给 DFSC 宿主贡献者复用的 React/TypeScript 字段层，
必须放进插件中心壳并接上窄桥接接口，不能仅通过清单加载。
完整生命周期以 BVR 的实际表单、配置服务及测试为参考。

## 可安装的基础配置示例

`config-starter/` 是另一个完整本地市场，插件为 DFSC Configuration Example。
可在自己的机器上添加其绝对目录、安装、打开齿轮并保存默认设置。
它用 `json-file-v1` 读取宿主的私有配置，`format_note` 工具真实应用
前缀、大小写和字符上限，不访问网络或付费接口。
它需要 PATH 上的 Node.js，安装资源不会自动安装 Node 或依赖。

原生 `step.plugin.json`、展示 `dfsc.plugin.json`、配置 `dfsc.settings.json`、
README、相对文档、更新记录及独立读取器都在同一个可复制包中。
读取器是 native consumer 的参考代码，不是渲染器前端脚本。
字段、保存与真实 MCP 回归纳入 Desktop 的 `plugin-*.test.ts`。
这两个 starter 是宿主维护示例，不冒充已经公开投稿的第三方作品。
