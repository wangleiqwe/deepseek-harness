/**
 * Per-session bounded listing cache for the file-reference surfaces: one
 * shared in-flight walk per session (concurrent candidate requests coalesce),
 * then a short TTL so reopen and filter keystrokes do not re-walk the
 * workspace each time. Zero React, zero cordis — takes the client context for
 * its workspaces face only.
 */
import type { ClientContext, FileRef, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { workspaceRootFor } from './files.ts'

/** One session's bounded listing plus its fetch time (cache freshness window). */
export interface CachedListing {
  readonly files: readonly FileRef[]
  readonly truncated: boolean
  readonly at: number
}

/** How long a cached listing serves filter keystrokes before a re-walk. */
export const LIST_TTL_MS = 30_000

/** Per-session listing cache and its in-flight dedupe table. */
const listings = new Map<SessionId, CachedListing>()
const walks = new Map<SessionId, Promise<CachedListing | null>>()

/**
 * Resolve one session's bounded listing: cached within the TTL, otherwise one
 * shared in-flight walk (concurrent candidate requests coalesce).
 * @param ctx - client root context.
 * @param sessionId - session scope.
 * @returns the listing, or null when the session has no workspace root or the
 * Host listing failed (the menu renders an empty group; the picker modal
 * carries the error surface).
 */
export async function listingFor(ctx: ClientContext, sessionId: SessionId): Promise<CachedListing | null> {
  const cached = listings.get(sessionId)
  if (cached !== undefined && Date.now() - cached.at < LIST_TTL_MS) return cached
  const inflight = walks.get(sessionId)
  if (inflight !== undefined) return inflight
  const walk = (async (): Promise<CachedListing | null> => {
    try {
      const root = workspaceRootFor(ctx.workspaces.list.getSnapshot().items, sessionId)
      if (root === undefined) return null
      const listing = await ctx.workspaces.listFiles(root)
      const result: CachedListing = { files: listing.files, truncated: listing.truncated, at: Date.now() }
      listings.set(sessionId, result)
      return result
    } catch {
      // A failure is not cached: the next call re-walks.
      return null
    }
  })()
  walks.set(sessionId, walk)
  void walk.finally(() => { walks.delete(sessionId) })
  return walk
}
