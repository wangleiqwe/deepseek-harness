import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultBounds,
  loadWindowState,
  saveWindowState,
  visibleBounds,
  type DisplayWorkArea,
} from '../src/window-state.ts'

const PRIMARY: DisplayWorkArea = { x: 0, y: 0, width: 1920, height: 1040 }
let sandbox: string

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'dsh-desktop-state-'))
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

describe('defaultBounds', () => {
  it('carries size only, leaving position to the window manager', () => {
    expect(defaultBounds(1280, 800)).toEqual({ width: 1280, height: 800 })
  })
})

describe('visibleBounds', () => {
  it('keeps bounds that still show enough area', () => {
    // 220px of the window stays on the primary work area (right edge 1700+400 > 1920).
    const bounds = { x: 1700, y: 100, width: 400, height: 300 }
    expect(visibleBounds(bounds, [PRIMARY])).toBe(bounds)
  })

  it('moves fully off-screen bounds onto the primary work area, centered', () => {
    expect(visibleBounds({ x: 5000, y: 5000, width: 800, height: 600 }, [PRIMARY])).toEqual({
      x: 560,
      y: 220,
      width: 800,
      height: 600,
    })
  })

  it('clamps oversized bounds to the primary work area', () => {
    expect(visibleBounds({ x: 5000, y: 5000, width: 4000, height: 3000 }, [PRIMARY])).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1040,
    })
  })

  it('keeps bounds unchanged with no displays attached', () => {
    const bounds = { x: 10, y: 20, width: 800, height: 600 }
    expect(visibleBounds(bounds, [])).toBe(bounds)
  })
})

describe('window state file', () => {
  it('round-trips saved bounds', () => {
    const path = join(sandbox, 'state', 'window-state.json')
    saveWindowState(path, { x: 12, y: 34, width: 900, height: 700 })
    expect(loadWindowState(path)).toEqual({ x: 12, y: 34, width: 900, height: 700 })
  })

  it('round-trips position-less bounds', () => {
    const path = join(sandbox, 'window-state.json')
    saveWindowState(path, { width: 800, height: 600 })
    expect(loadWindowState(path)).toEqual({ width: 800, height: 600 })
  })

  it('falls back for a missing file', () => {
    expect(loadWindowState(join(sandbox, 'missing.json'))).toBeUndefined()
  })

  it('falls back for corrupt or structurally invalid files', () => {
    const corrupt = join(sandbox, 'corrupt.json')
    writeFileSync(corrupt, '{oops')
    expect(loadWindowState(corrupt)).toBeUndefined()
    const wrong = join(sandbox, 'wrong.json')
    writeFileSync(wrong, JSON.stringify({ width: 'wide', height: 600 }))
    expect(loadWindowState(wrong)).toBeUndefined()
    writeFileSync(wrong, JSON.stringify([1, 2, 3]))
    expect(loadWindowState(wrong)).toBeUndefined()
  })
})

describe('saved file bytes', () => {
  it('writes one JSON object per line', () => {
    const path = join(sandbox, 'window-state.json')
    saveWindowState(path, { x: 1, y: 2, width: 3, height: 4 })
    expect(readFileSync(path, 'utf8')).toBe('{"x":1,"y":2,"width":3,"height":4}')
  })
})
