/**
 * The model-facing `read_image` tool: reads a PNG/JPEG/WebP/GIF file, durably
 * commits its bytes through the attachment service (the same lifecycle as a
 * user-uploaded image), and returns an image block so the image enters model
 * context from the next request onward.
 *
 * The route gate is deliberately stricter than the host upload preflight: a
 * tool result enters durable session history, so emitting an image on a route
 * that cannot carry it would break that route's continuation. Unknown
 * capability therefore refuses instead of relying on the adapter guard.
 *
 * When the exact routed model cannot carry images, `read_image` falls back to
 * the configured image-caption vision route: the bytes are still persisted
 * through the attachment service, but the returned model-facing content is a
 * vision-model-generated text description (with a fixed prefix) instead of an
 * image block, so a text-only main model can still work with a local image.
 *
 * The caption request, the framing prefix, the defaults, and the failure
 * placeholder in this module are intentionally self-contained (the fs tool
 * package must not depend on the context image-caption plugin package). They
 * MUST be kept in sync with their counterparts in
 * `packages/context/image-caption/src/{caption,config}.ts`; change them there
 * and here together.
 * @module @deepseek-ai/dsh-tool-fs/src/read-image
 */

import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { BlockAssembler, createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import { resolveRegularReadTarget } from './read-target.ts'

/** Extensions `read_image` accepts; magic-byte validation at the attachment service stays authoritative. */
const IMAGE_EXTENSIONS: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * Fixed model-facing framing prepended to every caption text block: tells the
 * main model that this text stands in for a local image it read. Must match
 * `packages/context/image-caption/src/caption.ts`'s `CAPTION_PREFIX`.
 */
const CAPTION_PREFIX = 'The user attached an image to this message. Its content is described below (vision-model generated):\n'

/**
 * Model-facing prompt sent with every image being captioned. Must match
 * `packages/context/image-caption/src/config.ts`'s `DEFAULT_PROMPT`.
 */
const DEFAULT_PROMPT = 'Describe this image in complete detail: transcribe any visible text verbatim, describe UI elements, charts, data, and layout. End with a one-sentence summary of what the image is about.'

/** Output token cap for one caption when the deployment names none. Must match `DEFAULT_MAX_TOKENS` in the image-caption config. */
const DEFAULT_MAX_TOKENS = 1024

/**
 * Placeholder text returned when a caption fails under `onError: 'placeholder'`.
 * Must match `captionBlock` in the image-caption caption module.
 */
function captionPlaceholder(code: string): string {
  return `(image recognition failed: ${code} — the attached image could not be processed; tell the user.)`
}

/**
 * The deployment-facing subset of the image-caption settings namespace this
 * tool reads. Field names and defaults mirror `CaptionConfig` in
 * `packages/context/image-caption/src/config.ts`.
 */
interface ImageCaptionConfig {
  /** Vision route provider; must be a registered route whose model accepts images. */
  provider?: string
  /** Vision model id served by the provider. */
  model?: string
  /** Prompt sent with every image; defaults to {@link DEFAULT_PROMPT}. */
  prompt?: string
  /** Output token cap for one caption; defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number
  /** What a failed caption does to the tool result; defaults to `placeholder`. */
  onError?: 'placeholder' | 'fail'
  /** Whether the fallback runs at all; only `true` enables it. */
  enabled?: boolean
}

/** The canonical outcome declared by the `read_image` output schema. */
export interface ImageReadValue {
  path: string
  image: {
    attachmentId: string
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name?: string
  }
  /**
   * Present only when the routed main model cannot carry images and an
   * image-caption vision route produced (or defaulted to) a text description.
   * When set, the model-facing result carries this caption text instead of an
   * image block.
   */
  caption?: string
}

/**
 * Map a model-supplied path to its declared image media type by extension.
 * @param filePath - the raw `file_path` argument (not yet resolved).
 * @returns the declared media type, or undefined when the path does not claim an image.
 */
export function imageMediaTypeForPath(filePath: string): ImageMediaType | undefined {
  return IMAGE_EXTENSIONS[extname(filePath).toLowerCase()]
}

/** The outcome of parsing the session's current routed model. */
export interface ResolvedImageRoute {
  /** Normalized provider, or the agent-option provider when no request header config exists. */
  provider: string
  /** Normalized model, or the agent-option model when no request header config exists. */
  model: string
  /** The routed model's declared input modalities; undefined when the catalog omits them. */
  inputModalities: readonly string[] | undefined
}

/**
 * Resolve the session's latest routed provider/model (request header config,
 * then agent options) and its declared input modalities.
 * @param ctx - the plugin context used to resolve the optional `llm` service.
 * @param exec - the tool-execution context supplying the calling agent.
 * @param requestedPath - the raw, not-yet-resolved path rendered in refusal messages.
 * @returns the routed provider, model, and declared input modalities.
 */
export async function resolveImageRoute(ctx: Context, exec: ToolExecution, requestedPath: string): Promise<ResolvedImageRoute> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error(`cannot read "${requestedPath}" as an image: the current model route could not be resolved`)
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  return { provider, model, inputModalities: active.inputModalities }
}

/**
 * Enforce the strict image-capability gate for the calling route. Resolves the
 * session's latest routed provider/model and requires the exact resolved route
 * to declare `image` input explicitly.
 * @param ctx - the plugin context used to resolve the optional `llm` service.
 * @param exec - the tool-execution context supplying the calling agent.
 * @param requestedPath - the raw, not-yet-resolved path rendered in refusal messages.
 */
export async function assertImageCapableRoute(ctx: Context, exec: ToolExecution, requestedPath: string): Promise<void> {
  const { model, inputModalities } = await resolveImageRoute(ctx, exec, requestedPath)
  if (inputModalities === undefined || !inputModalities.includes('image')) {
    throw new Error(`cannot read "${requestedPath}" as an image: model "${model}" does not declare image input; switch to an image-capable model to read images`)
  }
}

/**
 * Run one caption request through the configured vision route and collect its
 * text. Mirrors `collectCaption` in `packages/context/image-caption/src/caption.ts`.
 * @param ctx - plugin context; the LLM service is resolved through it.
 * @param config - provider, model, prompt, and output cap.
 * @param image - the durable image attachment being captioned.
 * @param signal - the tool-execution cancellation signal forwarded to the request.
 * @returns the assembled caption text, trimmed.
 */
async function collectCaption(
  ctx: Context,
  config: ImageCaptionConfig,
  image: ImageAttachmentRef,
  signal: AbortSignal,
): Promise<string> {
  const provider = config.provider
  const model = config.model
  if (provider === undefined || model === undefined) {
    throw new LlmError('image-caption is enabled but no vision route is configured', 'UNCONFIGURED')
  }
  // The `llm` service is resolved through `ctx.get` (not the injected property
  // `ctx.llm`), because the scoped tool context only injects `attachments` and
  // `llm` arrives through the parent scope. `resolveImageRoute` has already
  // guaranteed it is present by the time a caption runs, so a missing service
  // here is an internal invariant rather than a deployment condition.
  const llm = ctx.get('llm')
  if (llm === undefined) {
    throw new LlmError('the llm service is missing; the caption route cannot be called', 'NO_LLM')
  }
  const assembler = new BlockAssembler()
  for await (const chunk of llm.stream({
    provider,
    model,
    messages: [createUserMessage({
      source: { kind: 'plugin', plugin: 'tool-fs' },
      content: [
        { type: 'image', attachment: image },
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
    // An empty caption would silently drop the image's meaning from the result.
    throw new LlmError('vision model returned no caption text', 'EMPTY_CAPTION')
  }
  return text
}

/**
 * Re-brand a canonical image outcome into the durable attachment reference an
 * `ImageBlock` carries.
 * @param image - the canonical image metadata from the output schema.
 * @returns the branded attachment reference.
 */
export function imageRefFromValue(image: ImageReadValue['image']): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

/**
 * Format an image read as the model-facing envelope beside its image block.
 * @param displayPath - the backend-resolved path rendered in the envelope's `<path>` element.
 * @param image - the canonical image metadata to summarize.
 * @returns the model-facing envelope; the image itself rides the adjacent image block.
 */
export function formatImageReadOutput(displayPath: string, image: ImageReadValue['image']): string {
  return `<path>${displayPath}</path>
<type>image</type>
<content>
${image.mediaType} image, ${image.width}x${image.height} px, ${image.bytes} bytes
</content>`
}

/**
 * Project one canonical image read into its model-facing envelope and image,
 * or, when a caption was produced, its envelope and caption text.
 * @param value - the canonical image-read outcome.
 * @returns the two content blocks used by native and nested dispatches.
 */
function imageReadContent(value: ImageReadValue): ContentBlock[] {
  const envelope: ContentBlock = { type: 'text', text: formatImageReadOutput(value.path, value.image) }
  if (value.caption !== undefined) {
    return [
      envelope,
      { type: 'text', text: value.caption },
    ]
  }
  return [
    envelope,
    { type: 'image', attachment: imageRefFromValue(value.image) },
  ]
}

/**
 * Register the `read_image` tool into the given context. The composing plugin
 * owns the attachments gate: `src/index.ts` calls this inside
 * `ctx.inject(['attachments'], …)` so the tool exists only while a durable
 * store is mounted. Execution still re-checks `ctx.get('attachments')` for
 * direct callers and gates on the calling route's declared image input,
 * falling back to the configured image-caption vision route for text-only main
 * models.
 * @param ctx - the registration scope; execution uses its `fs` service plus
 *   the optional `attachments`/`llm`/`settings` services.
 */
export function applyReadImageTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'read_image',
    description: 'Read a PNG/JPEG/WebP/GIF file and return the image itself. When the current model cannot accept image input, returns a text description generated through the configured image recognition vision route.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the image file, resolved by the filesystem backend.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          image: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
          caption: { type: 'string' },
        },
      },
      render: (_args, value) => imageReadContent(value),
    },
    // Content-addressed attachment writes are idempotent, so concurrent reads
    // of the same file cannot conflict.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')

      // Every gate runs before any filesystem I/O so a refusal never leaks
      // partial reads or attachment writes.
      const mediaType = imageMediaTypeForPath(args.file_path)
      if (mediaType === undefined) {
        throw new Error(`cannot read "${args.file_path}": read_image only accepts PNG/JPEG/WebP/GIF paths`)
      }
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error(`cannot read "${args.file_path}" as an image: no attachment service is mounted`)
      }
      if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
        throw new Error(`cannot read "${args.file_path}": ${mediaType} images are not accepted by this deployment`)
      }

      const route = await resolveImageRoute(ctx, exec, args.file_path)
      const imageCapable = route.inputModalities !== undefined && route.inputModalities.includes('image')

      // A text-only main model needs the image-caption fallback. Read the
      // configured vision route now (before any I/O); a missing configuration
      // keeps the strict refusal so a text route's durable history stays free
      // of images it cannot carry.
      let fallback: ImageCaptionConfig | undefined
      if (!imageCapable) {
        const settings = ctx.get('settings')
        const raw = settings?.get(settingsNamespace('image-caption')) as ImageCaptionConfig | undefined
        const provider = raw?.provider
        const model = raw?.model
        if (settings === undefined || raw === undefined || raw.enabled !== true || provider === undefined || model === undefined) {
          throw new Error(`cannot read "${args.file_path}" as an image: model "${route.model}" does not declare image input; switch to an image-capable model to read images`)
        }
        fallback = raw
      }

      const { target, info } = await resolveRegularReadTarget(ctx, exec, args.file_path)

      // The tool result is one message carrying one image, so the per-message
      // aggregate bound applies beside the per-image bound.
      const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
      const data = await ctx.fs.readBytes(target, exec.signal, byteCap)
      // Persist before returning: the image block must reference a durably
      // committed object by the time the tool/result event is appended.
      let ref: ImageAttachmentRef
      try {
        ref = await attachments.saveImage({ data, mediaType, name: basename(target.displayPath) })
      } catch (error: unknown) {
        if (!(error instanceof AttachmentError) || error.code !== 'IMAGE_TYPE_MISMATCH') throw error
        const extension = extname(target.displayPath).toLowerCase()
        throw new Error(
          `cannot read "${target.displayPath}": the ${extension} extension declares ${mediaType}, but the bytes use a different image format; rename the file to match its actual format if it is PNG/JPEG/WebP/GIF, or convert it to one of those formats`,
          { cause: error },
        )
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      const value: ImageReadValue = {
        path: target.displayPath,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...ref.name === undefined ? {} : { name: ref.name },
        },
      }
      if (!imageCapable && fallback !== undefined) {
        const image = imageRefFromValue(value.image)
        try {
          const text = CAPTION_PREFIX + await collectCaption(ctx, fallback, image, exec.signal)
          value.caption = text
        } catch (error) {
          if ((fallback.onError ?? 'placeholder') === 'fail') throw error
          const code = error instanceof LlmError ? error.code : 'UNKNOWN'
          value.caption = captionPlaceholder(code)
        }
      }
      if (exec.parent !== undefined) {
        exec.deferContext(createUserMessage({
          content: imageReadContent(value),
          source: { kind: 'plugin', plugin: 'tool-fs' },
        }))
      }
      return value
    },
    // Pure display: a generic card in the read family with a follow-along
    // location on the image file.
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Read image ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}
