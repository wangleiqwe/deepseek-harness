/**
 * Caption collection and failure handling for one image block. Kept apart from
 * the plugin entry so the invariant companion can import the same durable
 * prefix without pulling the plugin's Config surface.
 * @module @deepseek-ai/dsh-image-caption/caption
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  BlockAssembler,
  createUserMessage,
  LlmError,
  type ContentBlock,
  type ImageBlock,
} from '@deepseek-ai/dsh-llm'
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_PROMPT,
  type CaptionConfig,
} from './config.ts'

/**
 * Fixed model-facing framing prepended to every caption text block: tells the
 * main model that this text stands in for an image the user attached. The
 * invariant companion matches on this exact prefix.
 */
export const CAPTION_PREFIX = 'The user attached an image to this message. Its content is described below (vision-model generated):\n'

/**
 * Run one caption request through the configured vision route and collect its
 * text.
 * @param ctx - plugin context; the LLM service is resolved through it.
 * @param config - provider, model, prompt, and output cap.
 * @param image - the durable image block being captioned.
 * @param signal - the pre-step cancellation signal forwarded to the request.
 * @returns the assembled caption text, trimmed.
 */
export async function collectCaption(
  ctx: Context,
  config: CaptionConfig,
  image: ImageBlock,
  signal: AbortSignal,
): Promise<string> {
  const provider = config.provider
  const model = config.model
  if (provider === undefined || model === undefined) {
    throw new LlmError('image-caption is enabled but no vision route is configured', 'UNCONFIGURED')
  }
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream({
    provider,
    model,
    messages: [createUserMessage({
      source: { kind: 'plugin', plugin: 'image-caption' },
      content: [
        { type: 'image', attachment: image.attachment },
        { type: 'text', text: config.prompt ?? DEFAULT_PROMPT },
      ],
    })],
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    signal,
  })) assembler.push(chunk)
  const finish = assembler.finish
  if (finish.kind === 'error') {
    throw new LlmError(finish.failure.message, finish.failure.code)
  }
  if (finish.kind === 'aborted') {
    throw new LlmError('caption request aborted', 'ABORTED')
  }
  const text = assembler.blocks()
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
  if (text === '') {
    // An empty caption would silently drop the image's meaning from the step.
    throw new LlmError('vision model returned no caption text', 'EMPTY_CAPTION')
  }
  return text
}

/**
 * Caption one image block into its replacement content block.
 * @param ctx - plugin context.
 * @param config - provider, model, prompt, output cap, and failure policy.
 * @param image - the durable image block being captioned.
 * @param signal - the pre-step cancellation signal forwarded to the request.
 * @returns a text block carrying the caption, or the placeholder on failure.
 */
export async function captionBlock(
  ctx: Context,
  config: CaptionConfig,
  image: ImageBlock,
  signal: AbortSignal,
): Promise<ContentBlock> {
  try {
    // Fail per image, not per mount: compositions without an attachments
    // service (headless profiles) never carry image blocks, so the plugin
    // stays inert there and only reports here when a block somehow appears.
    if (ctx.get('attachments') === undefined) {
      throw new LlmError('the attachments service is missing; image bytes cannot be resolved', 'NO_ATTACHMENTS')
    }
    return { type: 'text', text: CAPTION_PREFIX + await collectCaption(ctx, config, image, signal) }
  } catch (error) {
    if ((config.onError ?? 'placeholder') === 'fail') throw error
    const code = error instanceof LlmError ? error.code : 'UNKNOWN'
    return {
      type: 'text',
      text: `(image recognition failed: ${code} — the attached image could not be processed; tell the user.)`,
    }
  }
}
