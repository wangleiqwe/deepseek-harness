# @deepseek-ai/dsh-client-ui-settings-image-caption

[English](README.md) | 中文

宿主端图片识别转换（`@deepseek-ai/dsh-image-caption`）的设置界面：设置面板上的一个页面，用于开关贴入图片的识别，并选择生成图注所用的视觉路线。Host 拥有转换逻辑与 `image-caption` 设置命名空间，本包只负责把这个命名空间投影成界面。

## 界面

- `settings.section`（`id: image-caption`，order 20）：「图片识别」页面，含启用开关、视觉供应商选择器、按目录中声明了 `image` 输入模态过滤的模型选择器，以及失败策略（`placeholder` 以占位说明继续，`fail` 终止本轮）。

分区通过 `settings.describe` 读取命名空间、通过 `llm.models` 读取模型目录，写入走带 `expectedRevision` 的 `settings.replace`，并在推送的 `settings/document-updated` 事件上重新拉取，使所有已打开的设置界面在写入后收敛到同一状态。

## 模型体验

无模型可见面：本包不注册工具、提示词片段或模型可见事件。转换本身在 Host 上执行并记录在那里；本分区只新增上述设置页，不改变任何对话或会话内容。Token 与 KV 缓存影响：无。

## 已知限制与后续工作

- 这里只能编辑 `enabled`、`provider`、`model`、`onError` 四项；`prompt` 与 `maxTokens` 仍是宿主插件的 cordis.yml 配置。
- 模型选择器只列出目录中声明了包含 `image` 的 `inputModalities` 的模型；供应商目录里没有视觉模型时，以「无视觉模型」提示代替选择器。
- 宿主插件未挂载时命名空间不存在，分区回退到代码默认值（启用、占位策略），选择器为空。
- 别处的并发写入会以分区内错误行呈现；下一次加载会取回胜出的值。
