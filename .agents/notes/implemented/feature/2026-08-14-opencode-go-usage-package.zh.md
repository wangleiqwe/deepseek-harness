# Agent Note: OpenCode Go 额度作为打包能力

Status: implemented

[English](2026-08-14-opencode-go-usage-package.md) | 中文

## Problem

OpenCode Go 订阅有三个额度窗口——滚动 5 小时(约 $12)、每周(约 $30)、每月(约 $60)——由网关 `GET https://opencode.ai/zen/go/v1/usage` 以 Bearer 认证应答。用户希望在 harness 内部看到当前消耗:对话里可问(模型工具),浏览器里可扫一眼(侧边栏指示灯与设置页)。网关不发送 CORS 头,浏览器无法直接读取该文档;读取必须在 Host 侧完成,浏览器界面需要一条 Host→Client 通道。

## Decision

把该能力作为两个包落到既有 seams 上,不引入新机制:

- `@deepseek-ai/dsh-opencode-go-usage`(`packages/extensions/opencode-go-usage`)——Host 包。一个 `OpencodeUsageService extends TypertRemoteService` 持有该路由:`apiKeyEnv`(默认 `OPENCODE_GO_API_KEY`)、`usageUrl`(默认为网关端点)、`timeoutMs`(默认 20000)是带默认值的已校验 Config 字段。服务按请求通过 credential seam 解析密钥,用 Node 全局 `fetch` 在 `AbortSignal.timeout` 下读取文档,投影三个窗口(缺失或畸形的窗口成为 `null` 字段,绝不捏造数字),并通过 `opencodeUsage` Remote 命名空间以 `@Remote('usage') usage(): Promise<UsageResult>` 暴露快照。同一构造函数经 `ctx.tools.register(defineTool(...))` 注册全局 `opencode_go_usage` 模型工具;其 `render` 把一份快照变成纯文本三窗口回答。
- `@deepseek-ai/dsh-client-ui-opencode-go-usage`(`packages/client/ui-opencode-go-usage`)——Client 包。两个增量入口:`sidebar.footer.action`(`id: opencode-go-usage`,order 10)带健康圆点、宽侧边栏下的滚动窗口百分比,以及共享三窗口读数的浮层;`settings.section`(`id: opencode-go-usage`,order 12)在同一读数上方附一行额度说明。每个入口在挂载时及每 60 秒通过注入的 `fetchUsage` 回调(即 Remote 命名空间)轮询;失败就地渲染并附重试。共享的 `UsageBody` 让两个界面保持同一呈现。

接线:Host 行与 `dsh.client` 行注册在 `dsh-web-app` bundle;`dsh-api-remotes` 的 Client 装配挂载生成的 `opencodeUsage` Remote contribution;typert workspace 生成从 Host 服务产出 `lib/typert.remote-client.*`,与其他 Remote 命名空间一致。

## Alternatives considered

**单一组合包承载两半。** 拒绝:仓库把 Host 服务与浏览器 UI 插件分开(message-feedback 的分裂),双面包会把 Host tsconfig 拖进 Client 聚合或反之。

**直接从浏览器读取。** 拒绝:网关不发送 CORS 头,从页面 origin `fetch` 会失败;CORS 变通方案仍需一个代理。

**Agent 预设行或动态 Cordis 插件。** 因持久性拒绝:预设行无法贡献浏览器 UI(客户端插件必须随 `dsh.client` 包清单发布),动态插件随进程消亡。打包路径是唯一能让工具与两个 UI 入口在重启后无需用户操作即存活的方案。

**经 `ctx.web.fetch` 路由读取。** 拒绝:web seam 的 fetch 请求不带 headers,无法表达 Bearer 认证。

## Consequences

- 挂载 Host 行的组合中,每个会话都获得 `opencode_go_usage` 工具;`dsh.client` 行进入名册后浏览器入口即出现。无需按会话配置。
- 密钥始终留在 credential seam 内;配置与日志只携带引用。
- 快照是时间点答案:网关不提供历史,一次读取可能与窗口重置竞态。
- 客户端按入口实例轮询;指示灯与设置页同时挂载时各自独立轮询。
