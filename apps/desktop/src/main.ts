/**
 * Electron entry for the dsh desktop shell. The harness is never embedded in
 * this process: the same `dsh web` server process serves the UI, and this
 * process only supervises it and hosts the window/tray chrome around it.
 * @module @deepseek-ai/dsh-desktop
 */

import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, Menu, nativeImage, screen, shell, Tray } from 'electron'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, type DesktopConfig } from './config.ts'
import { resolveRepoServerSpawn } from './repo.ts'
import { ServerSupervisor, type SpawnSpec } from './server.ts'
import { loadDesktopConfig } from './settings-file.ts'
import {
  defaultBounds,
  loadWindowState,
  saveWindowState,
  visibleBounds,
  type DisplayWorkArea,
} from './window-state.ts'

/** Windows taskbar grouping id: must match the electron-builder appId. */
const APP_USER_MODEL_ID = 'com.deepseekai.dsh.desktop'
/** userData override for tests and portable profiles. */
const USER_DATA_ENV = 'DSH_DESKTOP_USER_DATA'
const ASSETS_DIR = fileURLToPath(new URL('../assets', import.meta.url))
const WINDOW_ICON = join(ASSETS_DIR, 'icon-256.png')
const TRAY_ICON = join(ASSETS_DIR, 'tray-16.png')
/** Node binary for checkout-local server spawns; a PATH name, never Electron's own process.execPath. */
const NODE_EXECUTABLE = 'node'
const RENDERER_HEALTH_INTERVAL_MS = 5_000
const RENDERER_HEALTH_TIMEOUT_MS = 3_000
const RENDERER_FAILURE_LIMIT = 2

// Some Windows GPU drivers can lose Electron's compositor surface after the
// window is hidden or restored, leaving a black/white window until a reload.
// The desktop shell is lightweight, so software rendering is the safer default.
app.disableHardwareAcceleration()

const supervisor = new ServerSupervisor()
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let desktopLogPath = ''
let activeConfig: DesktopConfig | null = null
let activeUrl = ''
let windowStatePath = ''

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => { reopenWindow() })
  void boot()
}

/**
 * Boot the shell: read configuration, reach (or start) the server, then open
 * the window and tray. Every failure path reports through a dialog and exits
 * instead of leaving a silent half-open shell.
 */
async function boot(): Promise<void> {
  app.setAppUserModelId(APP_USER_MODEL_ID)
  const userDataOverride = process.env[USER_DATA_ENV]
  if (userDataOverride !== undefined && userDataOverride !== '') {
    app.setPath('userData', userDataOverride)
  }
  await app.whenReady()
  const userData = app.getPath('userData')
  desktopLogPath = join(userData, 'desktop.log')
  log('desktop shell starting')
  let config: DesktopConfig
  try {
    config = loadDesktopConfig(join(userData, 'settings.json'))
  } catch (error) {
    log(`settings invalid: ${describe(error)}`)
    dialog.showErrorBox('DeepSeek Harness', `设置无效：${describe(error)}\n\n修正后重新启动。`)
    app.quit()
    return
  }
  activeConfig = config
  activeUrl = config.server.url
  windowStatePath = join(userData, 'window-state.json')
  try {
    const ownership = await supervisor.ensure({
      url: config.server.url,
      spawn: spawnRequest(config),
      readinessTimeoutMs: config.server.readinessTimeoutMs,
      logPath: join(userData, 'server.log'),
    })
    log(ownership.owned ? `started dsh web server: ${config.server.url}` : `attached to running server: ${config.server.url}`)
  } catch (error) {
    log(`server startup failed: ${describe(error)}`)
    dialog.showErrorBox('DeepSeek Harness', `无法连接 DeepSeek Harness 服务：\n${describe(error)}\n\n日志：${desktopLogPath}`)
    app.quit()
    return
  }
  await createWindow(config)
  tray = createTray()
  wireLifecycle(config)
}

/**
 * Resolve the spawn to own server startup with: the configured command line
 * wins, then a checkout-local source launch. Null when the shell may not
 * start anything, which {@link ServerSupervisor.ensure} turns into a failure
 * only when no server is already answering.
 * @param config - the effective desktop configuration.
 * @returns the spawn spec, or null.
 */
function spawnRequest(config: DesktopConfig): SpawnSpec | null {
  if (config.server.command !== null) {
    return { command: config.server.command, args: [], cwd: process.cwd(), shell: true }
  }
  if (!config.server.spawn) return null
  const repo = resolveRepoServerSpawn(process.cwd(), NODE_EXECUTABLE)
  if (repo === undefined) return null
  return { command: repo.command, args: repo.args, cwd: repo.cwd }
}

/**
 * Open the main window on the server URL with persisted bounds.
 * @param config - the effective desktop configuration.
 */
async function createWindow(config: DesktopConfig): Promise<void> {
  const saved = loadWindowState(windowStatePath)
  const displays: DisplayWorkArea[] = screen.getAllDisplays().map(display => display.workArea)
  const bounds = visibleBounds(saved ?? defaultBounds(config.window.width, config.window.height), displays)
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...bounds.x !== undefined && { x: bounds.x },
    ...bounds.y !== undefined && { y: bounds.y },
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    icon: WINDOW_ICON,
    backgroundColor: '#101418',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = win
  win.on('close', (event) => {
    if (!quitting && config.window.closeToTray) {
      event.preventDefault()
      win.hide()
      return
    }
    saveWindowState(windowStatePath, win.getBounds())
  })
  win.on('closed', () => { mainWindow = null })
  // External links leave the shell: the harness UI owns in-app navigation,
  // anything else belongs to the system browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http://') || target.startsWith('https://')) void shell.openExternal(target)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin === new URL(activeUrl).origin) return
    event.preventDefault()
    void shell.openExternal(target)
  })
  wireRendererRecovery(win)
  let loadRetryCount = 0
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    log(`page load failed (${String(errorCode)} ${errorDescription}): ${validatedURL}`)
    if (loadRetryCount < 10 && !win.isDestroyed()) {
      loadRetryCount++
      log(`retrying page load (attempt ${String(loadRetryCount)})...`)
      setTimeout(() => {
        if (!win.isDestroyed()) void win.loadURL(activeUrl)
      }, 800)
      return
    }
    win.show()
  })
  win.once('ready-to-show', () => { win.show() })
  await win.loadURL(activeUrl)
  log(`page loaded: ${activeUrl}`)
}

/** Detect a renderer that is alive but has lost the entire app tree, and recover it. */
function wireRendererRecovery(win: BrowserWindow): void {
  let consecutiveFailures = 0
  let probeRunning = false
  let recoveryRunning = false

  const recover = async (reason: string): Promise<void> => {
    if (recoveryRunning || quitting || win.isDestroyed()) return
    recoveryRunning = true
    consecutiveFailures = 0
    log(`${reason}; reloading renderer`)
    try {
      await win.loadURL(activeUrl)
      log('renderer recovery complete')
    } catch (error) {
      log(`renderer recovery failed: ${describe(error)}`)
    } finally {
      recoveryRunning = false
    }
  }

  const probe = async (): Promise<void> => {
    if (probeRunning || recoveryRunning || win.isDestroyed() || win.webContents.isLoadingMainFrame()) return
    probeRunning = true
    try {
      const healthPromise = win.webContents.executeJavaScript(`(() => {
        const root = document.getElementById('root')
        const bodyTextLength = document.body?.innerText?.trim().length ?? 0
        const rootChildCount = root?.childElementCount ?? 0
        return {
          ready: document.readyState === 'complete',
          empty: bodyTextLength === 0 && rootChildCount === 0,
          bodyTextLength,
          rootChildCount,
        }
      })()`)
      const timeoutPromise = new Promise<null>((resolve) => {
        const timeout = setTimeout(() => { resolve(null) }, RENDERER_HEALTH_TIMEOUT_MS)
        timeout.unref()
      })
      const health = await Promise.race([healthPromise, timeoutPromise]) as {
        ready: boolean
        empty: boolean
        bodyTextLength: number
        rootChildCount: number
      } | null

      const failed = health === null || (health.ready && health.empty)
      if (!failed) {
        consecutiveFailures = 0
        return
      }
      consecutiveFailures++
      const detail = health === null
        ? 'renderer health probe timed out'
        : `renderer content empty (body=${String(health.bodyTextLength)}, root=${String(health.rootChildCount)})`
      log(`${detail}, check ${String(consecutiveFailures)}/${String(RENDERER_FAILURE_LIMIT)}`)
      if (consecutiveFailures >= RENDERER_FAILURE_LIMIT) await recover(detail)
    } catch (error) {
      log(`renderer health probe failed: ${describe(error)}`)
    } finally {
      probeRunning = false
    }
  }

  const interval = setInterval(() => { void probe() }, RENDERER_HEALTH_INTERVAL_MS)
  interval.unref()
  win.once('closed', () => { clearInterval(interval) })
  win.webContents.on('did-start-loading', () => { consecutiveFailures = 0 })
  win.webContents.on('render-process-gone', (_event, details) => {
    void recover(`renderer process gone (${details.reason}, exit ${String(details.exitCode)})`)
  })
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      log(`renderer console error: ${details.message} (${details.sourceId}:${String(details.lineNumber)})`)
    }
  })
}

/** Create the tray icon with its context menu. */
function createTray(): Tray {
  const created = new Tray(nativeImage.createFromPath(TRAY_ICON))
  created.setToolTip('DeepSeek Harness')
  created.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 DeepSeek Harness', click: () => { showWindow() } },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit() } },
  ]))
  created.on('click', () => { toggleWindow() })
  return created
}

/** Show the window (recreating it on macOS when a real close removed it). */
function showWindow(): void {
  if (mainWindow !== null) {
    mainWindow.show()
    mainWindow.focus()
    return
  }
  if (activeConfig !== null) void createWindow(activeConfig)
}

function reopenWindow(): void {
  showWindow()
}

function toggleWindow(): void {
  if (mainWindow === null) return
  if (mainWindow.isVisible()) mainWindow.hide()
  else showWindow()
}

function wireLifecycle(config: DesktopConfig): void {
  app.on('window-all-closed', () => {
    if (quitting || !config.window.closeToTray) app.quit()
    // Close-to-tray leaves the shell alive with the tray icon only.
  })
  app.on('activate', () => { reopenWindow() })
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void shutdown().finally(() => { app.quit() })
  })
}

async function shutdown(): Promise<void> {
  tray?.destroy()
  tray = null
  await supervisor.stop()
  log('desktop shell stopped')
}

function log(message: string): void {
  if (desktopLogPath === '') return
  try {
    appendFileSync(desktopLogPath, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Swallows every write failure (disk full, deleted directory): a broken
    // log file must never take the shell down with it.
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
