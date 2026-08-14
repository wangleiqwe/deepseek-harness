import type { Context } from '@deepseek-ai/cordis'
import { contentHasImage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Deterministic two-mode adapter: captions image-bearing requests, answers text-only ones. */
class ImageCaptionMockAdapter extends LlmAdapter {
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const hasImage = options.messages.some(message => contentHasImage(message.content))
    const text = hasImage
      ? 'a bar chart titled Q3 quarterly revenue with bars 320, 480, and 610'
      : 'ok'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'image-caption-mock-llm'
export const inject = ['llm']

/** Register the test-only `image-caption-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['image-caption-mock'], new ImageCaptionMockAdapter())
}
