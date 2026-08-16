/**
 * Listing cache semantics: TTL freshness, in-flight coalescing, no-workspace
 * and failure → null, and re-walk after expiry. The workspaces face is faked
 * per bench; time is faked to drive the TTL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientContext, FileRef, SessionId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import { listingFor, LIST_TTL_MS } from '../src/client/listings.ts'

const sid = (id: string) => id as SessionId

const file = (rel: string): FileRef => ({ name: rel.split('/').at(-1) as string, rel, path: `/w/${rel}`, kind: 'file' })

/** Fake workspaces face over a scripted listing. */
function workspacesWith(
  items: readonly WorkspaceView[],
  listFiles: (path: string) => Promise<{ files: readonly FileRef[]; truncated: boolean }>,
) {
  return {
    list: { getSnapshot: () => ({ items }) },
    listFiles,
  }
}

/** Minimal client-context-shaped object; the functions only read the workspaces face. */
function contextWith(workspaces: unknown): ClientContext {
  return { workspaces } as unknown as ClientContext
}

const WORKSPACE = {
  workspaceId: 'w1' as WorkspaceView['workspaceId'],
  path: '/w',
  title: 'w',
  // Every non-orphan test session belongs to the workspace; 'l-orphan' does not.
  sessionIds: [sid('l1'), sid('l2'), sid('l3'), sid('l5')],
  createdAt: 't',
  updatedAt: 't',
}

describe('listingFor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('walks once and serves the cached listing within the TTL', async () => {
    const listFiles = vi.fn(async () => ({ files: [file('a.ts')], truncated: false }))
    const ctx = contextWith(workspacesWith([WORKSPACE], listFiles))
    const first = await listingFor(ctx, sid('l1'))
    const second = await listingFor(ctx, sid('l1'))
    expect(first?.files).toEqual([file('a.ts')])
    expect(second?.files).toEqual([file('a.ts')])
    expect(listFiles).toHaveBeenCalledTimes(1)
    expect(listFiles).toHaveBeenCalledWith('/w')
  })

  it('re-walks after the TTL expires', async () => {
    const listFiles = vi.fn(async () => ({ files: [file('a.ts')], truncated: false }))
    const ctx = contextWith(workspacesWith([WORKSPACE], listFiles))
    await listingFor(ctx, sid('l2'))
    await vi.advanceTimersByTimeAsync(LIST_TTL_MS)
    await listingFor(ctx, sid('l2'))
    expect(listFiles).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent walks into one RPC', async () => {
    let resolve: ((value: { files: readonly FileRef[]; truncated: boolean }) => void) | undefined
    const listFiles = vi.fn(() => new Promise<{ files: readonly FileRef[]; truncated: boolean }>((r) => {
      resolve = r
    }))
    const ctx = contextWith(workspacesWith([WORKSPACE], listFiles))
    const pendingA = listingFor(ctx, sid('l3'))
    const pendingB = listingFor(ctx, sid('l3'))
    resolve?.({ files: [file('a.ts')], truncated: false })
    expect((await pendingA)?.files).toEqual([file('a.ts')])
    expect((await pendingB)?.files).toEqual([file('a.ts')])
    expect(listFiles).toHaveBeenCalledTimes(1)
  })

  it('returns null for a session without a workspace root and does not call the RPC', async () => {
    const listFiles = vi.fn()
    const ctx = contextWith(workspacesWith([WORKSPACE], listFiles))
    await expect(listingFor(ctx, sid('l-orphan'))).resolves.toBeNull()
    expect(listFiles).not.toHaveBeenCalled()
  })

  it('returns null when the host listing fails, without caching the failure', async () => {
    const listFiles = vi.fn(async () => { throw new Error('boom') })
    const ctx = contextWith(workspacesWith([WORKSPACE], listFiles))
    await expect(listingFor(ctx, sid('l5'))).resolves.toBeNull()
    // A failure is not cached: the next call tries again.
    await expect(listingFor(ctx, sid('l5'))).resolves.toBeNull()
    expect(listFiles).toHaveBeenCalledTimes(2)
  })
})
