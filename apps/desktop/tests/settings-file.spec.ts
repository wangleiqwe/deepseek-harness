import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigError, ENV } from '../src/config.ts'
import { loadDesktopConfig } from '../src/settings-file.ts'

let sandbox: string

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'dsh-desktop-settings-'))
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

describe('loadDesktopConfig', () => {
  it('returns defaults for a missing file', () => {
    const config = loadDesktopConfig(join(sandbox, 'settings.json'), {})
    expect(config.server.url).toBe('http://127.0.0.1:3080')
    expect(config.window.closeToTray).toBe(true)
  })

  it('reads a valid settings file', () => {
    const path = join(sandbox, 'settings.json')
    writeFileSync(path, JSON.stringify({ server: { url: 'http://127.0.0.1:9090' }, window: { width: 900 } }))
    const config = loadDesktopConfig(path, {})
    expect(config.server.url).toBe('http://127.0.0.1:9090')
    expect(config.window.width).toBe(900)
    expect(config.window.height).toBe(800)
  })

  it('fails loud on an invalid file', () => {
    const path = join(sandbox, 'settings.json')
    writeFileSync(path, '{oops')
    expect(() => loadDesktopConfig(path, {})).toThrow(ConfigError)
  })

  it('lets environment overrides win over the file', () => {
    const path = join(sandbox, 'settings.json')
    writeFileSync(path, JSON.stringify({ server: { spawn: true } }))
    const config = loadDesktopConfig(path, { [ENV.serverSpawn]: '0' })
    expect(config.server.spawn).toBe(false)
  })
})
