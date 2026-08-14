# Agent Note: 图片描述作为内容变换

Status: implemented

[English](2026-08-14-image-caption-content-transform.md) | 中文

## Problem

贴入的图片已经能在 harness 中端到端流转（输入区接收、附件存储、`ImageBlock`
词汇），但纯文本的 `deepseek-official` 路由在序列化时就拒绝图片内容，因此
`deepseek-v4-pro` 上的会话完全无法发送图片。视觉模型都在其他路由上（例如
`opencode-go` 这个 pi-ai profile），而用户希望主模型保持纯文本的同时，图片
仍然贡献信息——并且视觉路由要在设置页上可选，而不只是改 cordis.yml。

## Decision

新增 agent 平面插件
[`packages/context/image-caption`](../../../../packages/context/image-caption/README.md)
（`@deepseek-ai/dsh-image-caption`），改写最终的 `agent/pre-step` 批次：用户
消息里的每个图片块都通过配置的视觉路由生成描述并替换为文本块——主模型读到
描述，图片块则永远不会到达纯文本适配器。

### Seam 选择：`agent/pre-step` 瀑布，先委托下游

监听器以 `{ prepend: true }` 注册并先调用 `next()` 再改写，因此其他所有
pre-step 监听器（压缩压力、目标校验、hooks、重复工具提醒）看到的仍是原始
消息，本变换最后落地。循环把返回的批次记为 `user/message` 事件——"模型可见 ⟺
已记录"不变量无需专门日志步骤即成立，重放也能重建被描述后的请求。带图片块的
原始消息只保留在 `agent/inbox/spliced` 收据里（非模型可见）。

### 描述请求形状

每张图片一次辅助 `ctx.llm.stream` 调用：provider/model 来自配置，`maxTokens`
有上限（默认 1024），转发 pre-step 的 `AbortSignal`，`purpose` 字段有意不设置
（封闭联合还没有 image-caption 成员；加宽该类型已推迟）。请求消息原样携带
`ImageBlock`——会读取附件的适配器（pi-ai）自行解析字节。

### 失败语义

空描述、错误 finish 或中止都是失败：`onError: placeholder`（默认）下该块变成
点名结构化错误码的文本占位，步骤继续；`onError: fail` 下失败终结本轮。任何
失败都不会静默消失。

### 配置

所有字段（`enabled`、`provider`、`model`、`prompt`、`maxTokens`、`onError`）
都在通过 `installSettingsSection` 注册的 `image-caption` 设置命名空间中；
`src/config.ts` 的 schema 是边界与默认值的单一归属。生效值逐字段回退到组合
条目（预设行或 home patch 层），因此用户层选择覆盖出厂基值而无需重复它。
`provider` 与 `model` 没有安全默认——未配置的路由按图报告 `UNCONFIGURED`。

另有两个开关补全行为：`autoSkipWhenMainModelAcceptsImages`（默认 true）在
主路由解析出的模型声明了 `image` 输入模态时原样放行消息（主模型原生读图）；
`enabled: false` 则完全关闭变换。

配套客户端包
[`packages/client/ui-settings-image-caption`](../../../../packages/client/ui-settings-image-caption/README.md)
（`@deepseek-ai/dsh-client-ui-settings-image-caption`）注册「图片识别」
`settings.section`：开关与 provider/model 选择器（经 `llm.models` 目录过滤到
视觉能力条目），读写走带 `expectedRevision` 的 `settings.describe`/`replace`，
并在推送的 `settings/document-updated` 事件上刷新。UI 编辑 `enabled`、
`provider`、`model`、`onError` 四项；`prompt` 与 `maxTokens` 仍只走
cordis.yml。向配置客户端提供该命名空间是 apiproxy 白名单
（`WEB_SETTINGS_NAMESPACES`）里的决定，`image-caption` 已登记——没有这一行，
`settings.describe` 会过滤掉命名空间，分区只能渲染代码默认值。

挂载保持 opt-in：宿主包声明在 `apps/cli` 依赖中，使裸名能通过修复后的
profiles fallback 解析，但任何出厂组合都不挂载它；命名空间缺失时客户端分区
渲染代码默认值。

### 持久不变量

伴生文件校验一条关系：内容携带描述前缀的 `user/message` 不得残留图片块
（变换是替换，不是追加）。没有前缀的消息不在此关系内，因此其他预设上的会话
依然有效。

## Alternatives considered

**把会话主模型换成视觉模型（只改配置）。** 一条设置改动即可让图片原生流通——
但整个会话的费用、延迟和推理风格都搬到视觉路由上，用户对主模型的选择被顶替。
保留为用户选项；本插件保全主模型。

**用 `describe_image` 工具代替变换。** agent 会为每张图片调用工具，但贴入的
图片作为消息内容进入，纯文本适配器在任何工具调用发生之前就拒绝了该消息——
工具救不了这条消息。拒绝：变换是请求派生前唯一的介入点。

**把描述写成额外注入消息（time-context 风格）。** 插件来源的额外消息会保留
原始图片消息——但原始消息仍带着图片块进入请求，纯文本适配器照样拒绝。
拒绝：必须替换，不能追加。

**给 `GenerateOptions.purpose` 加 `image-caption` 成员。** 路由元数据更干净，
但这是为一个消费方改动核心封闭联合；推迟到有第二个 purpose 需要同样处理时。

## Consequences

**换来**：纯文本主模型现在能以忠实描述接收贴入图片；主路由、费用与工具行为
不受影响；重放、同一预设上的子代理会话和持久日志都自动携带描述后的形式；
视觉路由与失败策略是逐部署配置，且可在设置页修改而无需改 cordis.yml；主模型
接受图片的会话整体跳过变换。

**付出**：每张图片多一次视觉调用（延迟加视觉路由计费——`opencode-go` 实测：
minimax-m3 描述整张 UI 截图约 12.5 秒、$0.0021）；描述本质有损——差的视觉
模型可能误导主模型（占位路径能限制损失但无法消除）；没有附件服务的组合保持
惰性并按图报告 `NO_ATTACHMENTS`，因此插件在 headless profile 上也能安全挂载。
