/**
 * OpenCode Go usage UI, browser half: the sidebar-foot indicator with its
 * popover and the settings usage page. Both entries read through the
 * `opencodeUsage` Remote namespace; the Host owns the gateway request.
 * @module @deepseek-ai/dsh-client-ui-opencode-go-usage/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-sidebar and ui-settings SlotMap merges (the two target entries).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { UsageResult } from '@deepseek-ai/dsh-opencode-go-usage/types'
import { FooterUsage } from './FooterUsage.tsx'
import { UsageSection } from './UsageSection.tsx'
import type { OpencodeUsageInjected } from './usage.ts'

/** Required services: the slot registry and the usage Remote namespace. */
export const inject = ['slots', 'remote', 'remote.opencodeUsage']

/**
 * Client plugin body: the sidebar-foot indicator and the settings usage page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const fetchUsage = async (): Promise<UsageResult> => {
    const result: RemoteResult<UsageResult> = await ctx.remote.opencodeUsage.usage()
    if (result.ok) return result.value
    return { ok: false, error: result.error.message }
  }
  const face = (): OpencodeUsageInjected => ({ fetchUsage })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'opencode-go-usage',
    order: 10,
    label: 'Go 套餐额度',
    inject: face,
  }, FooterUsage))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'opencode-go-usage',
    order: 12,
    label: 'Go 套餐额度',
    inject: face,
  }, UsageSection))
}
