/**
 * Desktop configuration: the settings.json schema, defaults, validation, and
 * environment overrides. Pure Node module — no Electron imports — so unit
 * tests run on plain Node.
 * @module @deepseek-ai/dsh-desktop/config
 */

/** Loopback hostnames a desktop shell may probe and load; any other host would turn the shell into a remote-execution launcher. */
const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '::1', '[::1]']

/** The web profile's documented default address. */
const DEFAULT_SERVER_URL = 'http://127.0.0.1:3080'
/** How long the shell waits for a freshly spawned server to answer the readiness probe. */
const DEFAULT_READINESS_TIMEOUT_MS = 60_000
/** Default window size for a fresh install. */
const DEFAULT_WINDOW_WIDTH = 1280
const DEFAULT_WINDOW_HEIGHT = 800
/** Smallest accepted window size (settings.json validation and the live window minimum). */
export const MIN_WINDOW_WIDTH = 400
export const MIN_WINDOW_HEIGHT = 300

/** Environment override keys read by {@link applyEnvOverrides}. */
export const ENV = {
  serverUrl: 'DSH_DESKTOP_SERVER_URL',
  serverCommand: 'DSH_DESKTOP_SERVER_COMMAND',
  serverSpawn: 'DSH_DESKTOP_SPAWN',
  closeToTray: 'DSH_DESKTOP_CLOSE_TO_TRAY',
} as const

/** Settings violations: reported to the user at startup instead of silently falling back. */
export class ConfigError extends Error {}

interface ServerConfig {
  /** The served web UI address; the http scheme and a loopback host are mandatory. */
  url: string
  /** Shell command line to start the server with when the shell must own startup; null falls back to the checkout-relative spawn. */
  command: string | null
  /** Whether the shell may start the server itself when the URL is unreachable. */
  spawn: boolean
  /** Whether quitting the shell stops a server the shell started (an already-running server is never touched). */
  stopOnQuit: boolean
  /** Deadline for a spawned server to answer the readiness probe. */
  readinessTimeoutMs: number
}

interface WindowConfig {
  width: number
  height: number
  /** The close button hides to tray instead of quitting. */
  closeToTray: boolean
}

export interface DesktopConfig {
  server: ServerConfig
  window: WindowConfig
}

/** The built-in configuration every field falls back to. */
export function defaultConfig(): DesktopConfig {
  return {
    server: {
      url: DEFAULT_SERVER_URL,
      command: null,
      spawn: true,
      stopOnQuit: true,
      readinessTimeoutMs: DEFAULT_READINESS_TIMEOUT_MS,
    },
    window: {
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      closeToTray: true,
    },
  }
}

/**
 * Parse settings.json content into a validated configuration over
 * {@link defaultConfig}. Unknown keys are ignored (forward compatibility);
 * wrong types and invalid values fail loud with {@link ConfigError}.
 * @param raw - file content; empty for a missing file.
 * @returns the merged configuration.
 */
export function parseConfig(raw: string): DesktopConfig {
  let data: unknown
  try {
    data = raw.trim() === '' ? {} : JSON.parse(raw)
  } catch {
    throw new ConfigError('settings.json: 不是合法的 JSON')
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ConfigError('settings.json: 顶层必须是对象')
  }
  const record = data as Record<string, unknown>
  const defaults = defaultConfig()
  const serverRaw = section(record.server, 'server')
  const windowRaw = section(record.window, 'window')
  const url = stringField(serverRaw, 'url', 'server.url') ?? defaults.server.url
  validateServerUrl(url)
  const command = stringField(serverRaw, 'command', 'server.command') ?? defaults.server.command
  return {
    server: {
      url,
      command: command === '' ? null : command,
      spawn: booleanField(serverRaw, 'spawn', 'server.spawn') ?? defaults.server.spawn,
      stopOnQuit: booleanField(serverRaw, 'stopOnQuit', 'server.stopOnQuit') ?? defaults.server.stopOnQuit,
      readinessTimeoutMs: positiveIntField(serverRaw, 'readinessTimeoutMs', 'server.readinessTimeoutMs') ?? defaults.server.readinessTimeoutMs,
    },
    window: {
      width: windowSize(windowRaw, 'width', 'window.width', MIN_WINDOW_WIDTH) ?? defaults.window.width,
      height: windowSize(windowRaw, 'height', 'window.height', MIN_WINDOW_HEIGHT) ?? defaults.window.height,
      closeToTray: booleanField(windowRaw, 'closeToTray', 'window.closeToTray') ?? defaults.window.closeToTray,
    },
  }
}

/**
 * Apply launcher environment overrides on top of a parsed file. Any override
 * set to a non-empty value wins over the file; a malformed override fails
 * loud rather than being skipped.
 * @param config - the parsed file configuration.
 * @param env - the environment to read override keys from.
 * @returns the overridden configuration (the input is not mutated).
 */
export function applyEnvOverrides(config: DesktopConfig, env: NodeJS.ProcessEnv): DesktopConfig {
  const serverUrl = env[ENV.serverUrl]
  const serverCommand = env[ENV.serverCommand]
  const serverSpawn = env[ENV.serverSpawn]
  const closeToTray = env[ENV.closeToTray]
  if (serverUrl !== undefined && serverUrl !== '') validateServerUrl(serverUrl)
  return {
    server: {
      ...config.server,
      ...serverUrl !== undefined && serverUrl !== '' && { url: serverUrl },
      ...serverCommand !== undefined && { command: serverCommand === '' ? null : serverCommand },
      ...serverSpawn !== undefined && serverSpawn !== '' && { spawn: parseSwitch(ENV.serverSpawn, serverSpawn) },
    },
    window: {
      ...config.window,
      ...closeToTray !== undefined && closeToTray !== '' && { closeToTray: parseSwitch(ENV.closeToTray, closeToTray) },
    },
  }
}

/**
 * Validate that a server URL is a plain-http loopback address: the shell may
 * only ever talk to the machine-local harness it supervises.
 * @param url - the URL to validate.
 */
export function validateServerUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ConfigError(`settings.json: server.url 不是合法的 URL: ${JSON.stringify(url)}`)
  }
  if (parsed.protocol !== 'http:') {
    throw new ConfigError(`settings.json: server.url 只允许 http 协议，收到 ${JSON.stringify(parsed.protocol)}`)
  }
  if (!LOOPBACK_HOSTS.includes(parsed.hostname)) {
    throw new ConfigError(`settings.json: server.url 只允许本机回环地址，收到 ${JSON.stringify(parsed.hostname)}`)
  }
}

function section(value: unknown, key: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(`settings.json: ${key} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function stringField(record: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new ConfigError(`settings.json: ${label} 必须是字符串`)
  return value
}

function booleanField(record: Record<string, unknown>, key: string, label: string): boolean | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new ConfigError(`settings.json: ${label} 必须是布尔值`)
  return value
}

function positiveIntField(record: Record<string, unknown>, key: string, label: string): number | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`settings.json: ${label} 必须是正整数`)
  }
  return value
}

function windowSize(record: Record<string, unknown>, key: string, label: string, min: number): number | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new ConfigError(`settings.json: ${label} 必须是至少 ${min} 的整数`)
  }
  return value
}

function parseSwitch(key: string, value: string): boolean {
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  throw new ConfigError(`${key} 必须是 '0'/'1'/'true'/'false'，收到 ${JSON.stringify(value)}`)
}
