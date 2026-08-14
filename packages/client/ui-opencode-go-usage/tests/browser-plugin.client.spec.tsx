// @vitest-environment jsdom
/**
 * Browser-plugin wiring: the two slot registrations carry their ids, orders,
 * and labels, the injected face reads through the opencodeUsage Remote
 * namespace, and the read verb folds carrier failures into the business shape.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { UsageResult } from '@deepseek-ai/dsh-opencode-go-usage/types'
import { apply, inject } from '../src/client/index.ts'

interface CapturedRegistration {
  name: string
  options: Record<string, unknown>
  component: unknown
}

interface CapturedFace {
  fetchUsage: () => Promise<UsageResult>
}

/** Boot the plugin over a recording slot registry and a stub Remote namespace. */
async function boot(remoteUsage: () => Promise<{ ok: boolean; value?: UsageResult; error?: { message: string } }>): Promise<{
  registrations: CapturedRegistration[]
  faces: CapturedFace[]
  remoteCalls: () => number
}> {
  const registrations: CapturedRegistration[] = []
  const faces: CapturedFace[] = []
  let calls = 0
  const ctx = new Context()
  ctx.provide('slots', {
    inject(_name: string, callback: () => unknown): void {
      callback()
    },
    register(options: Record<string, unknown>, component: unknown): () => void {
      registrations.push({ name: options.name as string, options, component })
      return () => {}
    },
  })
  ctx.provide('remote', {
    opencodeUsage: {
      usage: async () => {
        calls += 1
        const result = await remoteUsage()
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: { code: 'carrier', message: result.error!.message, details: {} } }
      },
    },
  })
  ctx.provide('remote.opencodeUsage', {})
  apply(ctx)
  for (const registration of registrations) {
    const faceFactory = registration.options.inject as () => CapturedFace
    faces.push(faceFactory())
  }
  return { registrations, faces, remoteCalls: () => calls }
}

const SNAPSHOT: UsageResult = {
  ok: true,
  fetchedAt: '2026-08-14T15:46:52.610Z',
  rolling: { status: 'ok', percent: 53, resetsAt: '2026-08-14T15:46:52.610Z' },
  weekly: { status: 'ok', percent: 21, resetsAt: '2026-08-17T00:00:00.610Z' },
  monthly: { status: 'ok', percent: 10, resetsAt: '2026-09-14T08:48:47.610Z' },
}

describe('client plugin wiring', () => {
  it('declares the slot registry and the usage Remote namespace', () => {
    expect(inject).toContain('slots')
    expect(inject).toContain('remote')
    expect(inject).toContain('remote.opencodeUsage')
  })

  it('registers the sidebar indicator with its identity', async () => {
    const { registrations } = await boot(async () => ({ ok: true, value: SNAPSHOT }))
    const footer = registrations.find(entry => entry.name === 'sidebar.footer.action')
    expect(footer?.options.id).toBe('opencode-go-usage')
    expect(footer?.options.order).toBe(10)
    expect(footer?.options.label).toBe('Go 套餐额度')
    expect(footer?.component).toBeTypeOf('function')
  })

  it('registers the settings section with its identity', async () => {
    const { registrations } = await boot(async () => ({ ok: true, value: SNAPSHOT }))
    const section = registrations.find(entry => entry.name === 'settings.section')
    expect(section?.options.id).toBe('opencode-go-usage')
    expect(section?.options.order).toBe(12)
    expect(section?.options.label).toBe('Go 套餐额度')
    expect(section?.component).toBeTypeOf('function')
  })

  it('reads the snapshot through the Remote namespace', async () => {
    const { faces, remoteCalls } = await boot(async () => ({ ok: true, value: SNAPSHOT }))
    await expect(faces[0]!.fetchUsage()).resolves.toEqual(SNAPSHOT)
    expect(remoteCalls()).toBe(1)
  })

  it('folds a carrier failure into the business failure shape', async () => {
    const { faces } = await boot(async () => ({ ok: false, error: { message: 'carrier down' } }))
    await expect(faces[0]!.fetchUsage()).resolves.toEqual({ ok: false, error: 'carrier down' })
  })
})
