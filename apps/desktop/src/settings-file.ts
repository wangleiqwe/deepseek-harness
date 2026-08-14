/**
 * Settings-file loading: read, parse, and environment-override the desktop
 * configuration from the userData directory. A missing file means defaults;
 * a present but invalid file fails loud so a typo is never silently ignored.
 * @module @deepseek-ai/dsh-desktop/settings-file
 */

import { readFileSync } from 'node:fs'
import { applyEnvOverrides, parseConfig, type DesktopConfig } from './config.ts'

/**
 * Load the desktop configuration from `path`.
 * @param path - the settings.json path (inside Electron's userData directory).
 * @param env - the environment whose override keys win over the file.
 * @returns the effective configuration.
 */
export function loadDesktopConfig(path: string, env: NodeJS.ProcessEnv = process.env): DesktopConfig {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return applyEnvOverrides(parseConfig(''), env)
    throw error
  }
  return applyEnvOverrides(parseConfig(raw), env)
}
