/**
 * ui-file-reference browser half: source registration (duplicate-name proof) +
 * fiber-teardown removal (HMR safety) against the real InputTriggerService,
 * then the source behavior contract driven directly on the captured source —
 * bounded workspace-listing candidates (query-filtered, workspace-less and
 * failed sessions → empty), pick → plain-text outcome (the plain-text-reference
 * decision), and warm prefetch. Direct driving is deliberate: this spec owns
 * only the source's own contract.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext, FileRef, SessionId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import { InputTriggerService } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ClientSessionContext, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'

const sid = (id: string) => id as SessionId

const file = (rel: string, kind: 'file' | 'directory' = 'file'): FileRef =>
  ({ name: rel.split('/').at(-1) as string, rel, path: `/w/${rel}`, kind })

function workspace(sessionId: SessionId): WorkspaceView {
  return {
    workspaceId: 'w1' as WorkspaceView['workspaceId'],
    path: '/w',
    title: 'w',
    sessionIds: [sessionId],
    createdAt: 't',
    updatedAt: 't',
  }
}

/** Boot the plugin over fake workspaces/sessions/conversation faces; returns the captured source. */
async function bench(sessionId: SessionId, listFiles: () => Promise<{ files: readonly FileRef[]; truncated: boolean }>) {
  const ctx = new Context()
  let captured: InputTriggerSource | undefined
  ctx.provide('inputTriggers', { registerSource: (src: InputTriggerSource) => { captured = src; return () => {} } })
  ctx.provide('workspaces', {
    list: { getSnapshot: () => ({ items: [workspace(sessionId)] }) },
    listFiles,
    listLevel: vi.fn(async () => ({ path: '/w', entries: [], truncated: false })),
  })
  // Scope + conversation faces backing the registered picker's insertRefs.
  const draft = { text: 'fix the build' }
  const actx = {} as ClientContext
  ctx.provide('sessions', { scope: (id: SessionId) => (id === sessionId ? actx : undefined) })
  ctx.provide('conversation', {
    input: {
      for: () => ({
        state: { getSnapshot: () => ({ draft: draft.text }) },
        setDraft: (text: string) => { draft.text = text },
      }),
    },
  })
  // The locale plugin's fiber waits on these three (ui-theme wiring); the
  // same provides the subagent spec carries.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { source: captured as InputTriggerSource, ctx, draft }
}

const proj = (id: string): ClientSessionContext => ({ sessionId: sid(id) })

const req = (query: string) =>
  ({ query, position: 'inline' as const, signal: new AbortController().signal })

const LISTING = { files: [file('package.json'), file('src', 'directory'), file('src/a.ts'), file('src/b.ts')], truncated: false }

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'sessions', 'workspaces', 'conversation', 'locale', 'inputTriggers'])
  })

  it('registers the "@" file source; disposal frees the name (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(InputTriggerService).await()
    ctx.provide('workspaces', { list: { getSnapshot: () => ({ items: [] }) }, listFiles: vi.fn() })
    ctx.provide('sessions', { scope: () => undefined })
    ctx.provide('conversation', { input: { for: () => { throw new Error('unused') } } })
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const inputTriggers = ctx.get('inputTriggers') as InputTriggerService
    const rival = {
      trigger: '@' as const,
      name: 'file',
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
    }
    // Live registration holds the (trigger, name) seat…
    expect(() => inputTriggers.registerSource(rival)).toThrow(/already registered/)
    // …and fiber teardown releases it.
    await fiber.dispose()
    expect(() => inputTriggers.registerSource(rival)).not.toThrow()
  })

  it('preloads the listing on warm without surfacing failures', async () => {
    const listFiles = vi.fn(async () => LISTING)
    const { source } = await bench(sid('t-warm'), listFiles)
    source.warm?.(proj('t-warm'))
    await vi.waitFor(() => { expect(listFiles).toHaveBeenCalledTimes(1) })
    const failing = vi.fn(async () => { throw new Error('boom') })
    const benchFailing = await bench(sid('t-warm-fail'), failing)
    benchFailing.source.warm?.(proj('t-warm-fail'))
    await vi.waitFor(() => { expect(failing).toHaveBeenCalledTimes(1) })
  })
})

describe('file source contract', () => {
  it('candidates return the workspace listing filtered by the query, one walk per window', async () => {
    const listFiles = vi.fn(async () => LISTING)
    const { source } = await bench(sid('t-1'), listFiles)
    const all = await source.candidates(proj('t-1'), req(''))
    expect(all.map(c => c.name)).toEqual(['package.json', 'src/', 'src/a.ts', 'src/b.ts'])
    // Directory rows carry a folder glyph; file rows a document glyph.
    expect(all.map(c => c.icon)).toEqual(['📄', '📁', '📄', '📄'])
    const filtered = await source.candidates(proj('t-1'), req('SRC/A'))
    expect(filtered.map(c => c.name)).toEqual(['src/a.ts'])
    // The TTL cache serves the second request.
    expect(listFiles).toHaveBeenCalledTimes(1)
  })

  it('candidates return an empty group for a session without a workspace', async () => {
    const listFiles = vi.fn()
    const { source } = await bench(sid('t-2'), listFiles)
    expect(await source.candidates(proj('t-orphan'), req(''))).toEqual([])
    expect(listFiles).not.toHaveBeenCalled()
  })

  it('candidates return an empty group when the host listing fails', async () => {
    const listFiles = vi.fn(async () => { throw new Error('boom') })
    const { source } = await bench(sid('t-3'), listFiles)
    expect(await source.candidates(proj('t-3'), req(''))).toEqual([])
  })

  it('pick returns the plain-text reference with a trailing space', async () => {
    const { source } = await bench(sid('t-4'), vi.fn(async () => LISTING))
    const outcome = source.onPick({
      candidate: { name: 'src/a.ts' },
      session: proj('t-4'),
      position: 'inline',
      via: 'menu',
      span: { start: 0, end: 8, draftRev: 1 },
    })
    expect(outcome).toEqual({ text: '@src/a.ts ' })
  })

  it('registers the picker seat whose face lists levels and appends references to the draft', async () => {
    const listFiles = vi.fn(async () => LISTING)
    const { ctx, draft } = await bench(sid('t-5'), listFiles)
    const entry = ctx.slots.entries('conversation.input.left')[0]
    interface PickerFace {
      listLevel: (path: string, signal?: AbortSignal) => Promise<unknown>
      insertRefs: (sessionId: SessionId, refs: readonly string[]) => void
    }
    const face = entry?.inject?.() as unknown as PickerFace
    await expect(face.listLevel('/w')).resolves.toEqual({ path: '/w', entries: [], truncated: false })
    face.insertRefs(sid('t-5'), ['src/a.ts', 'b.ts'])
    expect(draft.text).toBe('fix the build @src/a.ts @b.ts')
    // Unknown sessions resolve no scope: the write is a no-op.
    face.insertRefs(sid('t-ghost'), ['a.ts'])
    expect(draft.text).toBe('fix the build @src/a.ts @b.ts')
  })
})
