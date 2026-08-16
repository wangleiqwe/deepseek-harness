/**
 * Draft-write wiring for the file-reference surfaces: appends plain-text
 * `@rel` references to one session's draft through the conversation input
 * face. The read and write run in the same synchronous turn, so no keystroke
 * can interleave. Zero React — takes the client context for its sessions and
 * conversation faces only.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { appendRefs } from './files.ts'

/**
 * Append plain-text `@rel` references to one session's draft (one machine
 * transaction, one undo step).
 * @param ctx - client root context.
 * @param sessionId - session whose draft receives the references.
 * @param rels - root-relative file paths; empty rels are a no-op.
 */
export function insertRefs(ctx: ClientContext, sessionId: SessionId, rels: readonly string[]): void {
  if (rels.length === 0) return
  const actx = ctx.sessions.scope(sessionId)
  if (actx === undefined) return
  const conversation = ctx.get('conversation')
  if (conversation === undefined) return
  const input = conversation.input.for(actx)
  const { draft } = input.state.getSnapshot()
  input.setDraft(appendRefs(draft, rels))
}
