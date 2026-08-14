import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import {
  contentHasImage,
  createUserMessage,
  LlmAdapter,
  LlmError,
  LlmRuntime,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as imageCaption from '@deepseek-ai/dsh-image-caption'
import type { Config } from '@deepseek-ai/dsh-image-caption'
import { CAPTION_PREFIX } from '../src/caption.ts'
import { IMAGE_CAPTION_SETTINGS_NAMESPACE } from '../src/config.ts'

const SIGNAL = new AbortController().signal

let sandbox: string

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'dsh-image-caption-'))
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

class ScriptedAdapter extends LlmAdapter {
  constructor(private readonly script: (options: GenerateOptions) => AsyncIterable<StreamChunk>) {
    super()
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.script(options)
  }
}

function textStream(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function imageMessage(text = 'look at this'): UserMessage {
  return createUserMessage({
    source: { kind: 'user' },
    content: [
      {
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:image-caption-unit'),
          mediaType: 'image/png',
          bytes: 4,
          width: 2,
          height: 2,
        },
      },
      { type: 'text', text },
    ],
  })
}

async function mount(config: Config, adapter?: ScriptedAdapter) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  if (adapter !== undefined) ctx.llm.registerAdapter(['caption-provider'], adapter)
  await ctx.plugin(LocalAttachmentStore, { dshHome: sandbox })
  await ctx.plugin(AgentRegistry)
  const fiber = await ctx.plugin(imageCaption, config)
  return { ctx, fiber }
}

function sessionAgent(session: Session): Agent {
  return {
    id: SessionId('agent'),
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('image-caption must rewrite the proposed batch directly') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function fire(ctx: Context, messages: UserMessage[], signal: AbortSignal = SIGNAL) {
  const session = Session.create(SessionId('session'))
  const agent = sessionAgent(session)
  return await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn: 1, step: 1, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages }),
  )
}

describe('image-caption transform', () => {
  it('replaces image blocks with captions while preserving sibling blocks and order', async () => {
    const adapter = new ScriptedAdapter(async function* () {
      yield* textStream('a whale logo')
    })
    const { ctx } = await mount({ provider: 'caption-provider', model: 'm' }, adapter)
    const message = imageMessage('and this note')
    const decision = await fire(ctx, [message])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(1)
    const blocks = decision.messages[0]!.content
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ type: 'text', text: `${CAPTION_PREFIX}a whale logo` })
    expect(blocks[1]).toEqual({ type: 'text', text: 'and this note' })
    expect(contentHasImage(blocks)).toBe(false)
  })

  it('leaves image-free decisions completely untouched', async () => {
    let calls = 0
    const adapter = new ScriptedAdapter(async function* () {
      calls += 1
      yield* textStream('never')
    })
    const { ctx } = await mount({ provider: 'caption-provider', model: 'm' }, adapter)
    const plain = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] })
    const decision = await fire(ctx, [plain])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toEqual([plain])
    expect(calls).toBe(0)
  })

  it('passes rejections through without calling the vision route', async () => {
    let calls = 0
    const adapter = new ScriptedAdapter(async function* () {
      calls += 1
      yield* textStream('never')
    })
    const { ctx } = await mount({ provider: 'caption-provider', model: 'm' }, adapter)
    const session = Session.create(SessionId('session'))
    const agent = sessionAgent(session)
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [imageMessage()], turn: 1, step: 1, signal: SIGNAL },
      () => Promise.resolve({ kind: 'reject' as const }),
    )
    expect(decision.kind).toBe('reject')
    expect(calls).toBe(0)
  })

  it('captures caption failures as a placeholder under onError placeholder', async () => {
    const adapter = new ScriptedAdapter(async function* () {
      throw new LlmError('vision boom', 'VISION_BOOM')
    })
    const { ctx } = await mount({ provider: 'caption-provider', model: 'm' }, adapter)
    const decision = await fire(ctx, [imageMessage()])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages[0]!.content[0]).toEqual({
      type: 'text',
      text: '(image recognition failed: VISION_BOOM — the attached image could not be processed; tell the user.)',
    })
  })

  it('treats an empty caption as a failure', async () => {
    const adapter = new ScriptedAdapter(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const { ctx } = await mount({ provider: 'caption-provider', model: 'm' }, adapter)
    const decision = await fire(ctx, [imageMessage()])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages[0]!.content[0]).toEqual({
      type: 'text',
      text: '(image recognition failed: EMPTY_CAPTION — the attached image could not be processed; tell the user.)',
    })
  })

  it('rethrows caption failures under onError fail', async () => {
    const adapter = new ScriptedAdapter(async function* () {
      throw new LlmError('vision boom', 'VISION_BOOM')
    })
    const { ctx } = await mount({ provider: 'caption-provider', model: 'm', onError: 'fail' }, adapter)
    await expect(fire(ctx, [imageMessage()])).rejects.toThrow('vision boom')
  })

  it('skips captioning when the step is already aborted', async () => {
    let calls = 0
    const adapter = new ScriptedAdapter(async function* () {
      calls += 1
      yield* textStream('never')
    })
    const { ctx } = await mount({ provider: 'caption-provider', model: 'm' }, adapter)
    const aborted = new AbortController()
    aborted.abort()
    const decision = await fire(ctx, [imageMessage()], aborted.signal)
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(contentHasImage(decision.messages[0]!.content)).toBe(true)
    expect(calls).toBe(0)
  })

  it('reports NO_ATTACHMENTS per image instead of failing at mount', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const adapter = new ScriptedAdapter(async function* () {
      yield* textStream('never')
    })
    ctx.llm.registerAdapter(['caption-provider'], adapter)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(imageCaption, { provider: 'caption-provider', model: 'm' })
    const decision = await fire(ctx, [imageMessage()])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages[0]!.content[0]).toEqual({
      type: 'text',
      text: '(image recognition failed: NO_ATTACHMENTS — the attached image could not be processed; tell the user.)',
    })
  })

  it('reports UNCONFIGURED per image when no vision route is named anywhere', async () => {
    const adapter = new ScriptedAdapter(async function* () {
      yield* textStream('never')
    })
    const { ctx } = await mount({}, adapter)
    const decision = await fire(ctx, [imageMessage()])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages[0]!.content[0]).toEqual({
      type: 'text',
      text: '(image recognition failed: UNCONFIGURED — the attached image could not be processed; tell the user.)',
    })
  })

  it('stands aside entirely while disabled', async () => {
    let calls = 0
    const adapter = new ScriptedAdapter(async function* () {
      calls += 1
      yield* textStream('never')
    })
    const { ctx } = await mount({ provider: 'caption-provider', model: 'm', enabled: false }, adapter)
    const decision = await fire(ctx, [imageMessage()])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(contentHasImage(decision.messages[0]!.content)).toBe(true)
    expect(calls).toBe(0)
  })

  it('stands aside when the main model route accepts images itself', async () => {
    let captionCalls = 0
    const captionAdapter = new ScriptedAdapter(async function* () {
      captionCalls += 1
      yield* textStream('never')
    })
    class VisionMainAdapter extends LlmAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
      }

      override stream(): AsyncIterable<StreamChunk> {
        return (async function* () {})()
      }
    }
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['caption-provider'], captionAdapter)
    ctx.llm.registerAdapter(['vision-main'], new VisionMainAdapter())
    await ctx.plugin(LocalAttachmentStore, { dshHome: sandbox })
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'vision-main', model: 'main-vision' })
    await ctx.plugin(imageCaption, { provider: 'caption-provider', model: 'm' })
    const decision = await fire(ctx, [imageMessage()])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(contentHasImage(decision.messages[0]!.content)).toBe(true)
    expect(captionCalls).toBe(0)
  })

  it('follows the settings namespace live: disable, then re-enable', async () => {
    let calls = 0
    const adapter = new ScriptedAdapter(async function* () {
      calls += 1
      yield* textStream('a whale')
    })
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['caption-provider'], adapter)
    await ctx.plugin(LocalAttachmentStore, { dshHome: sandbox })
    await ctx.plugin(FileSettingsProvider, { path: join(sandbox, 'settings.yaml') })
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(imageCaption, { provider: 'caption-provider', model: 'm' })
    await ctx.get('settings')!.replace(IMAGE_CAPTION_SETTINGS_NAMESPACE, { enabled: false })
    const disabled = await fire(ctx, [imageMessage()])
    expect(disabled.kind).toBe('enter')
    if (disabled.kind !== 'enter') return
    expect(contentHasImage(disabled.messages[0]!.content)).toBe(true)
    expect(calls).toBe(0)
    await ctx.get('settings')!.replace(IMAGE_CAPTION_SETTINGS_NAMESPACE, { enabled: true })
    const enabled = await fire(ctx, [imageMessage()])
    expect(enabled.kind).toBe('enter')
    if (enabled.kind !== 'enter') return
    expect(enabled.messages[0]!.content[0]).toEqual({ type: 'text', text: `${CAPTION_PREFIX}a whale` })
    expect(calls).toBe(1)
  })
})
