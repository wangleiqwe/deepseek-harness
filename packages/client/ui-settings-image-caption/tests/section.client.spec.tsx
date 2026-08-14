// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcId } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { ImageCaptionSection } from '../src/client/ImageCaptionSection.tsx'
import type { ImageCaptionSectionInjected } from '../src/client/ImageCaptionSection.tsx'
import { IMAGE_CAPTION_NS, ImageCaptionStore } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

function ok<T>(value: T): { rpcId: RpcId; result: { ok: true; value: T } } {
  return { rpcId: 'test' as unknown as RpcId, result: { ok: true, value } }
}

function fakeApi(initial: Record<string, unknown>) {
  let current = { ...initial }
  const replace = vi.fn(async (payload: { ns: string; section: object; expectedRevision?: number }) => {
    current = { ...current, ...payload.section as Record<string, unknown> }
    return ok({
      ns: IMAGE_CAPTION_NS,
      schema: {},
      value: current,
      applies: 'live' as const,
      secrets: [],
      revision: 2,
    })
  })
  const api = {
    settings: {
      describe: vi.fn(async () => ok({
        writable: true,
        hasDocument: true,
        namespaces: [{
          ns: IMAGE_CAPTION_NS,
          schema: {},
          value: current,
          applies: 'live' as const,
          secrets: [],
          revision: 1,
        }],
      })),
      openDocument: vi.fn(),
      update: vi.fn(),
      replace,
      mutate: vi.fn(),
    },
    llm: {
      providers: vi.fn(async () => ok({ providers: [] })),
      models: vi.fn(async () => ok({
        groups: [{
          id: 'opencode-go',
          name: 'OpenCode Zen Go',
          models: [{ id: 'minimax-m3', name: 'MiniMax-M3', inputModalities: ['text', 'image'] }],
        }],
        failures: [],
      })),
      discoverModels: vi.fn(),
    },
  } satisfies Pick<IApiClient, 'settings' | 'llm'>
  return { api, replace }
}

function face(api: Pick<IApiClient, 'settings' | 'llm'>): ImageCaptionSectionInjected {
  const controller = new ImageCaptionStore(api)
  return {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    t: key => zh[key],
  }
}

describe('ImageCaptionSection', () => {
  it('renders the toggle and route pickers from the loaded snapshot', async () => {
    const { api } = fakeApi({ enabled: true, provider: 'opencode-go', model: 'minimax-m3', onError: 'placeholder' })
    const section = face(api)
    render(<ImageCaptionSection {...section} />)
    expect(await screen.findByText(zh.enabled)).toBeTruthy()
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    expect(screen.getByDisplayValue('MiniMax-M3')).toBeTruthy()
    expect(screen.getByDisplayValue(zh.onErrorPlaceholder)).toBeTruthy()
  })

  it('writes the toggle through the controller on change', async () => {
    const { api, replace } = fakeApi({ enabled: true, provider: 'opencode-go', model: 'minimax-m3', onError: 'placeholder' })
    const section = face(api)
    render(<ImageCaptionSection {...section} />)
    const checkbox = await screen.findByRole('checkbox')
    fireEvent.click(checkbox)
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith({
        ns: IMAGE_CAPTION_NS,
        section: { enabled: false, onError: 'placeholder', provider: 'opencode-go', model: 'minimax-m3' },
        expectedRevision: 1,
      })
    })
    expect(await screen.findByText(zh.disabledHint)).toBeTruthy()
  })

  it('shows the vision-model hint when the provider declares none', async () => {
    const { api } = fakeApi({ enabled: true, provider: 'deepseek-official', model: undefined, onError: 'placeholder' })
    const section = face(api)
    render(<ImageCaptionSection {...section} />)
    expect(await screen.findByText(zh.noVisionModels)).toBeTruthy()
  })
})
