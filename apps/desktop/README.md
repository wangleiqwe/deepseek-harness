# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

Desktop shell for DeepSeek Harness: an Electron window and tray around the
same `dsh web` server. The harness itself is never embedded — the server keeps
running as the identical `dsh web` process, and this app only supervises it and
hosts the window/tray chrome, so every plugin, profile, tool, and session
behaves exactly as in the browser.

## Run (from a checkout)

```sh
pnpm install
pnpm run dev:desktop
```

The shell probes `http://127.0.0.1:3080`: an already-running server is
attached (and never stopped), otherwise the shell starts one through the
checkout's own source launch (`node --import tsx/esm apps/cli/src/bin.ts web`).
The close button hides to the tray; `退出` in the tray menu quits and stops
only a server this shell started.

## Package

```sh
pnpm run pack:desktop   # unpacked build under apps/desktop/dist/win-unpacked
pnpm run dist:desktop   # portable exe + NSIS installer under apps/desktop/dist
```

The packaged app needs a reachable server: either one already running, or a
startup command configured in settings (a checkout-local auto-start works only
when launched from the repository).

## Configuration

`settings.json` lives in Electron's userData directory (`%APPDATA%/<app>`; the
shell prints its paths into `desktop.log` beside it). Unknown keys are
ignored; wrong types fail at startup with a dialog.

```json
{
  "server": {
    "url": "http://127.0.0.1:3080",
    "command": null,
    "spawn": true,
    "stopOnQuit": true,
    "readinessTimeoutMs": 60000
  },
  "window": { "width": 1280, "height": 800, "closeToTray": true }
}
```

- `server.url` — the served web UI address; the http scheme and a loopback
  host are mandatory, so the shell can never become a remote-execution
  launcher.
- `server.command` — shell command line used when the shell must start the
  server itself; null (default) falls back to the checkout-local spawn.
- `server.spawn` — whether the shell may start the server when the URL is
  unreachable.
- `server.stopOnQuit` — whether quitting stops a server this shell started
  (an attached server is never touched).
- `server.readinessTimeoutMs` — deadline for a spawned server to answer.
- `window.closeToTray` — the close button hides to tray instead of quitting.

Environment overrides win over the file: `DSH_DESKTOP_SERVER_URL`,
`DSH_DESKTOP_SERVER_COMMAND`, `DSH_DESKTOP_SPAWN` (`0`/`1`/`false`/`true`),
`DSH_DESKTOP_CLOSE_TO_TRAY`, and `DSH_DESKTOP_USER_DATA` (profile override,
also used by the smoke test).

Per-install state in userData: `desktop.log` (shell lifecycle), `server.log`
(child stdio), `window-state.json` (persisted bounds, moved back on screen
when a monitor disappears).

## Icons

The whale mark comes from [`apps/web/public/favicon.svg`](../web/public/favicon.svg):
black on transparent for the window, taskbar, and the packaged application
icon (electron-builder converts `assets/icon-512.png` into a multi-size
`.ico`), and inverted to white for the tray. The PNGs under `assets/` are
committed; regenerate them after a favicon change with
`pnpm --filter @deepseek-ai/dsh-desktop run icons`.

## Testing

- Unit tests (pure Node modules, no Electron binary):
  `pnpm exec vitest run apps/desktop/tests` — config parsing, loopback
  enforcement, server probing/ownership, checkout detection, window bounds.
- Electron smoke (real binary, real main process against a mock server):
  `pnpm run test:desktop`. The shell is spawned with `stdio: 'ignore'` so the
  lane also runs inside harness sandboxes whose named-pipe boundary forbids
  piped child stdio; assertions read the shell's own `desktop.log`.

## Known limitations

- No settings UI yet: `settings.json` is hand-edited, and `server.command` is
  the configured escape hatch for packaged installs without a local checkout.
- No auto-start at login; the tray icon is static (no unread/busy states).
- `test:desktop` is not wired into the default CI suite (the Electron binary
  is heavy); it runs on demand.
