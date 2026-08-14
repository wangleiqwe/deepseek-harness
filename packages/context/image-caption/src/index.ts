/**
 * Opt-in image captioning for text-only main models. Mounted as an
 * agent-plane row (a preset or home patch layer), configured live through the
 * `image-caption` settings namespace. It rewrites the final
 * `agent/pre-step` batch: every image block in a user message is replaced by
 * a text block carrying a caption from the configured vision route, so a main
 * model that rejects image content still receives what the image says.
 *
 * @module @deepseek-ai/dsh-image-caption
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-attachment'
import {
  contentHasImage,
  type ContentBlock,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { captionBlock } from './caption.ts'
import { CaptionConfig, IMAGE_CAPTION_SETTINGS_NAMESPACE } from './config.ts'
import type { CaptionConfig as CaptionConfigShape } from './config.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'image-caption'

/** The agent registry that owns pre-step processing, plus the LLM service for caption requests. */
export const inject = ['agents', 'llm']

/** Exported shape alias for preset rows, settings, and the invariant companion. */
export type Config = CaptionConfigShape

/**
 * Whether the deployment's default model route declares image input. Best
 * effort: an unresolvable route answers false, and the caption path reports
 * its own failures — the guard only decides whether to stand aside.
 * @param ctx - plugin context; the default-model service is read through it.
 * @param signal - the pre-step cancellation signal forwarded to the lookup.
 * @returns true when the main model can accept images itself.
 */
async function mainModelAcceptsImages(ctx: Context, signal: AbortSignal): Promise<boolean> {
  const selection = ctx.get('agentDefaultModel')?.currentSelection()
  if (selection === undefined) return false
  try {
    const info = await ctx.llm.resolveModelInfo(selection.provider, selection.model, signal)
    return (info.inputModalities ?? []).includes('image')
  } catch {
    return false
  }
}

/**
 * Register the pre-step transform listener for the lifetime of `ctx`.
 * @param ctx - plugin context; the listener is disposed with it.
 * @param config - composition entry seeding the settings base layer.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => CaptionConfigShape = () => config
  // Settings-driven configuration: the entry stays the base, the user layer
  // overrides live, and a stored change re-resolves on the next pre-step.
  installSettingsSection(ctx, IMAGE_CAPTION_SETTINGS_NAMESPACE, CaptionConfig, config, {
    setSource: (source) => { current = source },
    onChange: () => {},
  })
  // prepend + delegate-first means this listener's rewrite lands last in the
  // chain: every other pre-step listener still sees the original messages,
  // and the loop logs exactly the batch this plugin returns.
  ctx.on('agent/pre-step', async ({ signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    const resolved = current()
    if (resolved.enabled === false) return decision
    if (decision.kind === 'reject' || signal.aborted) return decision
    if (!decision.messages.some(message => contentHasImage(message.content))) return decision
    if ((resolved.autoSkipWhenMainModelAcceptsImages ?? true)
      && await mainModelAcceptsImages(ctx, signal)) return decision
    const messages: UserMessage[] = []
    for (const message of decision.messages) {
      if (!contentHasImage(message.content)) {
        messages.push(message)
        continue
      }
      const content: ContentBlock[] = []
      for (const block of message.content) {
        content.push(block.type === 'image' ? await captionBlock(ctx, resolved, block, signal) : block)
      }
      messages.push({ ...message, content })
    }
    return { ...decision, messages }
  }, { prepend: true })
}
