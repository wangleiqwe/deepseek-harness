import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ASSETS_DIR = fileURLToPath(new URL('../assets', import.meta.url))
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** PNG dimensions from the IHDR chunk (big-endian, right after the 8-byte signature). */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path)
  expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('committed icon assets', () => {
  it('ships the whale mark at the window and builder sizes', () => {
    expect(pngSize(`${ASSETS_DIR}/icon-256.png`)).toEqual({ width: 256, height: 256 })
    expect(pngSize(`${ASSETS_DIR}/icon-512.png`)).toEqual({ width: 512, height: 512 })
    expect(pngSize(`${ASSETS_DIR}/icon-16.png`)).toEqual({ width: 16, height: 16 })
  })

  it('ships white tray variants that differ from the black mark', () => {
    expect(pngSize(`${ASSETS_DIR}/tray-16.png`)).toEqual({ width: 16, height: 16 })
    expect(pngSize(`${ASSETS_DIR}/tray-32.png`)).toEqual({ width: 32, height: 32 })
    expect(readFileSync(`${ASSETS_DIR}/tray-16.png`)).not.toEqual(readFileSync(`${ASSETS_DIR}/icon-16.png`))
  })
})
