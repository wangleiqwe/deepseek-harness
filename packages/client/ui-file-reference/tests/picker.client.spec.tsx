// @vitest-environment jsdom
/**
 * FilePickerButton rendering spec, props-direct: the button renders in the
 * tool row (disabled outside the plain input phase); the modal browses the
 * session workspace as a directory tree — folders expand and collapse with
 * lazy level loads, the path editor jumps to any other directory (rows there
 * reference by absolute path), the workspace button returns to the root —
 * and multi-select appends the picked references through the injected face.
 * The loading/empty/truncated/error/no-workspace states each carry their
 * surface.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { FileEntry, SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import { FilePickerButton, type FilePickerInjected } from '../src/client/FilePickerButton.tsx'
import { zh } from '../src/client/locales.ts'

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

const entry = (name: string, kind: 'file' | 'directory' = 'file', path?: string): FileEntry =>
  ({ name, path: path ?? `/w/${name}`, kind, hidden: false })

/** The fixture tree browsed by the modal. */
const LEVELS: Record<string, readonly FileEntry[]> = {
  '/w': [entry('package.json'), entry('src', 'directory'), entry('docs', 'directory')],
  '/w/src': [entry('lib', 'directory', '/w/src/lib'), entry('a.ts', 'file', '/w/src/a.ts'), entry('b.ts', 'file', '/w/src/b.ts')],
  '/w/src/lib': [entry('deep.ts', 'file', '/w/src/lib/deep.ts')],
  '/w/docs': [entry('guide.md', 'file', '/w/docs/guide.md')],
  '/other': [entry('x.ts', 'file', '/other/x.ts')],
}

const WORKSPACE: WorkspaceView = {
  workspaceId: wid('w1'),
  path: '/w',
  title: 'w',
  sessionIds: [sid('s1')],
  createdAt: 't',
  updatedAt: 't',
}

type LevelResult = { entries: readonly FileEntry[]; truncated: boolean }

/** The composed props, stubbed: framework hooks are plain functions, the
 * injected face is the fixture's own vi.fn pair. */
function props(partial: Partial<{
  phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  items: readonly WorkspaceView[]
  truncatedPaths: readonly string[]
  listLevel: (path: string, signal?: AbortSignal) => Promise<LevelResult>
  insertRefs: FilePickerInjected['insertRefs']
}>) {
  const listLevel = partial.listLevel ?? vi.fn(async (path: string): Promise<LevelResult> => ({
    entries: LEVELS[path] ?? [],
    truncated: (partial.truncatedPaths ?? []).includes(path),
  }))
  const insertRefs = partial.insertRefs ?? vi.fn()
  return {
    session: { sessionId: sid('s1') } as never,
    input: { phase: partial.phase ?? 'plain' } as never,
    sessionId: sid('s1'),
    useSession: (() => undefined) as never,
    useProjection: (() => undefined) as never,
    useInput: (() => undefined) as never,
    inputActions: {} as never,
    useWorkspaces: ((selector: (state: { items: readonly WorkspaceView[] }) => unknown) =>
      selector({ items: partial.items ?? [WORKSPACE] })) as never,
    useSessions: (() => undefined) as never,
    listLevel,
    insertRefs,
    t: makeTranslate(zh, commonZh),
  }
}

afterEach(() => {
  cleanup()
})

describe('FilePickerButton', () => {
  it('renders the tool-row button with its accessible name', () => {
    render(<FilePickerButton {...props({})} />)
    expect(screen.getByRole('button', { name: zh['picker.open'] })).not.toBeNull()
  })

  it('disables the button outside the plain input phase', () => {
    const view = render(<FilePickerButton {...props({ phase: 'submitting' })} />)
    const button = view.getByRole('button', { name: zh['picker.open'] })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens the modal over the workspace root: file rows and collapsed folders', async () => {
    const pickerProps = props({})
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => {
      expect(pickerProps.listLevel).toHaveBeenCalledWith('/w', expect.any(AbortSignal))
    })
    expect(screen.getByRole('group', { name: zh['picker.title'] })).not.toBeNull()
    expect(screen.getByText('package.json')).not.toBeNull()
    const src = screen.getByRole('button', { name: zh['picker.expand'].replace('{name}', 'src') })
    expect(src.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: zh['picker.expand'].replace('{name}', 'docs') })).not.toBeNull()
    // Folder contents are not listed until expanded.
    expect(screen.queryByText('a.ts')).toBeNull()
    // The path editor shows the root and the workspace button is a no-op there.
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: zh['picker.path'] }).value).toBe('/w')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['picker.workspace'] }).disabled).toBe(true)
  })

  it('expands a folder, shows its loading hint, then its rows', async () => {
    let settle!: (result: LevelResult) => void
    const deferred = new Promise<LevelResult>((resolve) => { settle = resolve })
    const listLevel = vi.fn(async (path: string) => (path === '/w/src' ? deferred : { entries: LEVELS[path] ?? [], truncated: false }))
    const pickerProps = props({ listLevel })
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => { expect(listLevel).toHaveBeenCalledWith('/w', expect.any(AbortSignal)) })
    fireEvent.click(screen.getByRole('button', { name: zh['picker.expand'].replace('{name}', 'src') }))
    expect(listLevel).toHaveBeenCalledWith('/w/src', expect.any(AbortSignal))
    expect(screen.getByText(zh['picker.dirLoading'])).not.toBeNull()
    settle({ entries: LEVELS['/w/src'] ?? [], truncated: false })
    await waitFor(() => {
      expect(screen.getByText('a.ts')).not.toBeNull()
    })
    const src = screen.getByRole('button', { name: zh['picker.collapse'].replace('{name}', 'src') })
    expect(src.getAttribute('aria-expanded')).toBe('true')
  })

  it('collapses a folder, hides its rows, and re-expands from the cached level', async () => {
    const pickerProps = props({})
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => { expect(screen.getByText('package.json')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: zh['picker.expand'].replace('{name}', 'src') }))
    await waitFor(() => { expect(screen.getByText('a.ts')).not.toBeNull() })
    expect(pickerProps.listLevel).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: zh['picker.collapse'].replace('{name}', 'src') }))
    await waitFor(() => {
      expect(screen.queryByText('a.ts')).toBeNull()
    })
    // Re-expanding a folder whose level is already loaded does not re-walk.
    fireEvent.click(screen.getByRole('button', { name: zh['picker.expand'].replace('{name}', 'src') }))
    await waitFor(() => {
      expect(screen.getByText('a.ts')).not.toBeNull()
    })
    expect(pickerProps.listLevel).toHaveBeenCalledTimes(2)
  })

  it('reports a folder read failure and retries the load on the next click', async () => {
    const listLevel = vi.fn(async (path: string) => {
      if (path === '/w/src') throw new Error('boom')
      return { entries: LEVELS[path] ?? [], truncated: false }
    })
    const pickerProps = props({ listLevel })
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => { expect(screen.getByText('package.json')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: zh['picker.expand'].replace('{name}', 'src') }))
    await waitFor(() => {
      expect(screen.getByText(zh['picker.dirError'])).not.toBeNull()
    })
    // A failed folder is not expanded; clicking again retries the load.
    listLevel.mockImplementation(async (path: string) => ({ entries: LEVELS[path] ?? [], truncated: false }))
    fireEvent.click(screen.getByRole('button', { name: zh['picker.expand'].replace('{name}', 'src') }))
    await waitFor(() => {
      expect(screen.getByText('a.ts')).not.toBeNull()
    })
    expect(screen.queryByText(zh['picker.dirError'])).toBeNull()
  })

  it('multi-selects root and expanded rows, then inserts root-relative references', async () => {
    const insertRefs = vi.fn()
    const pickerProps = props({ insertRefs })
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => { expect(screen.getByText('package.json')).not.toBeNull() })
    fireEvent.click(screen.getByText('package.json'))
    fireEvent.click(screen.getByRole('button', { name: zh['picker.expand'].replace('{name}', 'src') }))
    await waitFor(() => { expect(screen.getByText('a.ts')).not.toBeNull() })
    fireEvent.click(screen.getByText('a.ts'))
    const confirm = screen.getByRole('button', { name: zh['picker.confirm'] }) as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(insertRefs).toHaveBeenCalledWith(sid('s1'), ['package.json', 'src/a.ts'])
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: zh['picker.title'] })).toBeNull()
    })
  })

  it('toggling a row off removes it from the selection', async () => {
    const pickerProps = props({})
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => { expect(screen.getByText('package.json')).not.toBeNull() })
    fireEvent.click(screen.getByText('package.json'))
    fireEvent.click(screen.getByText('package.json'))
    const confirm = screen.getByRole('button', { name: zh['picker.confirm'] }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
  })

  it('jumps to another directory through the path editor and inserts absolute references', async () => {
    const insertRefs = vi.fn()
    const pickerProps = props({ insertRefs })
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => { expect(screen.getByText('package.json')).not.toBeNull() })
    const pathInput = screen.getByRole('textbox', { name: zh['picker.path'] })
    fireEvent.change(pathInput, { target: { value: '/other' } })
    // A non-Enter key just edits the field; only Enter jumps.
    fireEvent.keyDown(pathInput, { key: 'a' })
    expect(screen.getByText('package.json')).not.toBeNull()
    fireEvent.keyDown(pathInput, { key: 'Enter' })
    await waitFor(() => {
      expect(screen.getByText('x.ts')).not.toBeNull()
    })
    expect(screen.queryByText('package.json')).toBeNull()
    fireEvent.click(screen.getByText('x.ts'))
    fireEvent.click(screen.getByRole('button', { name: zh['picker.confirm'] }))
    expect(insertRefs).toHaveBeenCalledWith(sid('s1'), ['/other/x.ts'])
  })

  it('returns to the workspace root with the workspace button', async () => {
    const pickerProps = props({})
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => { expect(screen.getByText('package.json')).not.toBeNull() })
    fireEvent.change(screen.getByRole('textbox', { name: zh['picker.path'] }), { target: { value: '/other' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: zh['picker.path'] }), { key: 'Enter' })
    await waitFor(() => { expect(screen.getByText('x.ts')).not.toBeNull() })
    const workspaceButton = screen.getByRole('button', { name: zh['picker.workspace'] }) as HTMLButtonElement
    expect(workspaceButton.disabled).toBe(false)
    fireEvent.click(workspaceButton)
    await waitFor(() => {
      expect(screen.getByText('package.json')).not.toBeNull()
    })
    expect(screen.queryByText('x.ts')).toBeNull()
  })

  it('filters rows by name and keeps ancestor folders with matching descendants', async () => {
    const pickerProps = props({})
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => { expect(screen.getByText('package.json')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: zh['picker.expand'].replace('{name}', 'src') }))
    await waitFor(() => { expect(screen.getByText('a.ts')).not.toBeNull() })
    fireEvent.change(screen.getByRole('textbox', { name: zh['picker.filter'] }), { target: { value: 'a.ts' } })
    expect(screen.queryByText('package.json')).toBeNull()
    expect(screen.queryByText('docs')).toBeNull()
    expect(screen.getByText('src')).not.toBeNull()
    expect(screen.getByText('a.ts')).not.toBeNull()
    expect(screen.queryByText('b.ts')).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: zh['picker.filter'] }), { target: { value: 'zzz' } })
    expect(screen.getByText(zh['picker.empty'])).not.toBeNull()
  })

  it('keeps a nested folder chain visible when a descendant matches', async () => {
    const pickerProps = props({})
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => { expect(screen.getByText('package.json')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: zh['picker.expand'].replace('{name}', 'src') }))
    await waitFor(() => { expect(screen.getByText('lib')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: zh['picker.expand'].replace('{name}', 'lib') }))
    await waitFor(() => { expect(screen.getByText('deep.ts')).not.toBeNull() })
    fireEvent.change(screen.getByRole('textbox', { name: zh['picker.filter'] }), { target: { value: 'deep' } })
    expect(screen.getByText('src')).not.toBeNull()
    expect(screen.getByText('lib')).not.toBeNull()
    expect(screen.getByText('deep.ts')).not.toBeNull()
    expect(screen.queryByText('a.ts')).toBeNull()
  })

  it('hides an unloaded folder under a filter and reveals it once its level settles', async () => {
    let settle!: (result: LevelResult) => void
    const deferred = new Promise<LevelResult>((resolve) => { settle = resolve })
    const listLevel = vi.fn(async (path: string) => (path === '/w/src' ? deferred : { entries: LEVELS[path] ?? [], truncated: false }))
    const pickerProps = props({ listLevel })
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => { expect(screen.getByText('package.json')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: zh['picker.expand'].replace('{name}', 'src') }))
    fireEvent.change(screen.getByRole('textbox', { name: zh['picker.filter'] }), { target: { value: 'a.ts' } })
    // The folder is open but its level is not ready: no descendant can match.
    expect(screen.getByText(zh['picker.empty'])).not.toBeNull()
    settle({ entries: LEVELS['/w/src'] ?? [], truncated: false })
    await waitFor(() => {
      expect(screen.getByText('a.ts')).not.toBeNull()
    })
  })

  it('reports a truncated level', async () => {
    const pickerProps = props({ truncatedPaths: ['/w'] })
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => {
      expect(screen.getByText(zh['picker.truncated'].replace('{n}', '3'))).not.toBeNull()
    })
  })

  it('shows the error surface when the base level fails to load, and recovers through the path editor', async () => {
    const failing = vi.fn(async (path: string) => {
      if (path === '/w') throw new Error('boom')
      return { entries: LEVELS[path] ?? [], truncated: false }
    })
    const view = render(<FilePickerButton {...props({ listLevel: failing })} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(zh['picker.error'])
    })
    // The path editor survives the failure so the typed directory can be
    // corrected: jumping to a readable path recovers the modal.
    const pathInput = screen.getByRole('textbox', { name: zh['picker.path'] })
    fireEvent.change(pathInput, { target: { value: '/other' } })
    fireEvent.keyDown(pathInput, { key: 'Enter' })
    await waitFor(() => {
      expect(screen.getByText('x.ts')).not.toBeNull()
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('explains a session without a workspace root', async () => {
    const view = render(<FilePickerButton {...props({ items: [] })} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(zh['picker.noWorkspace'])
    })
  })

  it('cancel closes the modal without inserting', async () => {
    const insertRefs = vi.fn()
    const pickerProps = props({ insertRefs })
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    await waitFor(() => {
      expect(screen.getByText('package.json')).not.toBeNull()
    })
    fireEvent.click(screen.getByText('package.json'))
    // The modal's close X carries the same aria label; the footer button is
    // the only visible text row named 取消.
    fireEvent.click(screen.getByText(zh['picker.cancel']))
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: zh['picker.title'] })).toBeNull()
    })
    expect(insertRefs).not.toHaveBeenCalled()
  })

  it('ignores a level that settles after the modal closed', async () => {
    let settle!: (result: LevelResult) => void
    const deferred = new Promise<LevelResult>((resolve) => {
      settle = resolve
    })
    const pickerProps = props({ listLevel: vi.fn(() => deferred) })
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    fireEvent.click(screen.getByText(zh['picker.cancel']))
    settle({ entries: [], truncated: false })
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: zh['picker.title'] })).toBeNull()
    })
    expect(pickerProps.listLevel).toHaveBeenCalledTimes(1)
  })

  it('ignores a failed level that settles after the modal closed', async () => {
    let reject!: (reason: Error) => void
    const deferred = new Promise<LevelResult>((_resolve, r) => {
      reject = r
    })
    const pickerProps = props({ listLevel: vi.fn(() => deferred) })
    const view = render(<FilePickerButton {...pickerProps} />)
    fireEvent.click(view.getByRole('button', { name: zh['picker.open'] }))
    fireEvent.click(screen.getByText(zh['picker.cancel']))
    reject(new Error('late'))
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: zh['picker.title'] })).toBeNull()
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
