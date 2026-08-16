/**
 * File-reference pure core: workspace-root resolution, candidate filtering,
 * and reference-text assembly. Zero React, zero cordis — the '@' source and
 * the picker modal both derive from these pure functions.
 */
import type { FileRef, SessionId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Resolve the workspace root owning one session.
 * @param workspaces - live workspace list snapshot.
 * @param sessionId - session to place.
 * @returns the owning workspace's canonical path, or undefined for an
 * ungrouped session (no workspace account).
 */
export function workspaceRootFor(
  workspaces: readonly WorkspaceView[],
  sessionId: SessionId,
): string | undefined {
  return workspaces.find(workspace => workspace.sessionIds.includes(sessionId))?.path
}

/**
 * Filter a bounded file listing for one menu/query. Case-insensitive
 * substring match on the root-relative path and the base name; host
 * breadth-first order is preserved.
 * @param files - listing rows.
 * @param query - raw filter text.
 * @returns matching rows in listing order.
 */
export function filterFileCandidates(files: readonly FileRef[], query: string): readonly FileRef[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return files
  return files.filter(
    file => file.rel.toLowerCase().includes(needle) || file.name.toLowerCase().includes(needle),
  )
}

/**
 * The composer reference of one row: root-relative under the workspace root,
 * the absolute host path otherwise (rows browsed outside the workspace root).
 * The result is always forward-slash separated (the composer's reference
 * spelling), even when the host handed backslash paths (Windows).
 * @param path - absolute row path.
 * @param root - workspace root the relative spelling is taken from.
 * @returns the reference text.
 */
export function relOrAbsolute(path: string, root: string): string {
  for (const separator of ['/', '\\'] as const) {
    const prefix = root.endsWith(separator) ? root : `${root}${separator}`
    if (path.startsWith(prefix)) return path.slice(prefix.length).replaceAll('\\', '/')
  }
  return path.replaceAll('\\', '/')
}

/**
 * Assemble the plain-text references of one pick: `@rel ` (trailing space
 * closes the trigger token, mirroring the subagent reference source).
 * @param rel - root-relative file path.
 * @returns the literal draft text.
 */
export function pickRefText(rel: string): string {
  return `@${rel} `
}

/**
 * The space-separated `@rel` list of one multi-select.
 * @param rels - root-relative file paths.
 * @returns the literal references.
 */
export function refsText(rels: readonly string[]): string {
  return rels.map(rel => `@${rel}`).join(' ')
}

/**
 * Append a multi-select's references to the current draft with one space of
 * separation unless the draft is empty or already ends with whitespace.
 * @param draft - current draft text.
 * @param rels - root-relative file paths.
 * @returns the full next draft (empty rels return the draft unchanged).
 */
export function appendRefs(draft: string, rels: readonly string[]): string {
  const text = refsText(rels)
  if (text === '') return draft
  const separator = draft === '' || /\s$/u.test(draft) ? '' : ' '
  return `${draft}${separator}${text}`
}
