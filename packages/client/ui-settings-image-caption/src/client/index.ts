/**
 * Image-caption settings plugin, browser half. It registers the section that
 * visualizes the `image-caption` settings namespace on the settings page.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ImageCaptionSection } from './ImageCaptionSection.tsx'
import type { ImageCaptionSectionInjected } from './ImageCaptionSection.tsx'
import { IMAGE_CAPTION_NS, ImageCaptionStore } from './store.ts'
import { en, zh, type ImageCaptionKey } from './locales.ts'

export type { ImageCaptionKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The image-caption settings section copy. */
    'settings.imageCaption': ImageCaptionKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.imageCaption'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply; registration depends on the slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Register the image-caption section once the `settings.section` declaration
 * is on the ledger, and keep it fresh on every pushed settings invalidation.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-image-caption: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new ImageCaptionStore(connection.api)
  const useSnapshot = bindSnapshotSelector(controller.store)
  const t = ctx.locale.bind(NS) as ImageCaptionSectionInjected['t']
  const injected = (): ImageCaptionSectionInjected => ({
    controller,
    useSnapshot,
    t,
  })

  // A stored change converges every open surface without polling: refetch
  // once the section loaded, so a page opened before the write stays current.
  ctx.effect(() => {
    const refresh = (ns: string): void => {
      if (ns !== IMAGE_CAPTION_NS) return
      if (controller.store.getSnapshot().status !== 'idle') void controller.load()
    }
    const dispose = ctx.remote.$on('settings/document-updated', refresh)
    return () => { dispose() }
  }, 'ui-settings-image-caption: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'image-caption',
    order: 20,
    label: () => t('nav'),
    inject: injected,
  }, ImageCaptionSection))
}
