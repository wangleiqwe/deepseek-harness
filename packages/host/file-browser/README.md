# @deepseek-ai/dsh-host-file-browser

English | [中文](README.zh.md)

The **workspace file-browser seam**: `LocalFileBrowser` registers `ctx.fileBrowser` and serves two bounded listings — a recursive file-and-directory list under a root directory and one-level listings for tree navigation — the host data source behind the web GUI composer's file references (the `@`-file menu and the file-picker button, client package `ui-file-reference`).

Behavior facts: `listFiles` walks the root breadth-first through Node's stdlib (no display, no OS dialogs, so it serves every deployment the browse backend would), returning rows as `{ name, rel, path, kind }` — `kind` is `file` or `directory` — where `rel` is the root-relative, forward-slash spelling the composer inserts; within a level, rows yield in name order interleaving files and directories, so a bounded result holds the shallowest rows first. The walk skips dot-prefixed entries (`skipHidden`, default true — the POSIX hidden convention, same as the browse directory picker), skips `skipDirs` (default `node_modules`/`.git` — a workspace's dependency trees would otherwise consume the whole bound), never follows symlinks (no cycles, no escapes), stops at `maxDepth` (root = depth 0, default 6), and cuts at `maxFiles` file rows (default 500) and `maxDirs` directory rows (default 200) with `truncated: true` so the client can say the list is incomplete. `listLevel` returns one directory level (files and directories, name-sorted, the same skip rules, bounded by `maxFiles`) for the picker's expandable tree — the caller drives navigation one level at a time instead of re-walking the whole workspace per folder click. An explicit root that is not fully qualified — relative forms, and on Windows the rooted drive-less forms (`\foo`, `/foo`) and incomplete UNC prefixes (`\\`, `\\server`) — or a missing/unreadable directory rejects with the typed `FileBrowserError` (`directory-unreadable` on the wire, the same error vocabulary the directory picker uses). Every filesystem await races the caller's `AbortSignal`: a disconnect or timeout stops the scan instead of letting it outlive the caller, and the abort reason is the rejection.

The seam shape follows the directory-picker capability seam: a service definition plus the single shipped provider in this package; the consumers are the API gateway (`host.listFiles` and `host.listLevel`) and the browser client behind them. A second provider is not foreseeable — the interactions are bounded host-side reads.

## Model Experience

None, as the seam serves the GUI host's file listing; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Symlinked files and directories are omitted entirely** — the walk never follows links, so a workspace whose files are mostly symlinks lists them as absent (cycle safety over completeness).
- **Windows hidden attribute is not read** — Node dirents do not expose `FILE_ATTRIBUTE_HIDDEN`, so `skipHidden` means dot-prefixed on every platform until a native probe is worth its cost.
- **Whole-filesystem scope** — there is no per-deployment listing-root restriction. `workspace.create` accepts arbitrary paths, so a root here would be UX scoping rather than a security boundary.
