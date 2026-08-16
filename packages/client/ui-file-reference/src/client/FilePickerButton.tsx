/**
 * Composer file-picker button and multi-select modal (`conversation.input.left`
 * seat): opens a modal over the session workspace's directory tree — folders
 * expand and collapse in place, each level lazily loaded through the host's
 * one-level listing — plus a path editor that jumps to any other directory
 * (rows outside the workspace root reference by absolute path). Multi-selects
 * file rows and appends the picked `@rel` references to the draft
 * (plain-text reference, same vocabulary as the '@' file source). Pure
 * presentation: the level listing and the draft write arrive through the
 * injected face; the workspace root resolves from the global workspaces feed.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconFolderClose16,
  IconFolderOpen16,
  IconPaperclipOutline16,
  Modal,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileEntry, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap entry ('conversation.input.left',
// whose owner share supplies `session`/`input`) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { relOrAbsolute, workspaceRootFor } from './files.ts'
import css from './FilePickerButton.module.css'

/** Injected callbacks: the one-level listing and the draft write. */
export interface FilePickerInjected {
  /**
   * List one directory level (files and directories), bounded.
   * @param path - fully qualified directory to list.
   * @param signal - aborts the wire request when the modal closes or is superseded.
   * @returns the level's entries, name-sorted.
   */
  listLevel: (path: string, signal?: AbortSignal) => Promise<{ readonly entries: readonly FileEntry[]; readonly truncated: boolean }>
  /**
   * Append plain-text `@rel` references to the session's draft.
   * @param sessionId - session whose draft receives the references.
   * @param rels - reference texts (workspace-relative or absolute).
   */
  insertRefs: (sessionId: SessionId, rels: readonly string[]) => void
}

/**
 * Full picker props: the runtime share (the `conversation.input.left` owner
 * currency — `session`/`input` — plus the standard kit) + injected face +
 * locale seat.
 */
export type FilePickerProps = PropsRuntime<'conversation.input.left'>
  & InjectFace<FilePickerInjected> & PropsLocale<'file-reference'>

/** Load phases of the modal's base directory. */
type LoadPhase = 'idle' | 'loading' | 'ready' | 'error'

/** One loaded tree level: the rows shown under one directory. */
interface LevelState {
  readonly phase: 'loading' | 'ready'
  readonly entries: readonly FileEntry[]
  readonly truncated: boolean
}

/**
 * Render the picker button and its modal.
 * @param props - composed slot props.
 * @returns the tool-row button plus the modal while open.
 */
export function FilePickerButton({
  session, input, useWorkspaces, listLevel, insertRefs, t,
}: FilePickerProps) {
  const workspaces = useWorkspaces(state => state.items)
  // An ungrouped session has no workspace root to list; the seat renders
  // nothing rather than a dead control.
  const workspaceRoot = workspaceRootFor(workspaces, session.sessionId)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<LoadPhase>('idle')
  const [errorKind, setErrorKind] = useState<'unreadable' | 'no-workspace' | null>(null)
  // The browsed directory and the workspace root its relative spellings are
  // taken from, both captured when the modal opens.
  const [base, setBase] = useState('')
  const [root, setRoot] = useState('')
  const [levels, setLevels] = useState<ReadonlyMap<string, LevelState>>(new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const [pathText, setPathText] = useState('')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<readonly string[]>([])
  const controllerRef = useRef<AbortController | null>(null)

  const close = () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setOpen(false)
  }
  useEffect(() => () => { controllerRef.current?.abort() }, [])

  const openPicker = () => {
    const controller = new AbortController()
    controllerRef.current = controller
    setOpen(true)
    setSelected([])
    setFilter('')
    setExpanded(new Set())
    setFailed(new Set())
    setLevels(new Map())
    if (workspaceRoot === undefined) {
      setErrorKind('no-workspace')
      setPhase('error')
      return
    }
    setBase(workspaceRoot)
    setRoot(workspaceRoot)
    setPathText(workspaceRoot)
    setPhase('loading')
    loadLevel(workspaceRoot, true)
  }

  /** Load one level into the tree; a base-level failure surfaces the modal error. */
  const loadLevel = (dir: string, isBase: boolean) => {
    const controller = controllerRef.current
    /* v8 ignore next -- loadLevel only runs while the modal is open, so the guard is defensive. */
    if (controller === null) return
    setLevels(previous => new Map(previous).set(dir, { phase: 'loading', entries: [], truncated: false }))
    listLevel(dir, controller.signal).then((level) => {
      if (controller.signal.aborted) return
      setLevels(previous => new Map(previous).set(dir, { phase: 'ready', entries: level.entries, truncated: level.truncated }))
      setFailed((previous) => {
        if (!previous.has(dir)) return previous
        const next = new Set(previous)
        next.delete(dir)
        return next
      })
      if (isBase) {
        setErrorKind(null)
        setPhase('ready')
      }
    }).catch(() => {
      if (controller.signal.aborted) return
      // The failure removes the loading entry and any expansion: the level
      // was set (or kept) by this load, so the delete always applies.
      setLevels((previous) => {
        const next = new Map(previous)
        next.delete(dir)
        return next
      })
      // A failed folder reverts to collapsed: the next click on its row
      // retries the load instead of collapsing an empty expansion.
      setExpanded((previous) => {
        const next = new Set(previous)
        next.delete(dir)
        return next
      })
      setFailed(previous => new Set(previous).add(dir))
      if (isBase) {
        setErrorKind('unreadable')
        setPhase('error')
      }
    })
  }

  /** Jump the browsed base directory to an explicit path (the path editor). */
  const jumpTo = (raw: string) => {
    const path = raw.trim()
    /* v8 ignore next -- the path editor's Enter on a blank value is a no-op by design. */
    if (path === '') return
    setBase(path)
    setPathText(path)
    setExpanded(new Set())
    setFailed(new Set())
    setPhase('loading')
    loadLevel(path, true)
  }

  /** Expand or collapse one directory row, loading its level on first expand. */
  const toggleDir = (dir: string) => {
    if (expanded.has(dir)) {
      setExpanded((previous) => {
        const next = new Set(previous)
        next.delete(dir)
        return next
      })
      return
    }
    setExpanded(previous => new Set(previous).add(dir))
    if (!levels.has(dir)) loadLevel(dir, false)
  }

  const toggle = (ref: string) => {
    setSelected(previous => previous.includes(ref)
      ? previous.filter(candidate => candidate !== ref)
      : [...previous, ref])
  }

  const confirm = () => {
    /* v8 ignore next -- the confirm button is disabled whenever this guard would fail; the guard is defensive. */
    if (selected.length === 0 || phase !== 'ready') return
    insertRefs(session.sessionId, selected)
    close()
  }

  const needle = filter.trim().toLowerCase()
  const matches = (name: string): boolean => needle === '' || name.toLowerCase().includes(needle)

  /** Whether an expanded directory's subtree holds any row matching the filter (keeps ancestor rows visible). */
  const hasVisibleDescendant = (dir: string): boolean => {
    const level = levels.get(dir)
    if (level === undefined || level.phase !== 'ready') return false
    return level.entries.some(entry => entry.kind === 'directory'
      ? matches(entry.name) || hasVisibleDescendant(entry.path)
      : matches(entry.name))
  }

  /** Append one level's rows (files, expandable folders, per-level truncation note) to the row buffer. */
  const renderLevel = (dir: string, depth: number, rows: ReactNode[]) => {
    const level = levels.get(dir)
    if (level === undefined || level.phase !== 'ready') return
    for (const entry of level.entries) {
      if (entry.kind === 'directory') {
        const isOpen = expanded.has(entry.path)
        if (!matches(entry.name) && !(isOpen && hasVisibleDescendant(entry.path))) continue
        const loading = levels.get(entry.path)?.phase === 'loading'
        const isFailed = failed.has(entry.path)
        rows.push(
          <div key={entry.path} className={css.row} style={{ paddingLeft: `${8 + depth * 16}px` }}>
            <button
              type="button"
              className={css.dir}
              aria-expanded={isOpen}
              aria-label={t(isOpen ? 'picker.collapse' : 'picker.expand', { name: entry.name })}
              onClick={() => { toggleDir(entry.path) }}
            >
              {isOpen ? <IconFolderOpen16 size={14} /> : <IconFolderClose16 size={14} />}
              {isOpen ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
              <span className={css.name}>{entry.name}</span>
            </button>
            {loading && <span className={css.statusInline}>{t('picker.dirLoading')}</span>}
            {isFailed && <span className={css.statusInlineError}>{t('picker.dirError')}</span>}
          </div>,
        )
        if (isOpen) renderLevel(entry.path, depth + 1, rows)
      } else {
        if (!matches(entry.name)) continue
        const ref = relOrAbsolute(entry.path, root)
        rows.push(
          <label key={entry.path} className={css.row} style={{ paddingLeft: `${8 + depth * 16}px` }}>
            <input
              type="checkbox"
              className={css.checkbox}
              checked={selected.includes(ref)}
              onChange={() => { toggle(ref) }}
            />
            <span className={css.name} title={entry.path}>{entry.name}</span>
          </label>,
        )
      }
    }
    if (level.truncated) {
      rows.push(
        <div key={`${dir}:truncated`} className={css.status} style={{ paddingLeft: `${8 + depth * 16}px` }}>
          {t('picker.truncated', { n: level.entries.length })}
        </div>,
      )
    }
  }

  const rows: ReactNode[] = []
  if (phase === 'ready') renderLevel(base, 0, rows)

  return (
    <>
      <Tooltip label={t('picker.open')} side="bottom" delayMs={500}>
        <button
          type="button"
          className={css.button}
          aria-label={t('picker.open')}
          disabled={input.phase !== 'plain'}
          onClick={openPicker}
        >
          <IconPaperclipOutline16 />
        </button>
      </Tooltip>
      <Modal
        open={open}
        onClose={close}
        closeLabel={t('picker.cancel')}
        title={t('picker.title')}
        footer={(
          <>
            <Button variant="outline" onClick={close}>{t('picker.cancel')}</Button>
            <Button
              variant="primary"
              disabled={selected.length === 0 || phase !== 'ready'}
              onClick={confirm}
            >
              {t('picker.confirm')}
            </Button>
          </>
        )}
      >
        <div className={css.body}>
          {phase === 'loading' && <div className={css.status} role="status">{t('picker.loading')}</div>}
          {phase === 'error' && (
            <div className={css.statusError} role="alert">
              {errorKind === 'no-workspace' ? t('picker.noWorkspace') : t('picker.error')}
            </div>
          )}
          {/* The path editor stays reachable through a base-level failure so
              the typed directory can be corrected without reopening. */}
          {(phase === 'loading' || phase === 'ready' || (phase === 'error' && errorKind !== 'no-workspace')) && (
            <div className={css.pathRow}>
              <input
                className={css.path}
                type="text"
                value={pathText}
                aria-label={t('picker.path')}
                placeholder={t('picker.path')}
                onChange={(event) => { setPathText(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter') jumpTo(pathText) }}
              />
              <Button variant="outline" onClick={() => { jumpTo(root) }} disabled={base === root}>
                {t('picker.workspace')}
              </Button>
            </div>
          )}
          {phase === 'ready' && (
            <>
              <input
                className={css.filter}
                type="text"
                value={filter}
                placeholder={t('picker.filter')}
                aria-label={t('picker.filter')}
                onChange={(event) => { setFilter(event.target.value) }}
              />
              {rows.length === 0 && <div className={css.status}>{t('picker.empty')}</div>}
              {rows.length > 0 && (
                <div className={css.list} role="group" aria-label={t('picker.title')}>
                  {rows}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
