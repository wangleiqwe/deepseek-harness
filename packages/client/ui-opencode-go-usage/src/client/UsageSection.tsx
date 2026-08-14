/**
 * The settings usage page: a short limit explainer above the shared
 * three-window readout, registered as its own settings section.
 * @module @deepseek-ai/dsh-client-ui-opencode-go-usage/client/UsageSection
 */

import type { ReactElement } from 'react'
import { UsageBody } from './UsageBody.tsx'
import { useUsage } from './usage.ts'
import type { OpencodeUsageInjected } from './usage.ts'
import css from './UsageBody.module.css'

/** Props: the injected read verb; the shell owns the close affordance. */
export interface UsageSectionProps extends OpencodeUsageInjected {}

/**
 * Render the settings section body.
 * @param props - the injected read verb.
 * @returns the section content.
 */
export function UsageSection({ fetchUsage }: UsageSectionProps): ReactElement {
  const usage = useUsage(fetchUsage)
  return (
    <div className={css.section}>
      <div className={css.sectionTitle}>OpenCode Go 套餐额度</div>
      <div className={css.sectionIntro}>
        滚动 5 小时(约 $12)、每周($30)、每月($60)。达到上限后可启用 Zen 余额继续,或等窗口重置。
      </div>
      <UsageBody state={usage} onRefresh={usage.refresh} />
    </div>
  )
}
