/** Package-owned caption-durability invariants. @module @deepseek-ai/dsh-image-caption/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { CAPTION_PREFIX } from './caption.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-image-caption'

/** Cordis companion plugin name. */
export const name = 'image-caption-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one user message against the package's durable relation: a message
 * that carries a caption must not retain its image block — the transform
 * replaces, never augments. Messages without the caption prefix (other
 * presets, sessions that never mounted the plugin) are outside the relation.
 * @param event - the durable user message.
 * @param fail - the invariant failure sink.
 */
function validateMessage(event: SessionEvent<'user/message'>, fail: InvariantFailure): void {
  const captioned = event.data.content.some(
    block => block.type === 'text' && block.text.startsWith(CAPTION_PREFIX),
  )
  if (!captioned) return
  if (event.data.content.some(block => block.type === 'image')) {
    fail('a captioned user message must not retain its image block: the transform replaces, never augments')
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate all package-owned messages already present in one session. */
function validateSession(session: Session, fail: InvariantFailure): void {
  for (const event of session.events) {
    if (event.type !== 'user/message') continue
    validateMessage(event, fail)
  }
}

/** Install validation for loaded and newly appended user messages. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSession(session, fail)
  ctx.on('session/created', (session) => { validateSession(session, fail) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    if (event.type !== 'user/message') return
    validateMessage(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the image-caption invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
