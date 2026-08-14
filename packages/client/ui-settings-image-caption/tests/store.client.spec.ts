import { describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  ImageCaptionStore,
  IMAGE_CAPTION_NS,
  updateValue,
  userSectionOf,
} from '../src/client/store.ts'

const PROVIDER_GROUPS = [
  {
    id: 'opencode-go',
    name: 'OpenCode Zen Go',
    models: [
      { id: 'minimax-m3', name: 'MiniMax-M3', inputModalities: ['text', 'image'] },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', inputModalities: ['text'] },
    ],
  },
  {
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', inputModalities: ['text'] }],
  },
]

function ok<T>(value: T): { rpcId: RpcId; result: { ok: true; value: T } } {
  return { rpcId: 'test' as unknown as RpcId, result: { ok: true, value } }
}

function fakeApi(overrides: Partial<Pick<IApiClient, 'settings' | 'llm'>> = {}) {
  const describe = vi.fn(async () => ok({
    writable: true,
    hasDocument: true,
    namespaces: [{
      ns: IMAGE_CAPTION_NS,
      schema: {},
      value: { enabled: true, provider: 'opencode-go', model: 'minimax-m3', onError: 'placeholder' },
      applies: 'live' as const,
      secrets: [],
      revision: 3,
    }],
  }))
  const replace = vi.fn(async () => ok({
    ns: IMAGE_CAPTION_NS,
    schema: {},
    value: { enabled: true, provider: 'opencode-go', model: 'minimax-m3', onError: 'placeholder' },
    applies: 'live' as const,
    secrets: [],
    revision: 4,
  }))
  const api = {
    settings: {
      describe,
      replace,
      openDocument: vi.fn(),
      update: vi.fn(),
      mutate: vi.fn(),
    },
    llm: {
      providers: vi.fn(async () => ok({ providers: [] })),
      models: vi.fn(async () => ok({ groups: PROVIDER_GROUPS, failures: [] })),
      discoverModels: vi.fn(),
    },
    ...overrides,
  } satisfies Pick<IApiClient, 'settings' | 'llm'>
  return { api, describe, replace }
}

describe('pure helpers', () => {
  it('renders the user-layer section with only the UI-owned fields', () => {
    expect(userSectionOf({ enabled: true, provider: 'p', model: 'm', onError: 'fail' }))
      .toEqual({ enabled: true, onError: 'fail', provider: 'p', model: 'm' })
    expect(userSectionOf({ enabled: false, onError: 'placeholder' }))
      .toEqual({ enabled: false, onError: 'placeholder' })
  })

  it('merges control changes and omits cleared route names', () => {
    const current = { enabled: true, provider: 'p', model: 'm', onError: 'placeholder' as const }
    expect(updateValue(current, { provider: undefined }))
      .toEqual({ enabled: true, onError: 'placeholder', model: 'm' })
    expect(updateValue(current, { enabled: false, onError: 'fail' }))
      .toEqual({ enabled: false, provider: 'p', model: 'm', onError: 'fail' })
  })
})

describe('ImageCaptionStore.load', () => {
  it('joins the namespace view and the model catalog', async () => {
    const { api } = fakeApi()
    const store = new ImageCaptionStore(api)
    await store.load()
    const snapshot = store.store.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.value).toEqual({
      enabled: true,
      provider: 'opencode-go',
      model: 'minimax-m3',
      onError: 'placeholder',
    })
    expect(snapshot.groups.map(group => group.id)).toEqual(['opencode-go', 'deepseek-official'])
  })

  it('keeps the last good snapshot on a load failure', async () => {
    const { api } = fakeApi({
      llm: {
        providers: vi.fn(async () => ok({ providers: [] })),
        models: vi.fn(async () => { throw new Error('catalog down') }),
        discoverModels: vi.fn(),
      },
    })
    const store = new ImageCaptionStore(api)
    await store.load()
    const snapshot = store.store.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.error).toContain('catalog down')
  })

  it('defaults enabled and placeholder when the namespace is absent', async () => {
    const { api, describe } = fakeApi()
    describe.mockResolvedValue(ok({
      writable: true,
      hasDocument: true,
      namespaces: [],
    }))
    const store = new ImageCaptionStore(api)
    await store.load()
    expect(store.store.getSnapshot().value).toEqual({ enabled: true, onError: 'placeholder' })
  })
})

describe('ImageCaptionStore.save', () => {
  it('replaces the user layer with the revision and refetches', async () => {
    const { api, replace } = fakeApi()
    const store = new ImageCaptionStore(api)
    await store.load()
    await store.save({ enabled: false, provider: 'opencode-go', model: 'minimax-m3', onError: 'placeholder' })
    expect(replace).toHaveBeenCalledWith({
      ns: IMAGE_CAPTION_NS,
      section: { enabled: false, onError: 'placeholder', provider: 'opencode-go', model: 'minimax-m3' },
      expectedRevision: 3,
    })
    expect(store.store.getSnapshot().value.enabled).toBe(true) // refetched from the fake answer
  })

  it('surfaces a write failure in the snapshot error', async () => {
    const { api, replace } = fakeApi()
    replace.mockRejectedValue(new Error('write rejected'))
    const store = new ImageCaptionStore(api)
    await store.load()
    await store.save({ enabled: false, onError: 'placeholder' })
    expect(store.store.getSnapshot().error).toContain('write rejected')
  })
})
