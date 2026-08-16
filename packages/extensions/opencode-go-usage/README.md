# @deepseek-ai/dsh-opencode-go-usage

English | [中文](README.zh.md)

Host capability for the OpenCode Go subscription usage document: one service exposing the rolling five-hour, weekly, and monthly windows through the `opencodeUsage` Remote namespace, plus the globally registered `opencode_go_usage` model tool.

The gateway answers `GET /zen/go/v1/usage` with Bearer authentication. The key resolves per request through the credential seam (default reference `OPENCODE_GO_API_KEY`), so a changed credential reaches the next read without a restart and the secret never enters configuration, logs, or process arguments.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `OPENCODE_GO_API_KEY` | Credential reference (environment-variable name) supplying the Go API key. |
| `usageUrl` | `https://opencode.ai/zen/go/v1/usage` | Gateway endpoint serving the usage document. |
| `timeoutMs` | `20000` | Per-read HTTP deadline in milliseconds. |

```yaml
- id: opencode-go-usage
  name: '@deepseek-ai/dsh-opencode-go-usage'
  config:
    apiKeyEnv: OPENCODE_GO_API_KEY
    usageUrl: https://opencode.ai/zen/go/v1/usage
    timeoutMs: 20000
```

## Installation

This repository ships both rows in the `dsh-web-app` bundle. A deployment outside this repository declares the dependency and mounts the row in its own composition:

```json
// profile or bundle package.json
"dependencies": {
  "@deepseek-ai/dsh-opencode-go-usage": "^0.1.0"
}
```

```yaml
# composition patch layer
- id: opencode-go-usage
  name: '@deepseek-ai/dsh-opencode-go-usage'
```

Prerequisites: the host composition must mount the credential seam (`dsh-credentials-local`) so the key resolves, and the tool registry (`dsh-tools`). The browser surfaces come from `@deepseek-ai/dsh-client-ui-opencode-go-usage`, whose `opencodeUsage` Remote namespace rides the `dsh-api-remotes` Client assembly — use a `dsh` release that ships the same `opencodeUsage` mount.

## Model Experience

Registers one model tool, `opencode_go_usage` (no parameters). The tool reads the current usage document and renders the three windows as plain text:

```
OpenCode Go 套餐额度(更新于 2026-08-14 23:46):
滚动5小时: 53% | 重置于 2026-08-14 23:46
本周: 21% | 重置于 2026-08-17 08:00
本月: 10% | 重置于 2026-09-14 16:48
```

A failed read renders the failure reason instead. Windows the gateway does not describe render as `未知`.

No persistent token cost beyond the tool schema; each read is one small gateway request (no model-side KV-cache effect).

## Consumers

- The model tool is registered globally and callable in every session of a composition that mounts this row.
- `@deepseek-ai/dsh-client-ui-opencode-go-usage` reads the `opencodeUsage` Remote namespace for the sidebar-foot indicator and the settings usage page.

## Known Limitations and Deferred Work

- Only the current snapshot is available; the gateway exposes no historical series, so the package records no time series either.
- The gateway's `status` field is carried through as a string; the package does not interpret status values.
- One read may race a window reset; the snapshot is a point-in-time answer, not a committed ledger.
