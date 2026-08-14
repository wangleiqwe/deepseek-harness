/**
 * Repository-checkout detection: the shell prefers to start the server through
 * the checkout's own source launch (`node --import tsx/esm apps/cli/src/bin.ts web`)
 * so a developer run and a packaged run behave identically. Pure Node module.
 * @module @deepseek-ai/dsh-desktop/repo
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** The package name that marks the deepseek-harness repository root. */
export const REPO_ROOT_MANIFEST_NAME = '@deepseek-ai/dsh-root'

/**
 * Walk up from `startDir` to the nearest package.json declaring
 * {@link REPO_ROOT_MANIFEST_NAME}.
 * @param startDir - the directory to start the upward walk from.
 * @returns the repository root directory, or undefined when none is found.
 */
export function findRepoRoot(startDir: string): string | undefined {
  let dir = resolve(startDir)
  for (;;) {
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) {
      let name: unknown
      try {
        name = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }).name
      } catch {
        name = undefined
      }
      if (name === REPO_ROOT_MANIFEST_NAME) return dir
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export interface ServerSpawn {
  /** The node executable (a plain name resolved from PATH, or an absolute path). */
  command: string
  args: readonly string[]
  cwd: string
}

/**
 * Resolve the structured spawn for a checkout-local `dsh web` source launch.
 * @param startDir - the directory to detect the checkout from.
 * @param nodeExecutable - the node binary to spawn; never Electron's own process.execPath, which is not a node runtime.
 * @returns the spawn spec, or undefined outside a checkout or without the CLI source.
 */
export function resolveRepoServerSpawn(startDir: string, nodeExecutable: string): ServerSpawn | undefined {
  const root = findRepoRoot(startDir)
  if (root === undefined) return undefined
  if (!existsSync(join(root, 'apps', 'cli', 'src', 'bin.ts'))) return undefined
  return {
    command: nodeExecutable,
    args: ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web'],
    cwd: root,
  }
}
