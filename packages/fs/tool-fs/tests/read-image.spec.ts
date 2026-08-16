/**
 * The `read_image` tool over the REAL local filesystem and attachment store:
 * extension routing, the strict image-modality gate (every refusal arm),
 * durable commit + image-block rendering, attachment admission failures, and
 * the regression that `read` keeps its text-only contract.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import { CallId, LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SettingsProvider, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import type { Config as ToolConfig } from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import {
  applyReadImageTool,
  formatImageReadOutput,
  imageMediaTypeForPath,
  imageRefFromValue,
} from '../src/read-image.ts'
import type { ImageReadValue } from '../src/read-image.ts'

/** 1x1 red PNG (valid signature, IHDR, IDAT). */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
/** 3x3 red PNG used to trip a tiny configured pixel limit. */
const PNG_3X3 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAEElEQVR4nGP4z8AAQQxYWACPjgj4kWPEuQAAAABJRU5ErkJggg==', 'base64')

const testToolSignal = new AbortController().signal

/** Exact-route fake adapter; `stream` is unreachable in these tests. */
class CatalogAdapter extends LlmAdapter {
  constructor(
    private readonly models: LlmModelInfo[],
    private readonly resolvedModels: LlmModelInfo[] = models,
  ) {
    super()
  }

  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const resolved = this.resolvedModels.find(candidate => candidate.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: resolved?.name ?? model,
      ...resolved?.inputModalities === undefined ? {} : { inputModalities: [...resolved.inputModalities] },
    })
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('read_image tests never stream')
  }
}

/**
 * In-memory settings provider, mirroring the shared `MemorySettings` fixture
 * (`packages/settings/settings/tests/memory.ts`), so tests can register the
 * `image-caption` namespace. Only static registration + read is exercised here,
 * so persist is a no-op.
 */
class TestSettings extends SettingsProvider {
  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve({})
  }

  protected persist(): Promise<void> {
    return Promise.resolve()
  }
}

/** Schemastery validation for the `image-caption` namespace as the tests set it. */
const CaptionSchema = z.object({
  provider: z.string(),
  model: z.string(),
  prompt: z.string(),
  maxTokens: z.number(),
  onError: z.union([z.const('placeholder'), z.const('fail')]).default('placeholder'),
  enabled: z.boolean(),
})

/** The caption text a {@link CaptionAdapter} deterministically streams for an image request. */
const CAPTION_TEXT = 'a 1x1 red test image used to verify the read_image caption fallback'

/** Exact-route fake adapter whose `stream` emits one deterministic text block. */
class CaptionAdapter extends LlmAdapter {
  constructor(private readonly caption = CAPTION_TEXT) {
    super()
  }

  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
  }

  override async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = this.caption
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** A `CaptionAdapter` whose stream surfaces as a step error, like `CatalogAdapter`. */
class FailingCaptionAdapter extends LlmAdapter {
  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    return (async function* fail() {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial' }
      throw new Error('vision route unreachable')
    })()
  }
}

/** In-process Code Mode seam fake that invokes the real registry bindings. */
class FakeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fake'
  behavior: (request: CodeRunRequest) => Promise<CodeRunResult> = () => Promise.resolve({ logs: [] })

  run(request: CodeRunRequest): Promise<CodeRunResult> {
    return this.behavior(request)
  }
}

let dir: string
let home: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-read-image-'))
  home = await mkdtemp(join(tmpdir(), 'dsh-read-image-home-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

interface SetupOptions {
  models?: LlmModelInfo[]
  resolvedModels?: LlmModelInfo[]
  attachments?: boolean
  llm?: boolean
  storeConfig?: { maxImageBytes?: number; maxImagePixels?: number; maxMessageImageBytes?: number }
  toolMode?: ToolConfig['mode']
  /**
   * Mount an in-memory settings provider, register the `image-caption`
   * namespace, and register a streaming vision adapter under the `cap`
   * provider. When undefined, no settings service exists (the fallback stays
   * inert and read_image refuses text-only routes as before).
   */
  caption?: {
    enabled?: boolean
    onError?: 'placeholder' | 'fail'
    /** Emit a placeholder instead of {@link CAPTION_TEXT} to simulate a failed stream. */
    fail?: boolean
  }
}

async function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: options.toolMode ?? 'native' })
  if (options.toolMode === 'code' || options.toolMode === 'both') {
    await ctx.plugin(FakeRuntime)
  }
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  await ctx.plugin(FsPolicy)
  if (options.attachments !== false) {
    await ctx.plugin(LocalAttachmentStore, { dshHome: home, ...options.storeConfig })
  }
  if (options.llm !== false) {
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['visual'], new CatalogAdapter(options.models ?? [
      { provider: 'visual', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
      { provider: 'visual', id: 'text-model', name: 'Text', inputModalities: ['text'] },
      { provider: 'visual', id: 'legacy-model', name: 'Legacy' },
    ], options.resolvedModels))
    if (options.caption !== undefined) {
      ctx.llm.registerAdapter(['cap'], options.caption.fail
        ? new FailingCaptionAdapter()
        : new CaptionAdapter())
    }
  }
  if (options.caption !== undefined) {
    await ctx.plugin(TestSettings)
    const settings = ctx.get('settings')
    if (settings === undefined) throw new Error('expected the settings service')
    settings.register(settingsNamespace('image-caption'), CaptionSchema, {
      base: {
        enabled: options.caption.enabled ?? true,
        provider: 'cap',
        model: 'vision',
        ...options.caption.onError === undefined ? {} : { onError: options.caption.onError },
      },
    })
  }
  await ctx.plugin(ToolFs)
  return ctx
}

/** A fake calling agent pinned to one routed provider/model. */
function agentOn(model: string | undefined, provider = 'visual'): object {
  return {
    options: {},
    session: {
      header: { cwd: dir },
      requestHeader: () => (model === undefined ? undefined : { config: { provider, model } }),
      append: () => undefined,
    },
  }
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown, agent?: object) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`img-call-${++callCounter}`),
    name,
    arguments: args,
    ...agent ? { agent: agent as never } : {},
  })
}

function readImage(ctx: Context, args: unknown, agent?: object) {
  return call(ctx, 'read_image', args, agent)
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('imageMediaTypeForPath', () => {
  it('maps the four extensions case-insensitively and rejects everything else', () => {
    expect(imageMediaTypeForPath('a.png')).toBe('image/png')
    expect(imageMediaTypeForPath('a.JPG')).toBe('image/jpeg')
    expect(imageMediaTypeForPath('b.jpeg')).toBe('image/jpeg')
    expect(imageMediaTypeForPath('c.webp')).toBe('image/webp')
    expect(imageMediaTypeForPath('d.Gif')).toBe('image/gif')
    expect(imageMediaTypeForPath('note.txt')).toBeUndefined()
    expect(imageMediaTypeForPath('png')).toBeUndefined()
  })
})

describe('imageRefFromValue', () => {
  it('re-brands with and without the optional display name', () => {
    const base = { attachmentId: 'sha256:00', mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 }
    expect(imageRefFromValue(base)).toEqual(base)
    expect(imageRefFromValue({ ...base, name: 'a.png' })).toEqual({ ...base, name: 'a.png' })
  })
})

describe('read_image happy path', () => {
  it('commits the bytes durably and renders the envelope beside an image block', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup()
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('vision-model'))

    expect(result.isError).toBe(false)
    expect(result.content).toHaveLength(2)
    const image = result.content[1] as { type: string; attachment: ImageAttachmentRef }
    expect(image.type).toBe('image')
    expect(image.attachment.mediaType).toBe('image/png')
    expect(image.attachment.width).toBe(1)
    expect(image.attachment.height).toBe(1)
    expect(image.attachment.bytes).toBe(PNG_1X1.length)
    expect(image.attachment.name).toBe('red.png')
    expect(image.attachment.attachmentId).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(text(result)).toBe(formatImageReadOutput(join(dir, 'red.png'), {
      attachmentId: image.attachment.attachmentId,
      mediaType: 'image/png',
      bytes: PNG_1X1.length,
      width: 1,
      height: 1,
    }))

    // The committed object must read back verbatim through the store.
    const attachments = ctx.get('attachments')
    if (attachments === undefined) throw new Error('expected the attachment service')
    const stored = await attachments.readImage(image.attachment)
    expect(Buffer.from(stored.data)).toEqual(PNG_1X1)
  })

  it('emits fs/observed for the read image', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup()
    const observed: string[] = []
    ctx.on('fs/observed', target => void observed.push(target.displayPath))
    await readImage(ctx, { file_path: 'red.png' }, agentOn('vision-model'))
    expect(observed).toEqual([join(dir, 'red.png')])
  })

  it('falls back to agent options when no request header exists yet', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup()
    const agent = {
      options: { provider: 'visual', model: 'vision-model' },
      session: { header: { cwd: dir }, requestHeader: () => undefined },
    }
    const result = await readImage(ctx, { file_path: 'red.png' }, agent)
    expect(result.isError).toBe(false)
  })

  it('forwards a nested Code Mode image through the outer run_code context', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({ toolMode: 'code' })
    const runtime = ctx.codeRuntime as FakeRuntime
    runtime.behavior = async (request) => {
      const value = await request.bindings[0]!.functions.read_image!({ file_path: 'red.png' })
      return { logs: [], value }
    }

    const result = await call(ctx, RUN_CODE_NAME, {
      code: 'return await tools.read_image({ file_path: "red.png" })',
      description: 'Read the image through Code Mode',
    }, agentOn('vision-model'))

    expect(result.isError).toBe(false)
    expect(result.content.every(block => block.type === 'text')).toBe(true)
    expect(result.additionalContexts).toHaveLength(1)
    const forwarded = result.additionalContexts?.[0]?.content
    expect(forwarded).toHaveLength(2)
    expect(forwarded?.[0]?.type).toBe('text')
    expect(forwarded?.[0]?.type === 'text' ? forwarded[0].text : '').toContain('<type>image</type>')
    expect(forwarded?.[1]).toMatchObject({
      type: 'image',
      attachment: { mediaType: 'image/png', width: 1, height: 1 },
    })
  })
})

describe('read_image caption fallback for text-only routes', () => {
  it('describes the image through the configured vision route and persists the bytes', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({ caption: {} })
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('text-model'))

    expect(result.isError).toBe(false)
    // The model-facing result is two text blocks: the metadata envelope plus
    // the caption — no image block for a text-only main model.
    expect(result.content).toHaveLength(2)
    expect(result.content.every(block => block.type === 'text')).toBe(true)
    const content = text(result)
    expect(content).toContain(formatImageReadOutput(join(dir, 'red.png'), {
      attachmentId: (result.value as unknown as ImageReadValue).image.attachmentId,
      mediaType: 'image/png',
      bytes: PNG_1X1.length,
      width: 1,
      height: 1,
    }))
    expect(content).toContain('The user attached an image to this message. Its content is described below (vision-model generated):')
    expect(content).toContain(CAPTION_TEXT)
    // The canonical value reports the caption next to the durable image ref.
    const value = result.value as unknown as ImageReadValue
    expect(value.caption).toContain(CAPTION_TEXT)

    // The bytes were still committed through the attachment service.
    const attachments = ctx.get('attachments')
    if (attachments === undefined) throw new Error('expected the attachment service')
    const stored = await attachments.readImage(imageRefFromValue(value.image))
    expect(Buffer.from(stored.data)).toEqual(PNG_1X1)
  })

  it('forwards the caption through a nested Code Mode dispatch', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({ toolMode: 'code', caption: {} })
    const runtime = ctx.codeRuntime as FakeRuntime
    runtime.behavior = async (request) => {
      const value = await request.bindings[0]!.functions.read_image!({ file_path: 'red.png' })
      return { logs: [], value }
    }

    const result = await call(ctx, RUN_CODE_NAME, {
      code: 'return await tools.read_image({ file_path: "red.png" })',
      description: 'Read the image through Code Mode',
    }, agentOn('text-model'))

    expect(result.isError).toBe(false)
    expect(result.content.every(block => block.type === 'text')).toBe(true)
    expect(result.additionalContexts).toHaveLength(1)
    const forwarded = result.additionalContexts?.[0]?.content
    expect(forwarded).toHaveLength(2)
    expect(forwarded?.every(block => block.type === 'text')).toBe(true)
    const forwardedText = forwarded?.map(block => block.type === 'text' ? block.text : '').join('')
    expect(forwardedText).toContain(CAPTION_TEXT)
  })

  it.each([
    ['an unregistered namespace', undefined],
    ['a disabled configuration', { enabled: false }],
  ])('refuses on %s', async (_label, captioned) => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup(captioned === undefined ? {} : { caption: captioned })
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('text-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('does not declare image input')
  })

  it('refuses when provider/model are missing from an enabled configuration', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    await ctx.plugin(FsPolicy)
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['visual'], new CatalogAdapter([
      { provider: 'visual', id: 'text-model', name: 'Text', inputModalities: ['text'] },
    ]))
    await ctx.plugin(TestSettings)
    const settings = ctx.get('settings')
    if (settings === undefined) throw new Error('expected the settings service')
    // Enabled but unrouted: no provider/model, so the refus-fallback path rejects.
    settings.register(settingsNamespace('image-caption'), CaptionSchema, { base: { enabled: true } })
    await ctx.plugin(ToolFs)

    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('text-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('does not declare image input')
  })

  it('falls back to the placeholder text when the caption stream fails under onError=placeholder', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({ caption: { fail: true, onError: 'placeholder' } })
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('text-model'))
    expect(result.isError).toBe(false)
    expect(result.content).toHaveLength(2)
    expect(result.content.every(block => block.type === 'text')).toBe(true)
    const content = text(result)
    expect(content).toContain('image recognition failed')
    expect(content).toContain('UNKNOWN')
  })

  it('surfaces the failure as an error result under onError=fail', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({ caption: { fail: true, onError: 'fail' } })
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('text-model'))
    expect(result.isError).toBe(true)
  })

  it('returns the image block itself when an image-capable main model is used even with a caption configured', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({ caption: {} })
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('vision-model'))
    expect(result.isError).toBe(false)
    expect(result.content).toHaveLength(2)
    const image = result.content[1] as { type: string; attachment: ImageAttachmentRef }
    expect(image.type).toBe('image')
    expect((result.value as unknown as ImageReadValue).caption).toBeUndefined()
  })
})

describe('strict image-modality gate', () => {
  it('accepts an exact visual route even when the advisory model catalog omits it', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({
      models: [],
      resolvedModels: [
        { provider: 'visual', id: 'hidden-vision', name: 'Hidden Vision', inputModalities: ['text', 'image'] },
      ],
    })
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('hidden-vision'))
    expect(result.isError).toBe(false)
  })

  it.each([
    ['a text-only model', 'text-model'],
    ['a model without declared modalities', 'legacy-model'],
    ['a model absent from the catalog', 'unknown-model'],
  ])('refuses on %s', async (_label, model) => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup()
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn(model))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('does not declare image input')
  })

  it('refuses when the route cannot be resolved (no agent, or no header and no options)', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup()
    const noAgent = await readImage(ctx, { file_path: 'red.png' })
    expect(noAgent.isError).toBe(true)
    expect(text(noAgent)).toContain('route could not be resolved')

    const noRoute = await readImage(ctx, { file_path: 'red.png' }, agentOn(undefined))
    expect(noRoute.isError).toBe(true)
    expect(text(noRoute)).toContain('route could not be resolved')
  })

  it('refuses when no llm service is mounted', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({ llm: false })
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('vision-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('route could not be resolved')
  })
})

describe('argument and service preconditions', () => {
  it('rejects an empty path and a non-image extension', async () => {
    const ctx = await setup()
    const empty = await readImage(ctx, { file_path: '   ' }, agentOn('vision-model'))
    expect(empty.isError).toBe(true)
    expect(text(empty)).toContain('non-empty')

    const nonImage = await readImage(ctx, { file_path: 'notes.txt' }, agentOn('vision-model'))
    expect(nonImage.isError).toBe(true)
    expect(text(nonImage)).toContain('only accepts PNG/JPEG/WebP/GIF paths')
  })

  it('refuses when no attachment service is mounted', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({ attachments: false })
    expect(ctx.tools.get('read_image')).toBeUndefined()
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('read_image')
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('vision-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unknown tool "read_image"')
  })

  it('defensively refuses execution without an attachment service', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({ attachments: false })
    applyReadImageTool(ctx)
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('vision-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no attachment service is mounted')
  })

  it('refuses a media type the deployment does not accept', async () => {
    /** Store whose deployment accepts JPEG only. */
    class JpegOnlyStore extends AttachmentStore {
      readonly imageLimits: ImageAttachmentLimits = Object.freeze({
        maxImageBytes: 1024,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 1024,
        maxImagePixels: 100,
        mediaTypes: Object.freeze(['image/jpeg'] as const),
      })

      validateImage(_input: SaveImageAttachment): Promise<void> {
        throw new Error('unreachable: admission refuses before validation')
      }

      saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
        throw new Error('unreachable: admission refuses before save')
      }

      readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
        throw new Error('unreachable in this test')
      }
    }
    const ctx = await setup({ attachments: false })
    await ctx.plugin(JpegOnlyStore)
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('vision-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('image/png images are not accepted by this deployment')
  })
})

describe('image admission failures', () => {
  it('explains how to repair a declared/actual media-type mismatch', async () => {
    await writeFile(join(dir, 'wrong.jpg'), PNG_1X1)
    const ctx = await setup()
    const result = await readImage(ctx, { file_path: 'wrong.jpg' }, agentOn('vision-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('the .jpg extension declares image/jpeg')
    expect(text(result)).toContain('rename the file to match its actual format if it is PNG/JPEG/WebP/GIF, or convert it to one of those formats')
  })

  it('fails with FS_TOO_LARGE before reading a file past maxImageBytes', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({ storeConfig: { maxImageBytes: PNG_1X1.length - 1 } })
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('vision-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('exceeds')
  })

  it('honors the tighter per-message aggregate byte bound', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({ storeConfig: { maxMessageImageBytes: PNG_1X1.length - 1 } })
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('vision-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('exceeds')
  })

  it('surfaces the pixel limit from the attachment admission', async () => {
    await writeFile(join(dir, 'big.png'), PNG_3X3)
    const ctx = await setup({ storeConfig: { maxImagePixels: 4 } })
    const result = await readImage(ctx, { file_path: 'big.png' }, agentOn('vision-model'))
    expect(result.isError).toBe(true)
  })

  it('reports a missing image file and a directory target through the fs vocabulary', async () => {
    await mkdir(join(dir, 'folder.png'))
    const ctx = await setup()
    const observed: { path: string; kind: string }[] = []
    ctx.on('fs/observed', (target, observation) => void observed.push({ path: target.displayPath, kind: observation.kind }))
    const missing = await readImage(ctx, { file_path: 'absent.png' }, agentOn('vision-model'))
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('not found')
    expect(observed).toEqual([{ path: join(dir, 'absent.png'), kind: 'absent' }])

    const directory = await readImage(ctx, { file_path: 'folder.png' }, agentOn('vision-model'))
    expect(directory.isError).toBe(true)
    expect(text(directory)).toContain('not a regular file')
  })

  it('omits the display name when the store returns a reference without one', async () => {
    /** Store echoing a fixed nameless reference; deployments may strip names entirely. */
    class NamelessStore extends AttachmentStore {
      readonly imageLimits: ImageAttachmentLimits = Object.freeze({
        maxImageBytes: 1024,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 1024,
        maxImagePixels: 100,
        mediaTypes: Object.freeze(['image/png'] as const),
      })

      validateImage(_input: SaveImageAttachment): Promise<void> {
        return Promise.resolve()
      }

      async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
        return { attachmentId: AttachmentId('sha256:feed'), mediaType: input.mediaType, bytes: input.data.length, width: 1, height: 1 }
      }

      readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
        throw new Error('unreachable in this test')
      }
    }
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({ attachments: false })
    await ctx.plugin(NamelessStore)
    const result = await readImage(ctx, { file_path: 'red.png' }, agentOn('vision-model'))
    expect(result.isError).toBe(false)
    const image = result.content[1] as { attachment: ImageAttachmentRef }
    expect(image.attachment.name).toBeUndefined()
  })
})

describe('registration surface', () => {
  it('withdraws read_image when the tool-fs fiber or the attachment store is disposed (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    await ctx.plugin(FsPolicy)
    const attachmentsFiber = await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const toolFsFiber = await ctx.plugin(ToolFs)
    const names = () => ctx.tools.schemas().map(schema => schema.name).sort()
    expect(names()).toEqual(['edit', 'read', 'read_image', 'write'])

    // Disposing only the attachment store tears down the scoped inject fiber:
    // read_image withdraws while the unconditional tools stay registered.
    await attachmentsFiber.dispose()
    expect(names()).toEqual(['edit', 'read', 'write'])

    // Remounting the store restores the conditional registration.
    const remounted = await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    expect(names()).toEqual(['edit', 'read', 'read_image', 'write'])

    // Disposing the whole plugin withdraws every tool, read_image included.
    await toolFsFiber.dispose()
    expect(names()).toEqual([])
    await remounted.dispose()
  })

  it('declares read_image parallel-safe and presents a read-family card', async () => {
    const ctx = await setup()
    expect(ctx.tools.executionMode({
      signal: testToolSignal, callId: CallId('img-parallel'), name: 'read_image', arguments: { file_path: 'a.png' },
    })).toEqual({ kind: 'parallel' })
    expect(ctx.tools.get('read_image')?.presentCall?.({ file_path: 'shot.png' })).toEqual({
      card: 'generic',
      title: 'Read image shot.png',
      kind: 'read',
      locations: [{ path: 'shot.png' }],
    })
  })
})

describe('read keeps its text-only contract', () => {
  it('still refuses a PNG as a binary file and line-numbers text', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    await writeFile(join(dir, 'note.txt'), 'hello\nworld')
    const ctx = await setup()

    const png = await call(ctx, 'read', { file_path: 'red.png' }, agentOn('vision-model'))
    expect(png.isError).toBe(true)
    expect(text(png)).toContain('binary file')

    const txt = await call(ctx, 'read', { file_path: 'note.txt' }, agentOn('text-model'))
    expect(txt.isError).toBe(false)
    expect(text(txt)).toContain('1: hello')
    expect(text(txt)).toContain('<type>file</type>')
  })
})
