# v2 主题起步包

先读 [中文主题作者指南](../../../docs/THEME_AUTHORING.zh-CN.md)。
本目录是可直接添加的本地市场，不是正式社区市场，也不需要运行素材生成器才能安装。

```text
theme-starter/
  .step-plugin/marketplace.json
  plugins/dfsc-theme-example/
    step.plugin.json
    dfsc.plugin.json
    dfsc.theme.json
    background.png
    icon.png
    LICENSE
    README.md
```

示例选择 `standard-v1` UI、`image-v1` 默认背景，并显式接受 `image-v1` 替换。
在自己的副本把 `accepts` 改为 `[]`，即可测试“不开放替换”这一同样合法的选择。
不要改用 v1 来表达新的一体化主题。

在支持组合协议的新 DFSC 构建里添加本目录的绝对路径，安装后去外观中选择主题。
克隆社区市场源码后，可用其 `scripts/check-theme-pack.mjs --package <插件资源目录>`
做投稿前静态检查；该脚本不执行插件代码，也不能代替原生图片解码和视觉验收。

正式投稿前更换示例 ID、名称、版本、素材、署名与已验证的宿主要求。
独立插件仓库的资源目录只需复制 `plugins/dfsc-theme-example/`，
市场根目录和素材生成器不必进入安装包。不要虚构仓库、截图或版本支持范围。

素材生成器只依赖 Node 内置模块，重新生成命令：

```sh
node examples/plugins/theme-starter/generate-assets.mjs
```

它仅覆盖本示例自己的 `background.png` 与 `icon.png`，不会修改别的主题。
