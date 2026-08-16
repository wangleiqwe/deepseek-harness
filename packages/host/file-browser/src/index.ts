/**
 * Workspace file listing seam (`ctx.fileBrowser`): bounded recursive file
 * lists under one root directory plus one-level directory listings, served to
 * the web GUI's composer file references. The single shipped provider walks
 * the host filesystem through Node's stdlib; a listing is one stateless
 * bounded read — the filesystem is the authoritative state.
 * @module @deepseek-ai/dsh-host-file-browser
 */

import { opendir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  fullyQualified, raceAbort,
} from '@deepseek-ai/dsh-host-directory-picker-browse'

/** Row kind of one listing entry: a regular file or a directory. */
export type FileEntryKind = 'file' | 'directory'

/** One row of a listing: the absolute path plus its root-relative spelling. */
export interface FileRef {
  /** Base name shown in a picker row. */
  name: string
  /** Root-relative path, always forward-slash separated (the composer reference). */
  rel: string
  /** Absolute host path. */
  path: string
  /** Whether the row is a regular file or a directory. */
  kind: FileEntryKind
}

/** One bounded recursive listing under a root directory (files and directories). */
export interface FileListing {
  /** Absolute root that was listed (canonical resolve of the request). */
  root: string
  /** File and directory rows in breadth-first, name-sorted order. */
  files: FileRef[]
  /** True when the walk hit a bound and the result is incomplete. */
  truncated: boolean
}

/** One row of a one-level listing. */
export interface FileEntry {
  /** Base name shown in a browser row. */
  name: string
  /** Absolute host path. */
  path: string
  /** Whether the row is a regular file or a directory. */
  kind: FileEntryKind
  /** Hidden by the host platform's convention (dot-prefixed on POSIX). */
  hidden: boolean
}

/** One bounded one-level listing. */
export interface LevelListing {
  /** Absolute path of the listed directory (canonical resolve of the request). */
  path: string
  /** Direct child rows, name-sorted. */
  entries: FileEntry[]
  /** True when the level hit its bound and the result is incomplete. */
  truncated: boolean
}

/** Typed failure of the file-browser seam; the code matches the wire error vocabulary. */
export class FileBrowserError extends Error {
  /**
   * @param code - closed failure code (the wire `directory-unreadable` branch).
   * @param path - the root path the failure is about.
   * @param message - operator-facing description.
   */
  constructor(readonly code: 'directory-unreadable', readonly path: string, message: string) {
    super(message)
    this.name = 'FileBrowserError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fileBrowser: FileBrowser
  }
}

/**
 * Abstract file-listing service. Subclass, implement `listFiles` and
 * `listLevel`, and load the subclass as a plugin — it registers as
 * `ctx.fileBrowser` (one implementation per context; loading a second throws,
 * cordis' standard duplicate-service behavior).
 */
export abstract class FileBrowser extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fileBrowser')
  }

  /**
   * List the files and directories under one root, bounded. The root must be
   * fully qualified (a wire value must never resolve against the host cwd or,
   * on Windows, its current drive); a missing or unreadable root rejects.
   * @param root - absolute directory to list.
   * @param signal - caller lifetime; abort stops the scan and rejects with the abort reason.
   * @returns the bounded listing with root-relative rows.
   * @throws {FileBrowserError} `directory-unreadable` for a non-qualified or unreadable root.
   */
  abstract listFiles(root: string, signal?: AbortSignal): Promise<FileListing>

  /**
   * List one directory level (files and directories). Same qualification and
   * skip rules as {@link FileBrowser.listFiles}; the caller drives tree
   * navigation one level at a time.
   * @param path - absolute directory to list.
   * @param signal - caller lifetime; abort stops the scan and rejects with the abort reason.
   * @returns the level's entries, name-sorted.
   * @throws {FileBrowserError} `directory-unreadable` for a non-qualified or unreadable root.
   */
  abstract listLevel(path: string, signal?: AbortSignal): Promise<LevelListing>
}

/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one listing: at most this many file rows. */
  maxFiles: number
  /** Complete-result bound of one listing: at most this many directory rows. */
  maxDirs: number
  /** Maximum directory depth walked: the root is depth 0, its children depth 1. */
  maxDepth: number
  /** Directory base names never descended into (the walk is complete over the rest). */
  skipDirs: string[]
  /** Whether dot-prefixed entries (POSIX hidden convention) are omitted entirely. */
  skipHidden: boolean
}

/** One pending directory level in the bounded breadth-first walk. */
interface Level {
  readonly dir: string
  /** Root-relative parent spelling ('' at the root), forward-slash separated. */
  readonly relDir: string
  readonly depth: number
}

/** One streamed dirent row: the facts a listing decision needs, nothing else retained. */
interface DirentRow {
  readonly name: string
  readonly isDirectory: boolean
  readonly isSymbolicLink: boolean
}

/** The `ctx.fileBrowser` local implementation: bounded breadth-first walk over Node's stdlib. */
export class LocalFileBrowser extends FileBrowser {
  /**
   * `maxFiles` bounds the file rows of one listing and one level,
   * `maxDirs` the directory rows of one listing (a level's own bound is
   * `maxFiles`); `maxDepth` bounds the walk's reach (a deep repo cannot blow
   * the call up, only truncate); `skipDirs` and `skipHidden` keep the result
   * usable for reference picking — a workspace's `node_modules`/`.git` would
   * otherwise consume the whole bound. The walk is breadth-first, so a
   * truncating result holds the shallowest rows, which is what a picker
   * wants; `truncated` flags the cut.
   */
  static Config: z<Config> = z.object({
    maxFiles: z.natural().min(1).default(500),
    maxDirs: z.natural().min(1).default(200),
    maxDepth: z.natural().min(1).default(6),
    skipDirs: z.array(z.string()).default(['node_modules', '.git']),
    skipHidden: z.boolean().default(true),
  })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
  }

  /**
   * List the files and directories under one root, bounded. The root must be
   * fully qualified (a wire value must never resolve against the host cwd or,
   * on Windows, its current drive); a missing or unreadable root rejects.
   * @param root - absolute directory to list.
   * @param signal - caller lifetime; abort stops the scan and rejects with the abort reason.
   * @returns the bounded listing with root-relative rows.
   * @throws {FileBrowserError} `directory-unreadable` for a non-qualified or unreadable root.
   */
  async listFiles(root: string, signal?: AbortSignal): Promise<FileListing> {
    if (!fullyQualified(root)) {
      throw new FileBrowserError('directory-unreadable', root, `cannot list files under "${root}": not a fully qualified path`)
    }
    const target = resolve(root)
    const rows: FileRef[] = []
    const queue: Level[] = [{ dir: target, relDir: '', depth: 0 }]
    let fileCount = 0
    let dirCount = 0
    let truncated = false
    try {
      while (queue.length > 0) {
        signal?.throwIfAborted()
        // Breadth-first: shallow levels yield their rows before deeper ones,
        // so a bounded result holds the picker's most relevant entries.
        const level = queue.shift() as Level
        for (const row of await readLevel(level.dir, signal)) {
          signal?.throwIfAborted()
          if (row.name.startsWith('.') && this.config.skipHidden) continue
          if (row.isSymbolicLink) continue
          const path = join(level.dir, row.name)
          const rel = level.relDir === '' ? row.name : `${level.relDir}/${row.name}`
          if (row.isDirectory) {
            if (this.config.skipDirs.includes(row.name)) continue
            rows.push({ name: row.name, rel, path, kind: 'directory' })
            dirCount += 1
            if (dirCount >= this.config.maxDirs) {
              truncated = true
              break
            }
            if (level.depth >= this.config.maxDepth) continue
            queue.push({ dir: path, relDir: rel, depth: level.depth + 1 })
            continue
          }
          rows.push({ name: row.name, rel, path, kind: 'file' })
          fileCount += 1
          if (fileCount >= this.config.maxFiles) {
            truncated = true
            break
          }
        }
        if (truncated) break
      }
    } catch (error: unknown) {
      // An abort is the caller's own reason, not an unreadable directory.
      signal?.throwIfAborted()
      throw new FileBrowserError('directory-unreadable', target, `cannot list files under ${target}: ${messageOf(error)}`)
    }
    return { root: target, files: rows, truncated }
  }

  /**
   * List one directory level (files and directories). Same qualification and
   * skip rules as {@link LocalFileBrowser.listFiles}; the caller drives tree
   * navigation one level at a time.
   * @param path - absolute directory to list.
   * @param signal - caller lifetime; abort stops the scan and rejects with the abort reason.
   * @returns the level's entries, name-sorted.
   * @throws {FileBrowserError} `directory-unreadable` for a non-qualified or unreadable root.
   */
  async listLevel(path: string, signal?: AbortSignal): Promise<LevelListing> {
    if (!fullyQualified(path)) {
      throw new FileBrowserError('directory-unreadable', path, `cannot list "${path}": not a fully qualified path`)
    }
    const target = resolve(path)
    try {
      signal?.throwIfAborted()
      const dirents = await readLevel(target, signal)
      const entries: FileEntry[] = []
      let truncated = false
      for (const row of dirents) {
        signal?.throwIfAborted()
        if (row.name.startsWith('.') && this.config.skipHidden) continue
        if (row.isSymbolicLink) continue
        if (row.isDirectory && this.config.skipDirs.includes(row.name)) continue
        entries.push({
          name: row.name,
          path: join(target, row.name),
          kind: row.isDirectory ? 'directory' : 'file',
          hidden: row.name.startsWith('.'),
        })
        if (entries.length >= this.config.maxFiles) {
          truncated = true
          break
        }
      }
      return { path: target, entries, truncated }
    } catch (error: unknown) {
      // An abort is the caller's own reason, not an unreadable directory.
      signal?.throwIfAborted()
      throw new FileBrowserError('directory-unreadable', target, `cannot list ${target}: ${messageOf(error)}`)
    }
  }
}

/**
 * Stream one directory level, name-sorted. Every filesystem await races the
 * caller's signal (a stalled network filesystem must not keep a departed
 * caller's scan alive); the level's handle closes on every exit.
 * @param dir - directory to read.
 * @param signal - caller lifetime.
 * @returns the level's dirent rows in name order.
 */
async function readLevel(dir: string, signal: AbortSignal | undefined): Promise<DirentRow[]> {
  const opening = opendir(dir)
  const level = await raceAbort(opening, signal).catch((error: unknown) => {
    // The abandoned open can still mint a handle after the abort won; close it
    // so a departed caller cannot leak a descriptor. (A lost race against
    // opendir's own rejection has nothing to close, and the close's own
    // failure is swallowed — the request already returned, so a cleanup error
    // has no consumer.)
    /* v8 ignore start -- the rejected arm needs opendir to reject, which a valid directory never does. */
    void opening.then(handle => handle.close().catch(swallowCloseFailure), () => {
      // Already rejected: raceAbort surfaced or swallowed it.
    })
    /* v8 ignore stop */
    throw error
  })
  const rows: DirentRow[] = []
  try {
    for (;;) {
      const dirent = await raceAbort(level.read(), signal)
      if (dirent === null) break
      rows.push({ name: dirent.name, isDirectory: dirent.isDirectory(), isSymbolicLink: dirent.isSymbolicLink() })
    }
  } finally {
    // Manual read() never auto-closes; close on every exit. The aborted exit
    // must not await it — Node queues close behind any in-flight read, so
    // awaiting would chain the departed caller back onto the very stall the
    // abort escaped (the abandoned read's settlement is already swallowed by
    // raceAbort).
    const closing = level.close()
    /* v8 ignore next 3 -- an abort between open and close needs a stalled read; the abandoned-close arm has no observable outcome. */
    if (signal?.aborted) {
      closing.catch(swallowCloseFailure)
    } else {
      await closing
    }
  }
  rows.sort((left, right) => left.name.localeCompare(right.name))
  return rows
}

/* v8 ignore start -- a close failure of an abandoned handle has no consumer, and forcing one needs a filesystem torn down mid-request. */
/** Swallow the close failure of a handle its caller already departed. */
function swallowCloseFailure(): void {}
/* v8 ignore stop */

/** Message text of an unknown thrown value. */
function messageOf(error: unknown): string {
  /* v8 ignore next -- node:fs rejects with Error instances; the String arm only satisfies the unknown narrowing. */
  return error instanceof Error ? error.message : String(error)
}

export default LocalFileBrowser
