# Agent Note: OpenCode Go usage as a packaged capability

Status: implemented

English | [中文](2026-08-14-opencode-go-usage-package.zh.md)

## Problem

A subscription to OpenCode Go carries three usage windows — a rolling five-hour window (about $12), a weekly window (about $30), and a monthly window (about $60) — answered by the gateway at `GET https://opencode.ai/zen/go/v1/usage` with Bearer authentication. The user wants the current consumption visible from inside the harness: askable in conversation (a model tool) and glanceable in the browser (a sidebar indicator and a settings page). The gateway sends no CORS headers, so the browser cannot read the document directly; the read must happen Host-side, and the browser surface needs a Host-to-Client channel.

## Decision

Ship the capability as two packages over the existing seams, no new machinery:

- `@deepseek-ai/dsh-opencode-go-usage` (`packages/extensions/opencode-go-usage`) — the Host package. One `OpencodeUsageService extends TypertRemoteService` owns the route: `apiKeyEnv` (default `OPENCODE_GO_API_KEY`), `usageUrl` (default the gateway endpoint), and `timeoutMs` (default 20000) are validated Config fields with defaults. The service resolves the key per request through the credential seam, reads the document with Node's global `fetch` under `AbortSignal.timeout`, projects the three windows (malformed or absent windows become `null` fields, never fabricated numbers), and exposes the snapshot through the `opencodeUsage` Remote namespace as `@Remote('usage') usage(): Promise<UsageResult>`. The same constructor registers the global `opencode_go_usage` model tool via `ctx.tools.register(defineTool(...))`; its `render` turns one snapshot into the plain-text three-window answer.
- `@deepseek-ai/dsh-client-ui-opencode-go-usage` (`packages/client/ui-opencode-go-usage`) — the Client package. Two additive entries: `sidebar.footer.action` (`id: opencode-go-usage`, order 10) with a health dot, the rolling percentage in the wide sidebar, and a popover with the shared three-window readout; and `settings.section` (`id: opencode-go-usage`, order 12) with a limit explainer above the same readout. Each entry polls through the injected `fetchUsage` callback (the Remote namespace) on mount and every 60 seconds; failures render inline with a retry. The shared `UsageBody` keeps the two surfaces in one presentation.

Wiring: the Host row and the `dsh.client` row are registered in the `dsh-web-app` bundle; the `dsh-api-remotes` Client assembly mounts the generated `opencodeUsage` Remote contribution; the typert workspace generation emits `lib/typert.remote-client.*` from the Host service like every other Remote namespace.

## Alternatives considered

**A single combined package with both halves.** Rejected: the repo separates Host services from browser UI plugins (the message-feedback split), and a dual-face package would drag the Host tsconfig into the Client aggregate or vice versa.

**Read from the browser directly.** Rejected: the gateway sends no CORS headers, so `fetch` from the page origin fails; a CORS workaround would need a proxy anyway.

**An agent-preset row or a dynamic Cordis plugin.** Rejected for durability: a preset row cannot contribute browser UI (client plugins must ship in `dsh.client` package manifests), and a dynamic plugin dies with the process. The packaged path is the only one where the tool and both UI entries survive restarts without user action.

**Route the read through `ctx.web.fetch`.** Rejected: the web seam's fetch request carries no headers, so it cannot express Bearer authentication.

## Consequences

- Every session of a composition mounting the Host row gets the `opencode_go_usage` tool; the browser entries appear once the `dsh.client` row is in the roster. No per-session configuration.
- The key stays inside the credential seam; configuration and logs carry only the reference.
- The snapshot is point-in-time: the gateway exposes no history, and a read may race a window reset.
- The client polls per entry instance; the indicator and the settings page poll independently while both are mounted.
