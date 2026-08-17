/**
 * sessions.openDirectory: the host resolves the session's persistence
 * artifact directory and hands it to the native opener (or reports why it
 * cannot). The directory travels browser-side only when the deployment has
 * no opener to hand it to; a backend without per-session artifacts resolves
 * path to null.
 */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

const sid = (id: string): SessionId => id as SessionId

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`od-${String(nextRpc++)}`), payload }
}

async function harness(options: {
  openPath?: (path: string, signal: AbortSignal) => Promise<void>
  canOpenPath?: () => boolean
  locate?: (meta: { id: SessionId }) => { kind: string; path: string } | undefined
} = {}): Promise<{ api: ReturnType<typeof createApiProxy>; ctx: Context; opened: string[] }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.agents.setFactory({
    createAgent: (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const agent = { id: session.id, session, status: 'idle', ctx: ownerCtx } as Agent
      ctx.agents.register(agent)
      return Promise.resolve({ agent, dispose: () => Promise.resolve() })
    },
    resume: () => Promise.reject(new Error('resume must not run: every source is attached')),
  })
  // The lookup helper needs list() to reach its session-not-found verdict and
  // locate() to resolve the artifact; both default to "nothing here".
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([]),
    locate: options.locate ?? (() => undefined),
  } as never)
  const opened: string[] = []
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: '/tmp',
    ...options.openPath === undefined
      ? {}
      : { openPath: (path: string, signal: AbortSignal) => {
        opened.push(path)
        return options.openPath!(path, signal)
      } },
    ...options.canOpenPath === undefined ? {} : { canOpenPath: options.canOpenPath },
  })
  return { api, ctx, opened }
}

/** Register one live agent session with a durable identity. */
function liveAgent(ctx: Context, id: string): Session {
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return session
}

describe('sessions.openDirectory', () => {
  it('resolves the artifact directory host-side and opens it through the native opener', async () => {
    const { api, ctx, opened } = await harness({
      openPath: async () => {},
      locate: meta => ({ kind: 'jsonl', path: join('/dsh/sessions', 'p', meta.id, 'session.jsonl') }),
    })
    const source = liveAgent(ctx, 'session-open-dir')
    const response = await api.sessions.openDirectory(
      request({ sessionId: source.id }), new AbortController().signal)
    expect(response.result).toEqual({ ok: true, value: { opened: true } })
    expect(opened).toEqual([join('/dsh/sessions', 'p', source.id)])
  })

  it('reports the resolved directory when the deployment has no native opener', async () => {
    const { api, ctx } = await harness({
      canOpenPath: () => false,
      locate: meta => ({ kind: 'jsonl', path: join('/dsh', meta.id, 'session.jsonl') }),
    })
    const source = liveAgent(ctx, 'session-open-headless')
    const response = await api.sessions.openDirectory(
      request({ sessionId: source.id }), new AbortController().signal)
    expect(response.result).toEqual({
      ok: true,
      value: { opened: false, path: join('/dsh', source.id) },
    })
  })

  it('resolves path null for a backend without per-session artifacts', async () => {
    const { api, ctx } = await harness()
    const source = liveAgent(ctx, 'session-open-sqlite')
    const response = await api.sessions.openDirectory(
      request({ sessionId: source.id }), new AbortController().signal)
    expect(response.result).toEqual({ ok: true, value: { opened: false, path: null } })
  })

  it('fails with session-not-found for an unknown session', async () => {
    const { api } = await harness()
    const response = await api.sessions.openDirectory(
      request({ sessionId: sid('session-ghost') }), new AbortController().signal)
    expect(response.result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'session-not-found' }),
    })
  })
})
