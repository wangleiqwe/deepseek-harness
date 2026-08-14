/**
 * The sidebar-foot usage indicator: a health dot with the rolling-window
 * percentage in the wide sidebar, expanding into a popover with the full
 * three-window readout. The rail state keeps the dot only.
 * @module @deepseek-ai/dsh-client-ui-opencode-go-usage/client/FooterUsage
 */

import { useState } from 'react'
import type { ReactElement } from 'react'
import { UsageBody } from './UsageBody.tsx'
import { levelColor } from './format.ts'
import { useUsage } from './usage.ts'
import type { OpencodeUsageInjected } from './usage.ts'
import css from './UsageBody.module.css'

/** Owner share plus the injected read verb. */
export interface FooterUsageProps extends OpencodeUsageInjected {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/**
 * Render the sidebar-foot indicator and its popover.
 * @param props - the sidebar column state and the injected read verb.
 * @returns the indicator, plus the popover while open.
 */
export function FooterUsage({ wide, fetchUsage }: FooterUsageProps): ReactElement {
  const usage = useUsage(fetchUsage)
  const [open, setOpen] = useState(false)
  const percent = usage.status === 'ok' ? (usage.snapshot.rolling?.percent ?? null) : null
  const dot = <span className={css.dot} style={{ background: levelColor(percent) }} />
  const label = usage.status === 'ok'
    ? `Go ${percent === null ? '—' : `${percent}%`}`
    : 'Go …'
  return (
    <div className={css.wrap}>
      <button
        type="button"
        className={css.trigger}
        aria-label="OpenCode Go 套餐额度"
        title="OpenCode Go 套餐额度"
        aria-expanded={open}
        onClick={() => { setOpen(current => !current) }}
      >
        {dot}
        {wide ? <span>{label}</span> : null}
      </button>
      {open ? (
        <div className={css.pop}>
          <div className={css.popTitle}>OpenCode Go 套餐额度</div>
          <UsageBody state={usage} onRefresh={usage.refresh} />
          <div className={css.actions}>
            <button type="button" className={css.actionButton} onClick={() => { setOpen(false) }}>关闭</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
