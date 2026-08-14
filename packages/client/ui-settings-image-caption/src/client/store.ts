/**
 * Image-caption settings store: one snapshot joining the model catalog
 * (`llm.models`) and the `image-caption` settings namespace. The host stays
 * the single fact source — every mutation writes through the wire and the
 * section re-renders from the next describe, pushed or refetched.
 */

import type {
  IApiClient,
  ModelProviderGroup,
  SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Settings namespace this section owns in the user layer. */
export const IMAGE_CAPTION_NS = 'image-caption'

/** The four fields the section edits; prompt/maxTokens stay file-configured. */
export interface ImageCaptionValue {
  /** Whether the transform runs at all. */
  enabled: boolean
  /** Vision route provider; absent falls back to the composition entry. */
  provider?: string
  /** Vision model id; absent falls back to the composition entry. */
  model?: string
  /** What a failed caption does to the proposed step. */
  onError: 'placeholder' | 'fail'
}

/** Page snapshot. */
export interface ImageCaptionState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load or write failure text. */
  error: string | null
  /** Whether the settings provider accepts writes. */
  writable: boolean
  /** The namespace view, once the host exposes it. */
  view: SettingsNamespaceView | undefined
  /** Successfully loaded provider groups for the pickers. */
  groups: readonly ModelProviderGroup[]
  /** Resolved user-facing value. */
  value: ImageCaptionValue
}

/** Read the resolved section from a namespace view with the code defaults. */
function valueOf(view: SettingsNamespaceView | undefined): ImageCaptionValue {
  const raw = view?.value as {
    enabled?: unknown
    provider?: unknown
    model?: unknown
    onError?: unknown
  } | undefined
  const provider = typeof raw?.provider === 'string' ? raw.provider : undefined
  const model = typeof raw?.model === 'string' ? raw.model : undefined
  return {
    enabled: raw?.enabled !== false,
    onError: raw?.onError === 'fail' ? 'fail' : 'placeholder',
    ...provider === undefined ? {} : { provider },
    ...model === undefined ? {} : { model },
  }
}

/**
 * Render the user-layer section for one write: the four UI-owned fields only,
 * so omitting a route name restores the composition entry's base value.
 * @param value - the current user-facing value.
 * @returns the plain section object sent to settings.replace.
 */
export function userSectionOf(value: ImageCaptionValue): Record<string, unknown> {
  return {
    enabled: value.enabled,
    onError: value.onError,
    ...value.provider === undefined ? {} : { provider: value.provider },
    ...value.model === undefined ? {} : { model: value.model },
  }
}

/**
 * Merge one control change into the current value, omitting cleared route
 * names so the composition entry's base value resurfaces on the host.
 * @param current - the value being edited.
 * @param patch - changed fields; an explicit undefined clears that field.
 * @returns the merged value.
 */
export function updateValue(
  current: ImageCaptionValue,
  patch: {
    enabled?: boolean
    provider?: string | undefined
    model?: string | undefined
    onError?: 'placeholder' | 'fail'
  },
): ImageCaptionValue {
  const enabled = patch.enabled ?? current.enabled
  const provider = 'provider' in patch ? patch.provider : current.provider
  const model = 'model' in patch ? patch.model : current.model
  const onError = patch.onError ?? current.onError
  return {
    enabled,
    onError,
    ...provider === undefined ? {} : { provider },
    ...model === undefined ? {} : { model },
  }
}

/** The image-caption settings section controller (one per settings surface). */
export class ImageCaptionStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<ImageCaptionState> = createSnapshotStore<ImageCaptionState>({
    status: 'idle', error: null, writable: false, view: undefined, groups: [], value: valueOf(undefined),
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the wire face (settings and llm domains).
   */
  constructor(private readonly api: Pick<IApiClient, 'settings' | 'llm'>) {}

  /**
   * Refresh the section snapshot: settings describe and model catalog in
   * parallel. A failure keeps the last good value and surfaces the error.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    let views: SettingsNamespaceView[]
    let groups: ModelProviderGroup[]
    let writable: boolean
    try {
      const [settingsResponse, modelsResponse] = await Promise.all([
        this.api.settings.describe({}),
        this.api.llm.models({}),
      ])
      if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message)
      if (!modelsResponse.result.ok) throw new Error(modelsResponse.result.error.message)
      writable = settingsResponse.result.value.writable
      views = settingsResponse.result.value.namespaces
      groups = modelsResponse.result.value.groups
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = error instanceof Error ? error.message : String(error)
      })
      return
    }
    if (generation !== this.generation) return
    const view = views.find(candidate => candidate.ns === IMAGE_CAPTION_NS)
    this.store.update((s) => {
      s.status = 'ready'
      s.error = null
      s.writable = writable
      s.view = view
      s.groups = groups
      s.value = valueOf(view)
    })
  }

  /**
   * Replace the namespace's user layer with the four UI-owned fields, then
   * refetch the snapshot from the host's answer.
   * @param value - the complete user-facing value to store.
   * @returns nothing; failures land in the snapshot error.
   */
  async save(value: ImageCaptionValue): Promise<void> {
    const view = this.store.getSnapshot().view
    try {
      const response = await this.api.settings.replace({
        ns: IMAGE_CAPTION_NS,
        section: userSectionOf(value),
        ...view === undefined ? {} : { expectedRevision: view.revision },
      })
      if (!response.result.ok) throw new Error(response.result.error.message)
    } catch (error) {
      this.store.update((s) => { s.error = error instanceof Error ? error.message : String(error) })
      return
    }
    await this.load()
  }
}
