/**
 * Image-caption settings section: one toggle, vision route pickers filtered
 * to image-capable models, and the failure policy. Pure presentation — every
 * read and write goes through the injected controller.
 */

import { useEffect, type ReactNode } from 'react'
import { updateValue } from './store.ts'
import { ImageCaptionStore } from './store.ts'
import type { ImageCaptionState } from './store.ts'
import type { ImageCaptionKey } from './locales.ts'
import css from './ImageCaptionSection.module.css'

/** Injected dependencies of {@link ImageCaptionSection} (slot `inject`). */
export interface ImageCaptionSectionInjected {
  controller: ImageCaptionStore
  useSnapshot: <T>(selector: (snapshot: ImageCaptionState) => T) => T
  t: (key: ImageCaptionKey) => string
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type ImageCaptionSectionProps = ImageCaptionSectionInjected

/**
 * Render the section.
 * @param props - slot-delivered injected dependencies.
 * @returns the section body.
 */
export function ImageCaptionSection({ controller, useSnapshot, t }: ImageCaptionSectionProps): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  if (state.status === 'idle' || (state.status === 'loading' && state.groups.length === 0)) {
    return <div className={css.loading}>{t('loading')}</div>
  }
  if (state.status === 'error' && state.groups.length === 0) {
    return (
      <div className={css.error}>
        <span>{t('error')}</span>
        <button type="button" onClick={() => { void controller.load() }}>{t('retry')}</button>
      </div>
    )
  }
  const visionModels = (state.groups.find(group => group.id === state.value.provider)?.models ?? [])
    .filter(model => (model.inputModalities ?? []).includes('image'))
  const editable = state.writable && state.value.enabled
  return (
    <div className={css.root}>
      <label className={css.row}>
        <input
          type="checkbox"
          checked={state.value.enabled}
          disabled={!state.writable}
          onChange={(event) => {
            void controller.save(updateValue(state.value, { enabled: event.target.checked }))
          }}
        />
        <span>{t('enabled')}</span>
      </label>
      <label className={css.row}>
        <span className={css.field}>{t('provider')}</span>
        <select
          value={state.value.provider ?? ''}
          disabled={!editable}
          onChange={(event) => {
            void controller.save(updateValue(state.value, { provider: event.target.value === '' ? undefined : event.target.value }))
          }}
        >
          <option value="">{t('noProvider')}</option>
          {state.groups.map(group => (
            <option key={group.id} value={group.id}>{group.name}</option>
          ))}
        </select>
      </label>
      <div className={css.row}>
        <span className={css.field}>{t('model')}</span>
        {visionModels.length === 0
          ? <span className={css.hint}>{t('noVisionModels')}</span>
          : (
            <select
              value={state.value.model ?? ''}
              disabled={!editable}
              onChange={(event) => {
                void controller.save(updateValue(state.value, { model: event.target.value === '' ? undefined : event.target.value }))
              }}
            >
              <option value="">{t('noProvider')}</option>
              {visionModels.map(model => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          )}
      </div>
      <label className={css.row}>
        <span className={css.field}>{t('onError')}</span>
        <select
          value={state.value.onError}
          disabled={!editable}
          onChange={(event) => {
            void controller.save(updateValue(state.value, { onError: event.target.value === 'fail' ? 'fail' : 'placeholder' }))
          }}
        >
          <option value="placeholder">{t('onErrorPlaceholder')}</option>
          <option value="fail">{t('onErrorFail')}</option>
        </select>
      </label>
      {!state.value.enabled && <div className={css.hint}>{t('disabledHint')}</div>}
      {state.error !== null && <div className={css.error}>{state.error}</div>}
    </div>
  )
}
