/**
 * Window-bounds persistence and sanity clamping. Bounds are a cosmetic
 * preference, so a missing or corrupt state file falls back to defaults
 * (justified: losing them only costs a window reposition, and failing the
 * whole shell over them would be worse). Pure Node module.
 * @module @deepseek-ai/dsh-desktop/window-state
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

/** The work area of one display: bounds minus taskbars and docks. */
export interface DisplayWorkArea {
  x: number
  y: number
  width: number
  height: number
}

/** A window must show at least this much area to count as visible. */
const MIN_VISIBLE_PIXELS = 64 * 64

/**
 * The default window bounds for a fresh install: size only, so the window
 * manager picks the initial position.
 * @param width - default width.
 * @param height - default height.
 * @returns a position-less bounds record.
 */
export function defaultBounds(width: number, height: number): WindowBounds {
  return { width, height }
}

function intersectionArea(bounds: WindowBounds, area: DisplayWorkArea): number {
  const left = Math.max(bounds.x ?? 0, area.x)
  const top = Math.max(bounds.y ?? 0, area.y)
  const right = Math.min((bounds.x ?? 0) + bounds.width, area.x + area.width)
  const bottom = Math.min((bounds.y ?? 0) + bounds.height, area.y + area.height)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

/**
 * Move bounds fully off every display (a monitor was unplugged) back onto the
 * primary display's work area, centered, with size clamped to fit it. Bounds
 * that still show {@link MIN_VISIBLE_PIXELS} somewhere are kept untouched.
 * @param bounds - the persisted or default bounds.
 * @param displays - current display work areas, primary first.
 * @returns the bounds to open the window with.
 */
export function visibleBounds(bounds: WindowBounds, displays: readonly DisplayWorkArea[]): WindowBounds {
  if (displays.some(area => intersectionArea(bounds, area) >= MIN_VISIBLE_PIXELS)) return bounds
  const primary = displays[0]
  if (primary === undefined) return bounds
  const width = Math.min(bounds.width, primary.width)
  const height = Math.min(bounds.height, primary.height)
  return {
    x: primary.x + Math.floor((primary.width - width) / 2),
    y: primary.y + Math.floor((primary.height - height) / 2),
    width,
    height,
  }
}

/**
 * Persist window bounds as JSON, creating parent directories as needed.
 * @param path - the state file path.
 * @param bounds - the bounds to persist.
 */
export function saveWindowState(path: string, bounds: WindowBounds): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(bounds))
}

/**
 * Load persisted window bounds; undefined for a missing, corrupt, or
 * structurally invalid file (see the module doc for the fallback rationale).
 * @param path - the state file path.
 * @returns the persisted bounds, or undefined.
 */
export function loadWindowState(path: string): WindowBounds | undefined {
  let data: unknown
  try {
    data = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  const record = data as Record<string, unknown>
  const { width, height } = record
  if (typeof width !== 'number' || !Number.isFinite(width) || typeof height !== 'number' || !Number.isFinite(height)) {
    return undefined
  }
  const bounds: WindowBounds = { width, height }
  if (typeof record.x === 'number' && Number.isFinite(record.x)) bounds.x = record.x
  if (typeof record.y === 'number' && Number.isFinite(record.y)) bounds.y = record.y
  return bounds
}
