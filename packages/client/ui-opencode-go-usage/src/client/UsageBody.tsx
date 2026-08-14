/**
 * Shared usage readout: the three windows with progress bars, reset times, and
 * the refresh control. Rendered by both the sidebar popover and the settings
 * page, so the two surfaces cannot drift in presentation.
 * @module @deepseek-ai/dsh-client-ui-opencode-go-usage/client/UsageBody
 */

import type { ReactElement } from 'react'
import type { UsageSuccess, UsageWindow } from '@deepseek-ai/dsh-opencode-go-usage/types'
import type { UsageState } from './usage.ts'
import { barWidth, fmtTime, levelColor } from './format.ts'
import css from './UsageBody.module.css'

/** The three windows the Go subscription tracks, in display order. */
const WINDOWS: ReadonlyArray<{ key: keyof Omit<UsageSuccess, 'ok' | 'fetchedAt'>; label: string }> = [
  { key: 'rolling', label: '滚动 5 小时' },
  { key: 'weekly', label: '本周' },
  { key: 'monthly', label: '本月' },
]

/** One window row: label, percentage, bar, and reset time. */
function WindowRow({ label, window }: { label: string; window: UsageWindow | null }): ReactElement {
  const percent = window?.percent ?? null
  return (
    <div className={css.row}>
      <div className={css.rowTop}>
        <span className={css.rowLabel}>{label}</span>
        <span className={css.rowPercent}>{percent === null ? '—' : `${percent}%`}</span>
      </div>
      <div className={css.bar}>
        <div className={css.barFill} style={{ width: barWidth(percent), background: levelColor(percent) }} />
      </div>
      <div className={css.reset}>重置: {fmtTime(window?.resetsAt ?? null)}</div>
    </div>
  )
}

/** Props of {@link UsageBody}. */
export interface UsageBodyProps {
  /** The polled state to render. */
  state: UsageState
  /** Manual refresh trigger. */
  onRefresh: () => void
}

/**
 * Render one usage state: loading text, the failure with a retry, or the
 * three windows with their reset times and a refresh control.
 * @param props - polled state and the refresh trigger.
 * @returns the readout body.
 */
export function UsageBody({ state, onRefresh }: UsageBodyProps): ReactElement {
  if (state.status === 'loading') {
    return <div className={css.meta}>查询中…</div>
  }
  if (state.status === 'error') {
    return (
      <div>
        <div className={css.error}>{state.error}</div>
        <div className={css.actions}>
          <button type="button" className={css.actionButton} onClick={onRefresh}>重试</button>
        </div>
      </div>
    )
  }
  const { snapshot } = state
  return (
    <div>
      {WINDOWS.map(({ key, label }) => <WindowRow key={key} label={label} window={snapshot[key]} />)}
      <div className={css.meta}>
        更新于 {fmtTime(snapshot.fetchedAt)} · 数据来源 opencode.ai/zen/go/v1/usage
      </div>
      <div className={css.actions}>
        <button type="button" className={css.actionButton} onClick={onRefresh}>刷新</button>
      </div>
    </div>
  )
}
