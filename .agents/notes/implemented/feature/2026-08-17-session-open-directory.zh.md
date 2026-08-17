# Agent Note: 会话行菜单「打开会话目录」

Status: implemented

[English](2026-08-17-session-open-directory.md) | 中文

## Problem

会话的持久工件是追加式文件（`~/.dsh/sessions/<编码cwd>/<会话ID>/session.jsonl.zstd`），但 GUI 没有任何入口够到它：归档只隐藏会话，`/export` 交回的是 ZIP，行菜单止步于重命名/分叉/归档。要查看、备份或物理清理某个会话日志，只能手工导航路径——或者让 agent 代开资源管理器。

## Decision

**新一元 RPC `session.openDirectory({ sessionId })`，目录由宿主解析，绝不来自浏览器。** 实现不获取 Agent 地读取会话状态（`readSessionState`），经挂载的持久化服务解析后端工件（`sessionPersistence.locate(header)`——冷会话探测已在用的权威定位缝），把目录交给既有 native opener——`host.openPath` 与 `agentPreset.openDocument` 同一条 `openPath`/`canOpenPaths` 机制（Finder / Explorer / xdg-open，含 WSL 翻译）。响应 `{ opened: boolean; path: string | null }`：无 native opener 的部署回答 `opened: false` 并携带解析出的目录（UI 仍可展示）；无逐会话工件的后端（SQLite）回答 `path: null`。目录只在无 opener 可交付时随响应回浏览器，与 `agentPreset.openDocument` 同款。

**客户端表面是会话行菜单。** `workspaces.openSessionDirectory(sessionId)`（IWorkspaces 契约）调 `IApiClient.sessions.openDirectory`；ui-workspace 的 `WorkspaceBrowserInjected` 增加 `openSessionDirectory`，行菜单在分叉与归档之间新增「打开会话目录」（文件夹字形）。失败为非致命 console 诊断，与归档、排序拒绝同姿态。

**`session.openDirectory` 加入 `PRIVILEGED_METHODS`**（dsh-client-connection）：它驱动宿主桌面，与 `host.openPath` / `agentPreset.openDocument` 同类，钉死在回环。

## Alternatives considered

- **客户端用 `session.cwd` 复刻 project-key 编码拼路径。** 否决：harness home、编码与后端布局是宿主内部事实；浏览器复刻会随每次布局改动漂移。
- **扩展 `host.openPath` 接收 sessionId。** 否决：其契约是任意宿主可解析路径；会话目录解析是会话域职责。
- **新建独立 open 能力包。** 否决：native opener 已存在，缺的只是会话目录解析入口。

## Consequences

**付出**：一条一元 RPC 的完整接线面（schema、rpc-map、handler 行、fetch client、特权方法钉、目录），加一条菜单项；无头部署上点击静默无效（ui-workspace README 的 Known Limitation）。

**换来**：两次点击在原生桌面打开会话日志目录；路径解析留在宿主；归档（藏）、导出（拷）、打开目录（定位）覆盖了与会话工件的三种实际关系。
