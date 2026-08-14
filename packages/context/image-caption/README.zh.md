# @deepseek-ai/dsh-image-caption

[English](README.md) | 中文

Agent 平面的内容变换：让**纯文本主模型也能处理贴进来的图片**。当进入步骤的
用户消息携带图片块时，本插件把每张图片通过配置的视觉路由生成文字描述，并用
描述文本替换图片块——主模型读到的是图片内容，而不是因不支持图片内容被拒绝。

## 挂载

opt-in——放在预设行或 home patch 层，绝不进入出厂默认：

```yaml
- id: image-caption
  name: '@deepseek-ai/dsh-image-caption'
  config:
    provider: opencode-go
    model: minimax-m3
```

`provider` 与 `model` 必填：不存在对所有部署都安全的默认视觉路由。provider
路由必须已注册（例如通过 pi-ai 适配器的 profile），且其模型必须接受图片输入。
可选字段：

- `prompt` —— 描述提示词；默认是逐字转录指令，见
  [`src/config.ts`](src/config.ts)。
- `maxTokens` —— 单次描述的输出上限；默认 1024。
- `onError` —— `placeholder`（默认）把失败的描述替换为携带失败码的文本块，
  步骤继续；`fail` 让失败终结本轮。

## 行为

插件以 `prepend: true` 挂在 `agent/pre-step` 瀑布上并先委托下游，因此其他
监听器看到的仍是原始消息，本变换最后落地：

- 无图片的决策原样放行；
- 每个 `ImageBlock` 变成以持久化 `CAPTION_PREFIX`
  （"The user attached an image to this message. …"）开头、后接视觉模型描述的
  文本块；
- 相邻块保持顺序，消息保留 `user` 来源；
- 空描述视为失败（图片含义不能静默消失），已中止的步骤绝不发起描述调用；
- 没有附件服务的组合保持惰性——那里不会出现图片块——万一出现则按图报告
  `NO_ATTACHMENTS`。

循环恰好把返回的批次记为 `user/message` 事件，因此"模型可见 ⟺ 已记录"不变量
成立，重放也能重建被描述后的请求。invariant 伴生文件
（[`src/invariant.ts`](src/invariant.ts)）固定持久关系：携带描述前缀的
`user/message` 不得残留图片块。

## 模型影响

每条含图消息给配置的视觉路由增加一次辅助 LLM 调用（输入：图片加提示词；
输出：描述）。该调用的 token 与费用按视觉供应商自己的计费；主模型请求除
"描述文本替换图片块"外无任何变化。

## 已知限制

- 描述调用未设置 `GenerateOptions.purpose`——封闭的 `purpose` 联合还没有
  image-caption 成员。
- 失败占位只携带结构化错误码，不带供应商消息。
- 目前只有用户内容携带图片，因此变换只检查用户角色的消息。
