import { describe, expect, it } from 'vitest'
import {
  applyEnvOverrides,
  ConfigError,
  defaultConfig,
  ENV,
  parseConfig,
  validateServerUrl,
} from '../src/config.ts'

// No test here mutates process.env: applyEnvOverrides is driven with explicit
// env objects, so there is nothing to restore between tests.

describe('defaultConfig', () => {
  it('targets the web profile default address with ownership and tray defaults', () => {
    expect(defaultConfig()).toEqual({
      server: {
        url: 'http://127.0.0.1:3080',
        command: null,
        spawn: true,
        stopOnQuit: true,
        readinessTimeoutMs: 60_000,
      },
      window: { width: 1280, height: 800, closeToTray: true },
    })
  })
})

describe('parseConfig', () => {
  it('returns defaults for empty input', () => {
    expect(parseConfig('')).toEqual(defaultConfig())
    expect(parseConfig('   \n')).toEqual(defaultConfig())
    expect(parseConfig('{}')).toEqual(defaultConfig())
  })

  it('applies a complete settings file', () => {
    const parsed = parseConfig(JSON.stringify({
      server: {
        url: 'http://127.0.0.1:9090',
        command: 'dsh web',
        spawn: false,
        stopOnQuit: false,
        readinessTimeoutMs: 5000,
      },
      window: { width: 1024, height: 640, closeToTray: false },
    }))
    expect(parsed).toEqual({
      server: {
        url: 'http://127.0.0.1:9090',
        command: 'dsh web',
        spawn: false,
        stopOnQuit: false,
        readinessTimeoutMs: 5000,
      },
      window: { width: 1024, height: 640, closeToTray: false },
    })
  })

  it('turns an empty command into null and ignores unknown keys', () => {
    const parsed = parseConfig(JSON.stringify({ server: { command: '' }, futureKey: true }))
    expect(parsed.server.command).toBeNull()
    expect(parsed).toMatchObject(defaultConfig())
  })

  it('fails loud on invalid JSON', () => {
    expect(() => parseConfig('{oops')).toThrow(ConfigError)
    expect(() => parseConfig('[1,2]')).toThrow(ConfigError)
    expect(() => parseConfig('null')).toThrow(ConfigError)
  })

  it('fails loud on wrong types', () => {
    expect(() => parseConfig(JSON.stringify({ server: { url: 42 } }))).toThrow(/server\.url/)
    expect(() => parseConfig(JSON.stringify({ server: { spawn: 'yes' } }))).toThrow(/spawn/)
    expect(() => parseConfig(JSON.stringify({ server: { readinessTimeoutMs: 0 } }))).toThrow(/readinessTimeoutMs/)
    expect(() => parseConfig(JSON.stringify({ window: { width: 100 } }))).toThrow(/width/)
    expect(() => parseConfig(JSON.stringify({ window: 'wide' }))).toThrow(/window/)
  })
})

describe('validateServerUrl', () => {
  it('accepts loopback http addresses', () => {
    expect(() => { validateServerUrl('http://127.0.0.1:3080') }).not.toThrow()
    expect(() => { validateServerUrl('http://localhost:9999') }).not.toThrow()
  })

  it('rejects remote hosts, https, and garbage', () => {
    expect(() => { validateServerUrl('http://evil.example:3080') }).toThrow(/回环/)
    expect(() => { validateServerUrl('https://127.0.0.1:3080') }).toThrow(/http/)
    expect(() => { validateServerUrl('not a url') }).toThrow(/URL/)
  })
})

describe('applyEnvOverrides', () => {
  it('applies valid overrides on top of a parsed file', () => {
    const overridden = applyEnvOverrides(defaultConfig(), {
      [ENV.serverUrl]: 'http://127.0.0.1:9090',
      [ENV.serverCommand]: '',
      [ENV.serverSpawn]: '0',
      [ENV.closeToTray]: 'false',
    })
    expect(overridden.server.url).toBe('http://127.0.0.1:9090')
    expect(overridden.server.command).toBeNull()
    expect(overridden.server.spawn).toBe(false)
    expect(overridden.window.closeToTray).toBe(false)
  })

  it('reads true and false switches', () => {
    expect(applyEnvOverrides(defaultConfig(), { [ENV.serverSpawn]: '1' }).server.spawn).toBe(true)
    expect(applyEnvOverrides(defaultConfig(), { [ENV.serverSpawn]: 'true' }).server.spawn).toBe(true)
    expect(applyEnvOverrides(defaultConfig(), { [ENV.closeToTray]: 'false' }).window.closeToTray).toBe(false)
  })

  it('fails loud on invalid overrides instead of skipping them', () => {
    expect(() => applyEnvOverrides(defaultConfig(), { [ENV.serverUrl]: 'http://evil.example' })).toThrow(ConfigError)
    expect(() => applyEnvOverrides(defaultConfig(), { [ENV.serverSpawn]: 'maybe' })).toThrow(/DSH_DESKTOP_SPAWN/)
  })

  it('does not mutate the input configuration', () => {
    const config = defaultConfig()
    applyEnvOverrides(config, { [ENV.serverSpawn]: '0' })
    expect(config.server.spawn).toBe(true)
  })
})
