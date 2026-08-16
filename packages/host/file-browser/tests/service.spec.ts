/**
 * Host file-browser seam tests: registration, bounded breadth-first walk
 * semantics (file/directory rows, depth, count, skip rules, ordering), the
 * one-level listing primitive, abort racing, and typed failure mapping. Files
 * are materialized under a temporary directory, so the suite replays on every
 * host.
 */

import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  FileBrowserError, LocalFileBrowser, type Config, type FileListing,
} from '../src/index.ts'

/** One materialized fixture tree under a fresh temp root. */
async function materialize(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-browser-'))
  await mkdir(join(root, 'src', 'client'), { recursive: true })
  await mkdir(join(root, 'src', 'host'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'dep'), { recursive: true })
  await mkdir(join(root, '.git', 'objects'), { recursive: true })
  await writeFile(join(root, 'package.json'), '{}')
  await writeFile(join(root, 'src', 'index.ts'), '')
  await writeFile(join(root, 'src', 'client', 'a.ts'), '')
  await writeFile(join(root, 'src', 'client', 'b.ts'), '')
  await writeFile(join(root, 'src', 'host', 'c.ts'), '')
  await writeFile(join(root, 'node_modules', 'dep', 'index.js'), '')
  await writeFile(join(root, '.git', 'objects', 'pack'), '')
  await writeFile(join(root, '.env'), '')
  return root
}

/** Boot one file-browser context with the given config overrides. */
async function boot(config: Partial<Config> = {}): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context()
  const fiber = ctx.plugin(LocalFileBrowser, {
    maxFiles: 500,
    maxDirs: 200,
    maxDepth: 6,
    skipDirs: ['node_modules', '.git'],
    skipHidden: true,
    ...config,
  })
  await fiber.await()
  return { ctx, dispose: () => fiber.dispose() }
}

/** rel paths of a listing, in listing order. */
function rels(listing: FileListing): string[] {
  return listing.files.map(file => file.rel)
}

describe('LocalFileBrowser.listFiles', () => {
  let root: string

  beforeEach(async () => {
    root = await materialize()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists files and directories breadth-first with skip rules applied by default', async () => {
    const { ctx, dispose } = await boot()
    const listing = await ctx.fileBrowser.listFiles(root)
    await dispose()
    // node_modules/.git/.env omitted; breadth-first: root rows, then the src
    // level, then the depth-2 rows — within each level, name-sorted rows
    // interleave directories and files.
    expect(rels(listing)).toEqual([
      'package.json',
      'src',
      'src/client',
      'src/host',
      'src/index.ts',
      'src/client/a.ts',
      'src/client/b.ts',
      'src/host/c.ts',
    ])
    expect(listing.files.find(f => f.rel === 'src/client')?.kind).toBe('directory')
    expect(listing.files.find(f => f.rel === 'package.json')?.kind).toBe('file')
    expect(listing.truncated).toBe(false)
    expect(listing.root).toBe(root)
    for (const file of listing.files) {
      expect(file.path).toBe(join(root, ...file.rel.split('/')))
      expect(file.rel).not.toContain('\\')
      expect(file.name).toBe(file.rel.split('/').at(-1))
    }
  })

  it('descends into skip-listed and hidden directories when configured to', async () => {
    const { ctx, dispose } = await boot({ skipDirs: [], skipHidden: false })
    const listing = await ctx.fileBrowser.listFiles(root)
    await dispose()
    expect(rels(listing)).toEqual([
      '.env',
      '.git',
      'node_modules',
      'package.json',
      'src',
      '.git/objects',
      'node_modules/dep',
      'src/client',
      'src/host',
      'src/index.ts',
      '.git/objects/pack',
      'node_modules/dep/index.js',
      'src/client/a.ts',
      'src/client/b.ts',
      'src/host/c.ts',
    ])
    expect(listing.files.find(f => f.rel === '.git')?.kind).toBe('directory')
  })

  it('bounds the walk by maxDepth', async () => {
    const { ctx, dispose } = await boot({ maxDepth: 2 })
    const listing = await ctx.fileBrowser.listFiles(root)
    await dispose()
    expect(rels(listing)).toEqual([
      'package.json',
      'src',
      'src/client',
      'src/host',
      'src/index.ts',
      'src/client/a.ts',
      'src/client/b.ts',
      'src/host/c.ts',
    ])
    // maxDepth 1 emits root rows and depth-1 rows (dirs included), but never
    // descends into depth-2 directories.
    const shallow = await boot({ maxDepth: 1 })
    const listing1 = await shallow.ctx.fileBrowser.listFiles(root)
    await shallow.dispose()
    expect(rels(listing1)).toEqual(['package.json', 'src', 'src/client', 'src/host', 'src/index.ts'])
  })

  it('truncates at maxFiles and flags the cut', async () => {
    const { ctx, dispose } = await boot({ maxFiles: 3 })
    const listing = await ctx.fileBrowser.listFiles(root)
    await dispose()
    // Three file rows are allowed; directory rows are unbounded by maxFiles,
    // so the cut lands mid-level at the fourth file row.
    expect(listing.files).toHaveLength(6)
    expect(listing.truncated).toBe(true)
    // Breadth-first: the shallowest rows win.
    expect(rels(listing)).toEqual(['package.json', 'src', 'src/client', 'src/host', 'src/index.ts', 'src/client/a.ts'])
  })

  it('truncates at maxDirs and flags the cut', async () => {
    const { ctx, dispose } = await boot({ maxDirs: 2 })
    const listing = await ctx.fileBrowser.listFiles(root)
    await dispose()
    expect(listing.files.filter(f => f.kind === 'directory')).toHaveLength(2)
    expect(listing.truncated).toBe(true)
    // The third directory row (src/host) crosses the bound mid-level.
    expect(rels(listing)).toEqual(['package.json', 'src', 'src/client'])
  })

  it('skips symlinked entries entirely (no cycle or escape)', async () => {
    const linkTarget = await mkdtemp(join(tmpdir(), 'dsh-file-browser-link-'))
    await writeFile(join(linkTarget, 'outside.ts'), '')
    // Junctions need no privileges on Windows; plain file symlinks are
    // denied there, and the file-link row only feeds the POSIX lanes' arm.
    await symlink(linkTarget, join(root, 'link-dir'), 'junction')
    try {
      await symlink(join(linkTarget, 'outside.ts'), join(root, 'link-file.ts'), 'file')
    } catch {
      // Windows denies unprivileged file symlinks; the walk skips the entry
      // on every platform, so the assertion below holds either way.
    }
    const { ctx, dispose } = await boot()
    const listing = await ctx.fileBrowser.listFiles(root)
    await dispose()
    expect(rels(listing)).toEqual([
      'package.json',
      'src',
      'src/client',
      'src/host',
      'src/index.ts',
      'src/client/a.ts',
      'src/client/b.ts',
      'src/host/c.ts',
    ])
    await rm(linkTarget, { recursive: true, force: true })
  })

  it('rejects a root that is not fully qualified', async () => {
    const { ctx, dispose } = await boot()
    await expect(ctx.fileBrowser.listFiles('relative/path')).rejects.toMatchObject({
      name: 'FileBrowserError',
      code: 'directory-unreadable',
      path: 'relative/path',
    } satisfies Partial<FileBrowserError>)
    await dispose()
  })

  it('rejects a missing or unreadable root', async () => {
    const { ctx, dispose } = await boot()
    const missing = join(root, 'missing')
    await expect(ctx.fileBrowser.listFiles(missing)).rejects.toMatchObject({
      name: 'FileBrowserError',
      code: 'directory-unreadable',
      path: missing,
    } satisfies Partial<FileBrowserError>)
    await dispose()
  })

  it('rejects with the abort reason when the caller aborts', async () => {
    const { ctx, dispose } = await boot()
    const controller = new AbortController()
    controller.abort(new Error('caller left'))
    await expect(ctx.fileBrowser.listFiles(root, controller.signal)).rejects.toThrow('caller left')
    await dispose()
  })
})

describe('LocalFileBrowser.listLevel', () => {
  let root: string

  beforeEach(async () => {
    root = await materialize()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists one level with files and directories, name-sorted, skip rules applied', async () => {
    const linkTarget = await mkdtemp(join(tmpdir(), 'dsh-file-browser-level-link-'))
    // Symlinked entries are skipped by a level listing too; junctions need no
    // privileges on Windows.
    await symlink(linkTarget, join(root, 'link-dir'), 'junction')
    const { ctx, dispose } = await boot()
    const level = await ctx.fileBrowser.listLevel(root)
    await dispose()
    expect(level.path).toBe(root)
    expect(level.entries).toEqual([
      { name: 'package.json', path: join(root, 'package.json'), kind: 'file', hidden: false },
      { name: 'src', path: join(root, 'src'), kind: 'directory', hidden: false },
    ])
    expect(level.truncated).toBe(false)
    await rm(linkTarget, { recursive: true, force: true })
  })

  it('lists a nested level and keeps hidden entries when configured to', async () => {
    const { ctx, dispose } = await boot({ skipHidden: false })
    const src = await ctx.fileBrowser.listLevel(join(root, 'src'))
    await dispose()
    expect(src.entries.map(entry => entry.name)).toEqual(['client', 'host', 'index.ts'])
    expect(src.entries.find(entry => entry.name === '.env')).toBeUndefined()
    const visible = await boot()
    const rootLevel = await visible.ctx.fileBrowser.listLevel(root)
    await visible.dispose()
    expect(rootLevel.entries.find(entry => entry.name === '.env')).toBeUndefined()
  })

  it('truncates a level at maxFiles and flags the cut', async () => {
    const { ctx, dispose } = await boot({ maxFiles: 2 })
    const level = await ctx.fileBrowser.listLevel(root)
    await dispose()
    expect(level.entries).toHaveLength(2)
    expect(level.truncated).toBe(true)
  })

  it('rejects a non-qualified or missing path', async () => {
    const { ctx, dispose } = await boot()
    await expect(ctx.fileBrowser.listLevel('relative')).rejects.toMatchObject({
      name: 'FileBrowserError',
      code: 'directory-unreadable',
    } satisfies Partial<FileBrowserError>)
    await expect(ctx.fileBrowser.listLevel(join(root, 'nope'))).rejects.toMatchObject({
      name: 'FileBrowserError',
      code: 'directory-unreadable',
    } satisfies Partial<FileBrowserError>)
    await dispose()
  })

  it('rejects with the abort reason when the caller aborts', async () => {
    const { ctx, dispose } = await boot()
    const controller = new AbortController()
    controller.abort(new Error('caller left'))
    await expect(ctx.fileBrowser.listLevel(root, controller.signal)).rejects.toThrow('caller left')
    await dispose()
  })
})
