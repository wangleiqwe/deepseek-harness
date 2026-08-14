# @deepseek-ai/dsh-opencode-go-usage

[English](README.md) | 中文

OpenCode Go 订阅额度文档的宿主能力:一个服务通过 `opencodeUsage` Remote 命名空间暴露滚动 5 小时、每周、每月三个窗口,并全局注册 `opencode_go_usage` 模型工具。

网关接口为 `GET /zen/go/v1/usage`,使用 Bearer 认证。密钥通过 credential 服务按请求解析(默认引用 `OPENCODE_GO_API_KEY`),因此更换密钥无需重启即可生效,密钥也不会进入配置、日志或进程参数。

## 配置

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `apiKeyEnv` | `OPENCODE_GO_API_KEY` | 提供 Go API 密钥的凭据引用(环境变量名)。 |
| `usageUrl` | `https://opencode.ai/zen/go/v1/usage` | 提供额度文档的网关端点。 |
| `timeoutMs` | `20000` | 单次读取的 HTTP 超时(毫秒)。 |

```yaml
- id: opencode-go-usage
  name: '@deepseek-ai/dsh-opencode-go-usage'
  config:
    apiKeyEnv: OPENCODE_GO_API_KEY
    usageUrl: https://opencode.ai/zen/go/v1/usage
    timeoutMs: 20000
```

## 模型体验

注册一个模型工具 `opencode_go_usage`(无参数)。工具读取当前额度文档并以纯文本呈现三个窗口:

```
OpenCode Go 套餐额度(更新于 2026-08-14 23:46):
滚动5小时: 53% | 重置于 2026-08-14 23:46
本周: 21% | 重置于 2026-08-17 08:00
本月: 10% | 重置于 2026-09-14 16:48
```

读取失败时呈现失败原因;网关未描述的窗口呈现为「未知」。

除工具 schema 外无持续 token 开销;每次读取只是一次小型网关请求(无模型侧 KV-cache 影响)。

## 消费方

- 模型工具全局注册,挂载本行的组合中的每个会话都可调用。
- `@deepseek-ai/dsh-client-ui-opencode-go-usage` 读取 `opencodeUsage` Remote 命名空间,用于侧边栏底部指示灯与设置页额度页面。

## 已知限制与后续工作

- 只能获取当前快照;网关不提供历史序列,因此本包也不记录时间序列。
- 网关的 `status` 字段以字符串透传;本包不解释状态值。
- 一次读取可能与窗口重置竞态;快照只是某一时刻的答案,不是已提交的账本。
