# Agent Note: Electron desktop shell as a sidecar supervisor

Status: implemented

English | [中文](2026-08-14-desktop-electron-shell.zh.md)

## Problem

The Web GUI is a browser tab over a locally served address (`dsh web`,
`http://127.0.0.1:3080` by default). Desktop users want a double-click entry
point: an application window, a taskbar presence, and a tray, without the
server ever being a manual prerequisite. Packaging the harness itself into a
desktop app must not fork its runtime or degrade its plugin extensibility.

## Decision

A new workspace app [`apps/desktop`](../../../../apps/desktop/README.md)
(`@deepseek-ai/dsh-desktop`) is a **pure shell**: Electron supervises the same
`dsh web` server process and hosts the window/tray chrome. The harness is never
required into the Electron runtime, so plugin loading, ESM layout, profiles,
tools, sessions, and model providers stay byte-identical to the browser
deployment.

### Server supervision: attach or own, never both

`ServerSupervisor.ensure` probes the configured URL first. An answering server
is **attached**: the shell never stops it. An unreachable one is **owned**:
the shell spawns it, waits for readiness (HTTP probe polling, default 60s
deadline), and stops it on quit — `stopOnQuit: true` default. Ownership is the
only stop authority: an attached server survives any shell lifecycle.

### Spawn resolution order

1. `server.command` from settings (shell command line — the configured escape
   hatch for packaged installs).
2. A checkout-local source launch (`node --import tsx/esm apps/cli/src/bin.ts web`
   with cwd at the detected repository root) when launched from the checkout.
3. Otherwise fail loud with a dialog naming the log file — never a silent
   half-open shell.

### Loopback-only surface

`server.url` must be `http` on a loopback host (`127.0.0.1` / `localhost` /
`::1`), validated at parse time and again for environment overrides. The shell
can only ever reach a machine-local harness, so it cannot become a
remote-execution launcher.

### Window, tray, and identity

Single-instance lock with focus-steal on relaunch; `AppUserModelId`
`com.deepseekai.dsh.desktop` (matches the electron-builder appId) for taskbar
grouping. Window bounds persist to `window-state.json` and are re-clamped onto
a live display work area when the persisted position is fully off-screen.
Close-to-tray (default) hides the window; `退出` in the tray menu quits and
runs the owned-server shutdown. External links and cross-origin navigations
leave the shell through the system browser. Per-install logs: `desktop.log`
(shell lifecycle, incl. `page loaded` markers) and `server.log` (owned child
stdio) under userData.

### Whale-mark icon pipeline

The shared mark `apps/web/public/favicon.svg` is rasterized by
`scripts/generate-icons.ts` (sharp, SVG-density-exact) into committed PNGs:
black on transparent for window/taskbar and `assets/icon-512.png`, which
electron-builder converts into the multi-size `.ico` embedded in the exe; the
mark inverted to white for the tray (Windows taskbars are dark). Tests pin the
committed PNG dimensions and the black/white difference.

### Configurability

`settings.json` under userData (schema and defaults in
[`src/config.ts`](../../../../apps/desktop/src/config.ts)): server url /
command / spawn / stopOnQuit / readinessTimeoutMs and window width / height /
closeToTray. Unknown keys are ignored; wrong types fail loud at startup.
Environment overrides (`DSH_DESKTOP_SERVER_URL`, `DSH_DESKTOP_SERVER_COMMAND`,
`DSH_DESKTOP_SPAWN`, `DSH_DESKTOP_CLOSE_TO_TRAY`, `DSH_DESKTOP_USER_DATA`) win
over the file.

### Testing split

Pure-Node logic (config, probe, repo detection, window bounds, supervisor
decisions) lives in electron-free modules with vitest unit suites. The
Electron smoke ([`tests/desktop.e2e.ts`](../../../../apps/desktop/tests/desktop.e2e.ts))
spawns the real binary against an in-process mock server with `stdio: 'ignore'`
and asserts through the shell's own `desktop.log` (attach + page load), rather
than through the playwright `_electron` launcher: `stdio: 'ignore'` keeps the
lane runnable inside harness sandboxes whose named-pipe boundary forbids
piped child stdio, and the log is the shell's authoritative lifecycle record.

## Alternatives considered

**Embed the harness in the Electron main process.** The shortest process
count, but it couples plugin loading, ESM layout, and the agent runtime to
Electron's Node build; every Electron upgrade becomes a harness runtime
change, and the web/CLI deployments stop exercising the same module graph.
Rejected: the sidecar keeps one runtime and one deployment contract.

**Tauri (or Pake-style) Rust shell.** A much smaller binary, but a second
toolchain and build chain for the same sidecar supervision this app needs,
plus a sidecar process for the Node server anyway. Rejected for now: Electron
is the zero-toolchain choice for a Node-first repository.

**Rely on the existing PWA manifest alone.** The frontend already ships
`manifest.webmanifest` (`display: fullscreen`), so a browser can install a
standalone window — but nothing supervises the server process. The desktop
shell adds exactly that supervision; PWA install remains a separate, lighter
option for users who prefer it.

**Generic URL wrappers (nativefier, Edge `--app` mode).** Quick for one
machine, but no server lifecycle ownership, no repository integration, and no
packaging gate. Kept as user-side alternatives, not the product path.

## Consequences

**Bought**: a double-click desktop entry with owned server lifecycle; zero
changes to the harness runtime, so extensibility (cordis profiles, plugins,
tools) is untouched; one committed icon pipeline feeding window, taskbar,
tray, and installer; cross-platform electron-builder targets (portable + NSIS
on Windows, AppImage on Linux, dmg-ready config on macOS).

**Paid**: Electron's binary weight (installed dependency and packaged exe
alike); the packaged app assumes a reachable server or a configured
`server.command` (no bundled server — deliberate, the harness is not
re-packaged here); hand-edited settings with no UI yet; no auto-start at
login; `test:desktop` runs on demand rather than in the default CI suite.
