/**
 * File reference plugin, browser half: registers the '@' file source — a
 * bounded listing of the session workspace walked on the Host, filtered per
 * query, with directory rows marked by a trailing slash and a folder glyph —
 * and the composer file-picker button (`conversation.input.left` seat) whose
 * tree modal multi-selects files and appends the same plain-text `@rel`
 * references to the draft. Plain-text-reference decision (see
 * .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
 * picks insert literal `@rel ` text; the model reads the reference as a
 * workspace-relative path and resolves it with its own file tools. The
 * listing cache is per session with a short TTL so reopens and filter
 * keystrokes do not re-walk the workspace each time.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ClientSessionContext, InputTriggerServiceContract, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and the
// ui-conversation SlotMap entries ('conversation.input.left') into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { FilePickerButton, type FilePickerInjected } from './FilePickerButton.tsx'
import { filterFileCandidates, pickRefText } from './files.ts'
import { insertRefs } from './insert.ts'
import { listingFor } from './listings.ts'
import { en, zh, type FileReferenceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Composer file-picker copy. */
    'file-reference': FileReferenceKey
  }
}

export type { FilePickerInjected, FilePickerProps } from './FilePickerButton.tsx'

/** Locale namespace owned by this plugin. */
const NS = 'file-reference' as const

/** Required services for the source registration and the input-left slot. */
export const inject = ['slots', 'sessions', 'workspaces', 'conversation', 'locale', 'inputTriggers']

/** The '@' file source menu group order: above the subagent references. */
const FILE_SOURCE_ORDER = -1

/**
 * Client plugin body: register the '@' file source and the input-left picker.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-file-reference: dictionaries')

  const source: InputTriggerSource = {
    trigger: '@',
    name: 'file',
    order: FILE_SOURCE_ORDER,
    candidates(session: ClientSessionContext, request) {
      return listingFor(ctx, session.sessionId).then(listing => (
        listing === null ? [] : filterFileCandidates(listing.files, request.query)
          .map(file => ({
            // Directory rows carry a trailing slash so the pick inserts a
            // self-describing reference and the menu tells folders from files.
            name: file.kind === 'directory' ? `${file.rel}/` : file.rel,
            icon: file.kind === 'directory' ? '📁' : '📄',
          }))
      ))
    },
    onPick({ candidate }) {
      // Plain-text reference: the literal lands in the draft and ships to the
      // model verbatim (trailing space closes the token).
      return { text: pickRefText(candidate.name) }
    },
    warm(session: ClientSessionContext) {
      // listingFor never rejects (failures resolve null), so no rejection
      // handler is needed — an unhandled rejection is structurally impossible.
      void listingFor(ctx, session.sessionId)
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'ui-file-reference: @ file source')

  const pickerInjected = (): FilePickerInjected => ({
    listLevel: (path, signal) => ctx.workspaces.listLevel(path, signal),
    insertRefs: (sessionId, rels) => {
      insertRefs(ctx, sessionId, rels)
    },
  })
  ctx.slots.inject(
    'conversation.input.left',
    () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'file-picker',
      locale: NS,
      inject: pickerInjected,
    }, FilePickerButton),
  )
}
