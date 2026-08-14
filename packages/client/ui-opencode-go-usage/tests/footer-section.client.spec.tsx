// @vitest-environment jsdom
/**
 * FooterUsage and UsageSection rendering over the injected read verb: the
 * poll lifecycle (mount read, sixty-second refresh, error folding, unmount
 * teardown), the indicator's wide/rail states, and the popover toggle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { UsageResult } from '@deepseek-ai/dsh-opencode-go-usage/types'
import { FooterUsage } from '../src/client/FooterUsage.tsx'
import { UsageSection } from '../src/client/UsageSection.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const SNAPSHOT: UsageResult = {
  ok: true,
  fetchedAt: '2026-08-14T15:46:52.610Z',
  rolling: { status: 'ok', percent: 53, resetsAt: '2026-08-14T15:46:52.610Z' },
  weekly: { status: 'ok', percent: 21, resetsAt: '2026-08-17T00:00:00.610Z' },
  monthly: { status: 'ok', percent: 10, resetsAt: '2026-09-14T08:48:47.610Z' },
}

function deferred(): { promise: Promise<UsageResult>; resolve: (value: UsageResult) => void; reject: (error: unknown) => void } {
  let resolve!: (value: UsageResult) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<UsageResult>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('FooterUsage', () => {
  it('shows the rolling percentage once the read settles', async () => {
    const fetchUsage = vi.fn(() => Promise.resolve(SNAPSHOT))
    const ui = render(<FooterUsage wide fetchUsage={fetchUsage} />)
    expect(await ui.findByText('Go 53%')).toBeTruthy()
    expect(fetchUsage).toHaveBeenCalledTimes(1)
  })

  it('keeps only the dot in the rail state', async () => {
    const fetchUsage = vi.fn(() => Promise.resolve(SNAPSHOT))
    const ui = render(<FooterUsage wide={false} fetchUsage={fetchUsage} />)
    await ui.findByLabelText('OpenCode Go 套餐额度')
    expect(ui.queryByText('Go 53%')).toBeNull()
  })

  it('opens and closes the popover with the shared readout', async () => {
    const fetchUsage = vi.fn(() => Promise.resolve(SNAPSHOT))
    const ui = render(<FooterUsage wide fetchUsage={fetchUsage} />)
    const trigger = ui.getByLabelText('OpenCode Go 套餐额度')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(await ui.findByText('OpenCode Go 套餐额度')).toBeTruthy()
    expect(ui.getByText('滚动 5 小时')).toBeTruthy()
    fireEvent.click(ui.getByRole('button', { name: '关闭' }))
    expect(ui.queryByText('滚动 5 小时')).toBeNull()
  })

  it('shows an indeterminate label while the first read is outstanding', () => {
    const pending = deferred()
    const fetchUsage = vi.fn(() => pending.promise)
    const ui = render(<FooterUsage wide fetchUsage={fetchUsage} />)
    expect(ui.getByText('Go …')).toBeTruthy()
    pending.resolve(SNAPSHOT)
  })

  it('refreshes the read every minute and stops after unmount', async () => {
    vi.useFakeTimers()
    const fetchUsage = vi.fn(() => Promise.resolve(SNAPSHOT))
    const ui = render(<FooterUsage wide fetchUsage={fetchUsage} />)
    await act(async () => { await Promise.resolve() })
    expect(fetchUsage).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(60_000) })
    await act(async () => { await Promise.resolve() })
    expect(fetchUsage).toHaveBeenCalledTimes(2)
    ui.unmount()
    await act(async () => { vi.advanceTimersByTime(120_000) })
    expect(fetchUsage).toHaveBeenCalledTimes(2)
  })

  it('folds a rejected read into the error state', async () => {
    const fetchUsage = vi.fn(() => Promise.reject(new Error('网络错误')))
    const ui = render(<FooterUsage wide fetchUsage={fetchUsage} />)
    fireEvent.click(ui.getByLabelText('OpenCode Go 套餐额度'))
    expect(await ui.findByText('网络错误')).toBeTruthy()
  })

  it('folds a rejected non-Error read into a string error', async () => {
    // oxlint-disable-next-line prefer-promise-reject-errors -- the non-Error branch is the point of this case
    const fetchUsage = vi.fn(() => Promise.reject('boom'))
    const ui = render(<FooterUsage wide fetchUsage={fetchUsage} />)
    fireEvent.click(ui.getByLabelText('OpenCode Go 套餐额度'))
    expect(await ui.findByText('boom')).toBeTruthy()
  })

  it('folds a business failure into the error state with its reason', async () => {
    const fetchUsage = vi.fn(() => Promise.resolve({ ok: false as const, error: '密钥未配置' }))
    const ui = render(<FooterUsage wide fetchUsage={fetchUsage} />)
    fireEvent.click(ui.getByLabelText('OpenCode Go 套餐额度'))
    expect(await ui.findByText('密钥未配置')).toBeTruthy()
  })
})

describe('UsageSection', () => {
  it('renders the explainer above the shared readout', async () => {
    const fetchUsage = vi.fn(() => Promise.resolve(SNAPSHOT))
    const ui = render(<UsageSection fetchUsage={fetchUsage} />)
    expect(await ui.findByText('滚动 5 小时')).toBeTruthy()
    expect(ui.getByText(/滚动 5 小时\(约 \$12\)/)).toBeTruthy()
  })
})
