// @vitest-environment jsdom
/**
 * UsageBody rendering: the loading text, the failure with its retry, and the
 * populated three-window readout with the refresh control.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { UsageResult } from '@deepseek-ai/dsh-opencode-go-usage/types'
import { UsageBody } from '../src/client/UsageBody.tsx'
import type { UsageState } from '../src/client/usage.ts'

afterEach(cleanup)

const SNAPSHOT = {
  ok: true as const,
  fetchedAt: '2026-08-14T15:46:52.610Z',
  rolling: { status: 'ok', percent: 53, resetsAt: '2026-08-14T15:46:52.610Z' },
  weekly: { status: 'ok', percent: 21, resetsAt: '2026-08-17T00:00:00.610Z' },
  monthly: { status: 'ok', percent: null, resetsAt: null },
}

function body(state: UsageState, onRefresh: () => void = () => {}): ReturnType<typeof render> {
  return render(<UsageBody state={state} onRefresh={onRefresh} />)
}

describe('UsageBody', () => {
  it('renders the loading text while the first read is outstanding', () => {
    const ui = body({ status: 'loading' })
    expect(ui.getByText('查询中…')).toBeTruthy()
  })

  it('renders the failure with a retry that triggers the refresh verb', () => {
    const onRefresh = vi.fn()
    const ui = body({ status: 'error', error: '没有密钥' }, onRefresh)
    expect(ui.getByText('没有密钥')).toBeTruthy()
    fireEvent.click(ui.getByRole('button', { name: '重试' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('renders the three windows with percentages, reset times, and the refresh control', () => {
    const onRefresh = vi.fn()
    const ui = body({ status: 'ok', snapshot: SNAPSHOT }, onRefresh)
    expect(ui.getByText('滚动 5 小时')).toBeTruthy()
    expect(ui.getByText('53%')).toBeTruthy()
    expect(ui.getByText('本周')).toBeTruthy()
    expect(ui.getByText('21%')).toBeTruthy()
    expect(ui.getByText('本月')).toBeTruthy()
    expect(ui.getByText('—')).toBeTruthy()
    expect(ui.getAllByText(/重置:/)).toHaveLength(3)
    expect(ui.getByText(/更新于 2026-08-14 23:46/)).toBeTruthy()
    fireEvent.click(ui.getByRole('button', { name: '刷新' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('renders an absent rolling window as unknown without crashing', () => {
    const result: UsageResult = {
      ...SNAPSHOT,
      rolling: null,
      weekly: null,
      monthly: null,
    }
    const ui = body({ status: 'ok', snapshot: result })
    expect(ui.getAllByText('—')).toHaveLength(3)
  })
})
