import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OpencodeUsageService from '../src/index.ts'
import type { Config } from '../src/index.ts'

/** Captured tool registration with its disposer. */
interface FakeTools {
  register: (definition: ToolDefinition) => () => void
}

/** Credential store answering one fixed reference. */
interface FakeCredentials {
  resolve: (ref: string) => Promise<{ value: string; source: string } | undefined>
}

/** Boot the service over provided fakes. */
async function boot(
  config: Config = {},
  tools: FakeTools = {
    register: (definition) => {
      captured.definition = definition
      return () => { captured.disposed = true }
    },
  },
  credentials: FakeCredentials = {
    resolve: async (ref) => {
      resolves.push(ref)
      return { value: 'sk-test', source: 'file' }
    },
  },
): Promise<{ ctx: Context; dispose: () => Promise<void>; resolves: string[] }> {
  const ctx = new Context()
  ctx.provide('tools', tools)
  ctx.provide('credentials', credentials)
  const handle = await ctx.plugin(OpencodeUsageService, config)
  return { ctx, dispose: () => handle.dispose(), resolves }
}

/** The one registration the shared fake captured. */
const captured: { definition: ToolDefinition | undefined; disposed: boolean } = {
  definition: undefined,
  disposed: false,
}

/** References resolved by the shared fake credentials. */
const resolves: string[] = []

/** Call the captured tool's render without detaching it from its definition. */
function renderCaptured(args: unknown, value: unknown): ReturnType<ToolDefinition['output']['render']> {
  // The raw stand-ins ride the DSL's infer-typed render as arbitrary wire values.
  return captured.definition!.output.render(args as never, value as never)
}

/** Execute the captured tool with empty arguments. */
function executeCaptured(): Promise<unknown> {
  return captured.definition!.execute({}, undefined as never)
}

/** A minimal fetch Response stand-in. */
function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(payload) } as unknown as Response
}

/** A minimal non-JSON Response stand-in. */
function brokenJsonResponse(): Response {
  return { ok: true, status: 200, json: () => Promise.reject(new SyntaxError('bad json')) } as unknown as Response
}

/** One fully populated gateway window. */
const WINDOW = { status: 'ok', percent: 53, resetsAt: '2026-08-14T15:46:52.610Z' }

const FULL_PAYLOAD = {
  usage: {
    rolling: WINDOW,
    weekly: { status: 'ok', percent: 21, resetsAt: '2026-08-17T00:00:00.610Z' },
    monthly: { status: 'ok', percent: 10, resetsAt: '2026-09-14T08:48:47.610Z' },
  },
}

afterEach(() => {
  captured.definition = undefined
  captured.disposed = false
  resolves.length = 0
  vi.unstubAllGlobals()
})

describe('config resolution', () => {
  it('accepts an empty config and registers the tool with defaults', async () => {
    const { dispose, resolves: seen } = await boot()
    expect(captured.definition?.name).toBe('opencode_go_usage')
    await executeCaptured()
    expect(seen).toEqual(['OPENCODE_GO_API_KEY'])
    await dispose()
    expect(captured.disposed).toBe(true)
  })

  it('honours a custom route configuration', async () => {
    const { resolves: seen } = await boot({ apiKeyEnv: 'MY_GO_KEY', usageUrl: 'https://example.test/usage', timeoutMs: 5000 })
    await executeCaptured()
    expect(seen).toEqual(['MY_GO_KEY'])
  })

  it('rejects a non-finite timeoutMs', async () => {
    await expect(boot({ timeoutMs: Number.NaN })).rejects.toThrow(/timeoutMs/)
  })

  it('rejects a non-positive timeoutMs', async () => {
    await expect(boot({ timeoutMs: 0 })).rejects.toThrow(/timeoutMs/)
  })

  it('rejects a credential reference that is not a POSIX identifier', async () => {
    await expect(boot({ apiKeyEnv: '9bad' })).rejects.toThrow(/credential ref/)
  })
})

describe('usage reads', () => {
  it('reads the three windows with a valid key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(FULL_PAYLOAD)))
    const { ctx } = await boot()
    const result = await ctx.opencodeUsage.usage()
    expect(result).toEqual({
      ok: true,
      fetchedAt: expect.any(String) as string,
      rolling: { status: 'ok', percent: 53, resetsAt: '2026-08-14T15:46:52.610Z' },
      weekly: { status: 'ok', percent: 21, resetsAt: '2026-08-17T00:00:00.610Z' },
      monthly: { status: 'ok', percent: 10, resetsAt: '2026-09-14T08:48:47.610Z' },
    })
    const called = vi.mocked(fetch)
    expect(called.mock.calls[0]?.[0]).toBe('https://opencode.ai/zen/go/v1/usage')
    const headers = (called.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test')
  })

  it('reports a missing credential without touching the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { ctx } = await boot({}, undefined, {
      resolve: async () => undefined,
    })
    await expect(ctx.opencodeUsage.usage()).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('未配置') as string,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports an empty stored credential as missing', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { ctx } = await boot({}, undefined, {
      resolve: async () => ({ value: '', source: 'file' }),
    })
    await expect(ctx.opencodeUsage.usage()).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('未配置') as string,
    })
  })

  it('reports a rejected fetch with its message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up') }))
    const { ctx } = await boot()
    await expect(ctx.opencodeUsage.usage()).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('socket hang up') as string,
    })
  })

  it('reports a rejected fetch thrown as a non-Error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw 'boom' }))
    const { ctx } = await boot()
    await expect(ctx.opencodeUsage.usage()).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('boom') as string,
    })
  })

  it('reports a non-2xx response status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, false, 403)))
    const { ctx } = await boot()
    await expect(ctx.opencodeUsage.usage()).resolves.toEqual({
      ok: false,
      error: 'OpenCode 返回 HTTP 403',
    })
  })

  it('reports a non-JSON response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => brokenJsonResponse()))
    const { ctx } = await boot()
    await expect(ctx.opencodeUsage.usage()).resolves.toEqual({
      ok: false,
      error: 'OpenCode 响应不是 JSON',
    })
  })

  it('reports a non-object payload as missing usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null)))
    const { ctx } = await boot()
    await expect(ctx.opencodeUsage.usage()).resolves.toEqual({
      ok: false,
      error: 'OpenCode 响应缺少 usage 字段',
    })
  })

  it('reports a payload without a usage field as missing usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ hello: 'world' })))
    const { ctx } = await boot()
    await expect(ctx.opencodeUsage.usage()).resolves.toEqual({
      ok: false,
      error: 'OpenCode 响应缺少 usage 字段',
    })
  })

  it('reports a non-object usage field as missing usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ usage: 'none' })))
    const { ctx } = await boot()
    await expect(ctx.opencodeUsage.usage()).resolves.toEqual({
      ok: false,
      error: 'OpenCode 响应缺少 usage 字段',
    })
  })

  it('nulls windows the payload does not describe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ usage: {} })))
    const { ctx } = await boot()
    await expect(ctx.opencodeUsage.usage()).resolves.toMatchObject({
      ok: true,
      rolling: null,
      weekly: null,
      monthly: null,
    })
  })

  it('nulls the fields a malformed window leaves untyped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      usage: {
        rolling: { status: 7, percent: 'high', resetsAt: 12 },
        weekly: 'gone',
        monthly: WINDOW,
      },
    })))
    const { ctx } = await boot()
    await expect(ctx.opencodeUsage.usage()).resolves.toMatchObject({
      ok: true,
      rolling: { status: 'unknown', percent: null, resetsAt: null },
      weekly: null,
      monthly: { status: 'ok', percent: 53, resetsAt: '2026-08-14T15:46:52.610Z' },
    })
  })
})

describe('tool rendering', () => {
  it('renders a failed read with its reason', async () => {
    await boot()
    const block = renderCaptured({}, { ok: false, error: '没有密钥' })
    expect(block).toEqual([{ type: 'text', text: 'OpenCode Go 额度查询失败: 没有密钥' }])
  })

  it('renders a generic reason when the failure carries none', async () => {
    await boot()
    const block = renderCaptured({}, { ok: false })
    expect(block).toEqual([{ type: 'text', text: 'OpenCode Go 额度查询失败: 未知错误' }])
  })

  it('renders a non-object value as a generic failure', async () => {
    await boot()
    const block = renderCaptured({}, 'not-a-result')
    expect(block).toEqual([{ type: 'text', text: 'OpenCode Go 额度查询失败: 未知错误' }])
  })

  it('renders a snapshot without windows', async () => {
    await boot()
    const block = renderCaptured({}, {
      ok: true,
      fetchedAt: '2026-08-14T15:46:52.610Z',
      rolling: null,
      weekly: null,
      monthly: null,
    })
    expect(block?.[0]).toEqual({
      type: 'text',
      text: 'OpenCode Go 套餐额度(更新于 2026-08-14 23:46):\n'
        + '滚动5小时: 未知 | 重置于 未知\n'
        + '本周: 未知 | 重置于 未知\n'
        + '本月: 未知 | 重置于 未知',
    })
  })

  it('renders a populated snapshot with reset times', async () => {
    await boot()
    const block = renderCaptured({}, {
      ok: true,
      fetchedAt: '2026-08-14T15:46:52.610Z',
      rolling: { status: 'ok', percent: 53, resetsAt: '2026-08-14T15:46:52.610Z' },
      weekly: { status: 'ok', percent: 21, resetsAt: '2026-08-17T00:00:00.610Z' },
      monthly: { status: 'ok', percent: null, resetsAt: 'not-a-date' },
    })
    expect(block?.[0]).toEqual({
      type: 'text',
      text: 'OpenCode Go 套餐额度(更新于 2026-08-14 23:46):\n'
        + '滚动5小时: 53% | 重置于 2026-08-14 23:46\n'
        + '本周: 21% | 重置于 2026-08-17 08:00\n'
        + '本月: ?% | 重置于 not-a-date',
    })
  })

  it('executes through the same read the Remote exposes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(FULL_PAYLOAD)))
    await boot()
    const result = await executeCaptured()
    expect(result).toMatchObject({ ok: true, rolling: { percent: 53 } })
  })
})
