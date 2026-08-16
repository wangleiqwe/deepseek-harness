/**
 * session.prompt image admission over the image-caption transform: a
 * text-only main model admits pasted images only when the mounted transform
 * (settings namespace `image-caption`, anything but `enabled: false`) will
 * caption them before the model sees the request. Without the transform the
 * gate answers `MODEL_DOES_NOT_SUPPORT_IMAGES` before any pre-step listener
 * can run.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import * as imageCaption from '@deepseek-ai/dsh-image-caption'
import { IMAGE_CAPTION_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-image-caption/src/config.ts'
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

const sid = (id: string): SessionId => id as SessionId

let sandbox: string

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'dsh-apiproxy-image-caption-'))
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

/** A text-only main route: every model resolves to text input. */
class TextOnlyAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  override stream(): AsyncIterable<StreamChunk> {
    return (async function* () {})()
  }
}

/** Canonical base64 of a 1x1 transparent PNG. */
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** Wire form of one image prompt. */
type ImagePromptRequest = RpcRequest<{
  sessionId: SessionId
  mode: 'queue'
  content: Array<{ type: 'image'; mediaType: 'image/png'; data: string }>
}>

/** One prompt carrying a canonical tiny PNG. */
function imagePrompt(sessionId: SessionId): ImagePromptRequest {
  return {
    rpcId: RpcId(`ic-${String(Math.random())}`),
    payload: {
      sessionId,
      mode: 'queue',
      content: [{ type: 'image', mediaType: 'image/png', data: TINY_PNG }],
    },
  }
}

/** One prompt carrying plain text. */
function textPrompt(sessionId: SessionId): RpcRequest<{ sessionId: SessionId; mode: 'queue'; content: Array<{ type: 'text'; text: string }> }> {
  return {
    rpcId: RpcId(`ic-${String(Math.random())}`),
    payload: { sessionId, mode: 'queue', content: [{ type: 'text', text: 'hi' }] },
  }
}

/** Assembled harness for one admission scenario. */
interface HarnessResult {
  ctx: Context
  api: ApiProxy
  followup: ReturnType<typeof vi.fn>
  sessionId: SessionId
}

async function harness(mountCaption: boolean): Promise<HarnessResult> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['main'], new TextOnlyAdapter())
  await ctx.plugin(LocalAttachmentStore, { dshHome: sandbox })
  await ctx.plugin(FileSettingsProvider, { path: join(sandbox, 'settings.yaml') })
  await ctx.plugin(AgentRegistry)
  if (mountCaption) {
    await ctx.plugin(imageCaption, { provider: 'main', model: 'm' })
  }
  const sessionId = sid('session-image')
  const session = ctx.sessions.create(sessionId)
  const followup = vi.fn((_message: UserMessage) => {})
  const agent: Agent = {
    id: sessionId,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup,
    steer: () => {},
    inject: () => { throw new Error('image admission must not inject') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'main', model: 'm' }), cwd: '/tmp' })
  return { ctx, api, followup, sessionId }
}

describe('session.prompt image admission', () => {
  it('rejects images on a text-only main model while the transform is not mounted', async () => {
    const { api, followup, sessionId } = await harness(false)
    const response = await api.sessions.prompt(imagePrompt(sessionId))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) {
      expect(response.result.error).toMatchObject({
        code: 'attachment-error',
        details: { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' },
      })
    }
    expect(followup).not.toHaveBeenCalled()
  })

  it('admits images once the transform is mounted and enabled', async () => {
    const { api, followup, sessionId } = await harness(true)
    const response = await api.sessions.prompt(imagePrompt(sessionId))
    // The admission gate must not refuse: the transform captions the image in
    // pre-step. Everything downstream (durable promotion, followup) is the
    // ordinary prompt path and out of scope here.
    if (!response.result.ok) {
      expect(response.result.error).not.toMatchObject({ details: { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' } })
    }
    expect(followup).toHaveBeenCalled()
  })

  it('rejects images again when the settings namespace disables the transform', async () => {
    const { ctx, api, followup, sessionId } = await harness(true)
    await ctx.get('settings')!.replace(IMAGE_CAPTION_SETTINGS_NAMESPACE, { enabled: false })
    const response = await api.sessions.prompt(imagePrompt(sessionId))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) {
      expect(response.result.error).toMatchObject({
        code: 'attachment-error',
        details: { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' },
      })
    }
    expect(followup).not.toHaveBeenCalled()
  })

  it('keeps admitting text prompts regardless of the transform', async () => {
    const { api, followup, sessionId } = await harness(false)
    const response = await api.sessions.prompt(textPrompt(sessionId))
    if (!response.result.ok) {
      expect(response.result.error).not.toMatchObject({ details: { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' } })
    }
    expect(followup).toHaveBeenCalled()
  })
})
