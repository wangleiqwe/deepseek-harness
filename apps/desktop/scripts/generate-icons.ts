/**
 * Rasterize the shared whale mark (apps/web/public/favicon.svg) into the PNG
 * assets the desktop shell and electron-builder consume:
 *
 * - `assets/icon-<size>.png` — black whale on transparent, for the window,
 *   taskbar, and the packaged application icon (electron-builder converts
 *   `icon-512.png` to a multi-size .ico).
 * - `assets/tray-16.png` / `tray-32.png` — the same black mark in the tray
 *   sizes; the tray renders the dark whale like every other surface.
 *
 * The PNGs are committed, so builds and tests never need sharp at runtime;
 * rerun this script (`pnpm --filter @deepseek-ai/dsh-desktop run icons`) only
 * after the favicon changes.
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const FAVICON = fileURLToPath(new URL('../../web/public/favicon.svg', import.meta.url))
const ASSETS = fileURLToPath(new URL('../assets', import.meta.url))
/** Native canvas size of the favicon; the density math below rasterizes at the exact target size. */
const FAVICON_SIZE = 50
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512] as const

await generate()

/**
 * Rasterize every icon variant. Renders each SVG at a density that resolves
 * the 50-unit canvas to exactly `size` pixels, so no raster rescale blurs the
 * mark.
 */
async function generate(): Promise<void> {
  mkdirSync(ASSETS, { recursive: true })
  const svg = readFileSync(FAVICON)
  for (const size of ICON_SIZES) {
    await sharp(svg, { density: (size * 72) / FAVICON_SIZE })
      .png()
      .toFile(join(ASSETS, `icon-${size}.png`))
  }
  for (const size of [16, 32] as const) {
    await sharp(svg, { density: (size * 72) / FAVICON_SIZE })
      .png()
      .toFile(join(ASSETS, `tray-${size}.png`))
  }
}
