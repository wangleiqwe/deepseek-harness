# @deepseek-ai/dsh-client-ui-opencode-go-usage

[English](README.md) | 中文

OpenCode Go 订阅额度的浏览器界面:侧边栏底部的指示灯(带浮层读数)与一个独立的设置页。两个入口都通过 `opencodeUsage` Remote 命名空间读取;网关请求由 Host 负责。

## 界面

- `sidebar.footer.action`(`id: opencode-go-usage`,order 10):一个健康圆点,宽侧边栏下附滚动窗口百分比(窄栏仅圆点)。点击展开浮层,显示三个窗口、重置时间、刷新与关闭。
- `settings.section`(`id: opencode-go-usage`,order 12):「Go 套餐额度」设置页,在三窗口读数上方附一行额度说明。

两个界面在挂载时读取一次,之后每 60 秒轮询;读取失败就地渲染并附重试按钮。

## 安装

本仓库已在 `dsh-web-app` bundle 中随附本行。仓库之外的部署在自己的组合中声明依赖并把本行挂进 `dsh.client` 名册:

```json
// profile or bundle package.json
"dependencies": {
  "@deepseek-ai/dsh-client-ui-opencode-go-usage": "^0.1.0"
}
```

```yaml
# composition patch layer, beside the other dsh.client rows
- id: ui-opencode-go-usage
  name: '@deepseek-ai/dsh-client-ui-opencode-go-usage'
```

前置条件:名册中需包含 `dsh-client-ui-sidebar` 与 `dsh-client-ui-settings`(两个目标 slot),`dsh-api-remotes` 的 Client 装配需挂载 `opencodeUsage` 命名空间(配套的 `@deepseek-ai/dsh-opencode-go-usage` release),且该包的 Host 行需挂在宿主组合中。

## 模型体验

无模型可见界面:本包不注册工具、提示词段或模型可见事件,只添加上述两个增量 slot 入口,不改变任何对话或会话内容。token 与 KV-cache 影响:无。

## 已知限制与后续工作

- 指示灯反映的是最近一次已完成的轮询;与窗口重置竞态的读取会显示上一份快照,直到下一轮轮询。
- 浮层只由自身的关闭按钮收起;点击外部不会关闭(周边 chrome 归侧边栏底部所有)。
- 轮询按入口实例进行;侧边栏指示灯与设置页同时挂载时各自独立轮询。
