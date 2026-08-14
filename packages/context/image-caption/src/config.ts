/**
 * Configuration for the image-caption plugin. Settings-driven: the cordis row
 * entry seeds the base layer, and the `image-caption` settings namespace
 * overrides it live through the settings seam. Deployment-varying values
 * only — provider and model name the vision route and default nowhere.
 * @module @deepseek-ai/dsh-image-caption/config
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Settings namespace carrying the user-editable caption configuration. */
export const IMAGE_CAPTION_SETTINGS_NAMESPACE = settingsNamespace('image-caption')

/** Model-facing prompt sent with every image being captioned. */
export const DEFAULT_PROMPT = 'Describe this image in complete detail: transcribe any visible text verbatim, describe UI elements, charts, data, and layout. End with a one-sentence summary of what the image is about.'

/** Output token cap for one caption when the deployment names none. */
export const DEFAULT_MAX_TOKENS = 1024

export interface CaptionConfig {
  /** Vision route provider; must be a registered route whose model accepts images. */
  provider?: string
  /** Vision model id served by the provider. */
  model?: string
  /** Prompt sent with every image; defaults to {@link DEFAULT_PROMPT}. */
  prompt?: string
  /** Output token cap for one caption; defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number
  /** What a failed caption does to the proposed step; defaults to `placeholder`. */
  onError?: 'placeholder' | 'fail'
  /** Whether the transform runs at all; defaults to enabled once mounted. */
  enabled?: boolean
  /**
   * Whether to leave image blocks untouched when the main model's route
   * declares image input; defaults to true so a vision main model receives
   * the image itself instead of a lossy caption.
   */
  autoSkipWhenMainModelAcceptsImages?: boolean
}

/** Schemastery validation for {@link CaptionConfig}; invalid values fail the write. */
export const CaptionConfig: z<CaptionConfig> = z.object({
  provider: z.string(),
  model: z.string(),
  prompt: z.string(),
  maxTokens: z.natural().min(64).max(16_384),
  onError: z.union([z.const('placeholder'), z.const('fail')]),
  enabled: z.boolean(),
  autoSkipWhenMainModelAcceptsImages: z.boolean(),
})
