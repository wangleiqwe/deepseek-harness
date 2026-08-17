# Agent Note: session row menu "Open session directory"

Status: implemented

[中文](2026-08-17-session-open-directory.zh.md) | English

## Problem

A session's durable artifact is an append-only file (`~/.dsh/sessions/<encoded-cwd>/<session-id>/session.jsonl.zstd`), but the GUI offers no way to reach that directory: archiving only hides the session, `/export` hands back a ZIP, and the row menu stops at rename / fork / archive. Inspecting, backing up, or physically clearing a session log meant hand-navigating the path — or asking the agent to open Explorer.

## Decision

**New unary RPC `session.openDirectory({ sessionId })`; the host resolves the directory, never the browser.** The implementation reads the session state without acquiring an Agent (`readSessionState`), resolves the backend-owned artifact through the mounted persistence service (`sessionPersistence.locate(header)`, already the canonical location seam used by cold-session probes), and hands the directory to the existing native opener — the same `openPath`/`canOpenPaths` machinery `host.openPath` and `agentPreset.openDocument` use (Finder / Explorer / xdg-open, WSL translation included). Response `{ opened: boolean; path: string | null }`: a deployment without a native opener answers `opened: false` with the resolved directory so the UI could still show it; a backend that owns no per-session artifact (SQLite) answers `path: null`. The directory travels browser-side only in the no-opener case, mirroring `agentPreset.openDocument`.

**Client surface is the session row menu.** `workspaces.openSessionDirectory(sessionId)` (IWorkspaces contract) calls `IApiClient.sessions.openDirectory`; ui-workspace's `WorkspaceBrowserInjected` gains `openSessionDirectory` and the row menu gains `打开会话目录` (Open session directory, folder glyph between fork and archive). Failures are non-fatal console diagnostics, the same posture as archive and reorder rejections.

**`session.openDirectory` joins `PRIVILEGED_METHODS`** in dsh-client-connection: it drives the host desktop, the same loopback-pinned class as `host.openPath` / `agentPreset.openDocument`.

## Alternatives considered

- **Client computes the path from `session.cwd` by replicating the project-key encoding.** Rejected: the harness home, the encoding, and the backend layout are host-internal facts; a browser reimplementation would drift with every layout change.
- **Extend `host.openPath` to accept a sessionId.** Rejected: its contract is an arbitrary host-resolvable path; session-directory resolution is session-domain responsibility.
- **New open-capability package.** Rejected: the native opener already exists; only the session-directory resolution entry was missing.

## Consequences

**Cost**: one full unary-RPC wiring surface (schema, rpc-map, handler row, fetch client, privileged-method pin, catalogs) plus one menu item; on a headless deployment the menu click no-ops silently (Known Limitation in the ui-workspace README).

**Gain**: two clicks open the session's log directory in the native desktop; path resolution stays host-side; archive (hide), export (copy), and open-directory (locate) now cover the three practical relationships to a session artifact.
