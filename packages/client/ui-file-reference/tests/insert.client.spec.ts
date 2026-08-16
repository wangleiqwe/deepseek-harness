/**
 * Draft-write wiring: appends the picked references through the conversation
 * input face with single-space separation; no-ops when there is nothing to
 * insert, the session scope is gone, or the conversation service is absent.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { insertRefs } from '../src/client/insert.ts'

const sid = (id: string) => id as SessionId

/** Fake scope + conversation faces over one mutable draft. */
function bench(scopeFor: (id: SessionId) => ClientContext | undefined) {
  const drafts = new Map<SessionId, string>([[sid('s1'), 'fix the build']])
  const input = {
    state: { getSnapshot: () => ({ draft: drafts.get(sid('s1')) as string }) },
    setDraft: (text: string) => { drafts.set(sid('s1'), text) },
  }
  const conversation = { input: { for: () => input } } as unknown as IConversation
  const ctx = {
    sessions: { scope: scopeFor },
    get: (name: string) => (name === 'conversation' ? conversation : undefined),
  } as unknown as ClientContext
  return { ctx, drafts, input }
}

describe('insertRefs', () => {
  it('appends the references to the draft with one space of separation', () => {
    const actx = {} as ClientContext
    const { ctx, drafts } = bench(() => actx)
    insertRefs(ctx, sid('s1'), ['src/a.ts', 'b.ts'])
    expect(drafts.get(sid('s1'))).toBe('fix the build @src/a.ts @b.ts')
  })

  it('no-ops on empty rels (no draft write)', () => {
    const actx = {} as ClientContext
    const { ctx, drafts, input } = bench(() => actx)
    const setDraft = vi.spyOn(input, 'setDraft')
    insertRefs(ctx, sid('s1'), [])
    expect(setDraft).not.toHaveBeenCalled()
    expect(drafts.get(sid('s1'))).toBe('fix the build')
  })

  it('no-ops when the session scope is gone', () => {
    const { ctx, drafts, input } = bench(() => undefined)
    const setDraft = vi.spyOn(input, 'setDraft')
    insertRefs(ctx, sid('s1'), ['a.ts'])
    expect(setDraft).not.toHaveBeenCalled()
    expect(drafts.get(sid('s1'))).toBe('fix the build')
  })

  it('no-ops when the conversation service is absent', () => {
    const actx = {} as ClientContext
    const { ctx, drafts, input } = bench(() => actx)
    ctx.get = () => undefined
    const setDraft = vi.spyOn(input, 'setDraft')
    insertRefs(ctx, sid('s1'), ['a.ts'])
    expect(setDraft).not.toHaveBeenCalled()
    expect(drafts.get(sid('s1'))).toBe('fix the build')
  })
})
