/**
 * File-reference pure core: workspace-root resolution, candidate filtering,
 * and reference-text assembly.
 */
import { describe, expect, it } from 'vitest'
import type { FileRef, SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import {
  appendRefs, filterFileCandidates, pickRefText, refsText, relOrAbsolute, workspaceRootFor,
} from '../src/client/files.ts'

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

function workspace(partial: Partial<Omit<WorkspaceView, 'workspaceId' | 'path'>> & { workspaceId: string; path: string }): WorkspaceView {
  const { workspaceId, path, ...rest } = partial
  return {
    workspaceId: wid(workspaceId),
    title: path,
    path,
    sessionIds: [],
    createdAt: 't',
    updatedAt: 't',
    ...rest,
  }
}

const file = (rel: string, kind: 'file' | 'directory' = 'file'): FileRef =>
  ({ name: rel.split('/').at(-1) as string, rel, path: `/w/${rel}`, kind })

const FILES: readonly FileRef[] = [
  file('package.json'),
  file('src/index.ts'),
  file('src/client/a.ts'),
  file('README.md'),
]

describe('workspaceRootFor', () => {
  it('resolves the workspace owning the session', () => {
    const workspaces = [
      workspace({ workspaceId: 'w1', path: '/one', sessionIds: [sid('a')] }),
      workspace({ workspaceId: 'w2', path: '/two', sessionIds: [sid('b'), sid('c')] }),
    ]
    expect(workspaceRootFor(workspaces, sid('c'))).toBe('/two')
    expect(workspaceRootFor(workspaces, sid('a'))).toBe('/one')
  })

  it('returns undefined for an ungrouped session', () => {
    const workspaces = [workspace({ workspaceId: 'w1', path: '/one', sessionIds: [sid('a')] })]
    expect(workspaceRootFor(workspaces, sid('nobody'))).toBeUndefined()
    expect(workspaceRootFor([], sid('nobody'))).toBeUndefined()
  })
})

describe('filterFileCandidates', () => {
  it('returns everything for a blank query and preserves listing order', () => {
    expect(filterFileCandidates(FILES, '')).toBe(FILES)
    expect(filterFileCandidates(FILES, '   ')).toBe(FILES)
  })

  it('matches case-insensitively on the root-relative path and the base name', () => {
    expect(filterFileCandidates(FILES, 'SRC/INDEX').map(f => f.rel)).toEqual(['src/index.ts'])
    expect(filterFileCandidates(FILES, 'client').map(f => f.rel)).toEqual(['src/client/a.ts'])
    expect(filterFileCandidates(FILES, 'README').map(f => f.rel)).toEqual(['README.md'])
  })

  it('returns nothing when no row matches', () => {
    expect(filterFileCandidates(FILES, 'zzz')).toEqual([])
  })
})

describe('relOrAbsolute', () => {
  it('spells rows under the root as root-relative references', () => {
    expect(relOrAbsolute('/w/src/a.ts', '/w')).toBe('src/a.ts')
    expect(relOrAbsolute('/w/package.json', '/w')).toBe('package.json')
    // A root with a trailing separator still matches (no doubled separator).
    expect(relOrAbsolute('/w/src/a.ts', '/w/')).toBe('src/a.ts')
  })

  it('keeps rows outside the root as absolute references', () => {
    expect(relOrAbsolute('/other/a.ts', '/w')).toBe('/other/a.ts')
    // A sibling of the root is not under it.
    expect(relOrAbsolute('/w-other/a.ts', '/w')).toBe('/w-other/a.ts')
  })

  it("matches a Windows host's backslash paths and normalizes to forward slashes", () => {
    expect(relOrAbsolute('C:\\w\\src\\a.ts', 'C:\\w')).toBe('src/a.ts')
    expect(relOrAbsolute('C:\\other\\a.ts', 'C:\\w')).toBe('C:/other/a.ts')
  })

  it('does not treat the root itself as inside its own prefix', () => {
    expect(relOrAbsolute('/w', '/w')).toBe('/w')
  })
})

describe('pickRefText / refsText / appendRefs', () => {
  it('closes the trigger token with a trailing space', () => {
    expect(pickRefText('src/a.ts')).toBe('@src/a.ts ')
  })

  it('joins multi-select references with single spaces', () => {
    expect(refsText([])).toBe('')
    expect(refsText(['a.ts', 'b/c.ts'])).toBe('@a.ts @b/c.ts')
  })

  it('appends to an empty draft and spaces off a non-empty one', () => {
    expect(appendRefs('', ['a.ts'])).toBe('@a.ts')
    expect(appendRefs('fix the build', ['a.ts', 'b.ts'])).toBe('fix the build @a.ts @b.ts')
  })

  it('does not double-space after trailing whitespace', () => {
    expect(appendRefs('fix it ', ['a.ts'])).toBe('fix it @a.ts')
    expect(appendRefs('fix it\n', ['a.ts'])).toBe('fix it\n@a.ts')
  })

  it('returns the draft unchanged for empty rels', () => {
    expect(appendRefs('draft', [])).toBe('draft')
  })
})
