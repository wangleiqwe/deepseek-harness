import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findRepoRoot, REPO_ROOT_MANIFEST_NAME, resolveRepoServerSpawn } from '../src/repo.ts'

let sandbox: string

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'dsh-desktop-repo-'))
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

function makeCheckout(): string {
  const root = join(sandbox, 'checkout')
  mkdirSync(join(root, 'apps', 'cli', 'src'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: REPO_ROOT_MANIFEST_NAME }))
  writeFileSync(join(root, 'apps', 'cli', 'src', 'bin.ts'), 'export {}\n')
  return root
}

describe('findRepoRoot', () => {
  it('finds the checkout root from a nested directory', () => {
    const root = makeCheckout()
    const nested = join(root, 'apps', 'desktop', 'out')
    mkdirSync(nested, { recursive: true })
    expect(findRepoRoot(nested)).toBe(root)
  })

  it('returns undefined outside any checkout', () => {
    expect(findRepoRoot(sandbox)).toBeUndefined()
  })

  it('skips unreadable manifests instead of crashing', () => {
    const root = makeCheckout()
    const broken = join(sandbox, 'broken')
    mkdirSync(broken, { recursive: true })
    writeFileSync(join(broken, 'package.json'), '{not json')
    expect(findRepoRoot(join(broken, 'deeper'))).toBeUndefined()
    expect(findRepoRoot(root)).toBe(root)
  })
})

describe('resolveRepoServerSpawn', () => {
  it('resolves the checkout-local source launch', () => {
    const root = makeCheckout()
    expect(resolveRepoServerSpawn(join(root, 'apps', 'desktop'), 'node')).toEqual({
      command: 'node',
      args: ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web'],
      cwd: root,
    })
  })

  it('returns undefined when the CLI source is missing', () => {
    const root = makeCheckout()
    rmSync(join(root, 'apps', 'cli', 'src', 'bin.ts'))
    expect(resolveRepoServerSpawn(root, 'node')).toBeUndefined()
  })
})
