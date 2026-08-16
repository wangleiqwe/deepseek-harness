// Web e2e scenario: composer file references through the host file browser —
// the '@' file menu lists folders (trailing slash) and inserts `@rel` plain
// text, the paperclip multi-select browses an expandable directory tree and
// jumps to any other directory through the path editor (rows outside the
// workspace root reference by absolute path), and the submitted prompt
// carries the references verbatim to the model (answered by the replay
// adapter). The workspace is seeded with a small tree including a skipped
// `node_modules` dir, plus a sibling directory outside the workspace root.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import {
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()

const REPLY = 'FILE_REFS_REPLY acknowledged the referenced paths.'

const REPLAY: ReplayOverrideDoc = [{
  kind: 'chunks',
  chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: REPLY },
    { type: 'block-end', index: 0, block: { type: 'text', text: REPLY } },
    { type: 'usage', usage: { inputTokens: 256, outputTokens: 16 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ],
}]

describe.skipIf(MODE === 'record')('web e2e: composer file references through the host file browser', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let replayDir: string
  let tripwire: ReturnType<typeof watchConsole>
  const apiCalls: string[] = []

  beforeAll(async () => {
    replayDir = await mkdtemp(join(tmpdir(), 'dsh-file-refs-replay-'))
    const replayOverride = join(replayDir, 'replay.override.json')
    await writeFile(replayOverride, JSON.stringify(REPLAY))
    scaffold = await launchWebScaffold({
      replayFixture: join(replayDir, 'override-only.jsonl'),
      replayOverride,
      // Paced replay keeps the timing-derived chrome deterministic.
      paceMs: 10,
    })
    // Seed the workspace tree before connecting: the session workspace root
    // is <workspaceCwd>/workspace (connectFreshWorkspace stages it). A
    // sibling directory outside the root exercises the path editor.
    const workspace = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(join(workspace, 'src'), { recursive: true })
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await mkdir(join(workspace, 'node_modules'), { recursive: true })
    await writeFile(join(workspace, 'package.json'), '{}')
    await writeFile(join(workspace, 'src', 'app.ts'), '')
    await writeFile(join(workspace, 'docs', 'guide.md'), '')
    await writeFile(join(workspace, 'node_modules', 'dep.js'), '')
    const sibling = join(scaffold.workspaceCwd, 'sibling')
    await mkdir(sibling, { recursive: true })
    await writeFile(join(sibling, 'other.txt'), '')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/')) apiCalls.push(path)
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (replayDir !== undefined) {
      await rm(replayDir, { recursive: true, force: true })
        .catch((error: unknown) => failures.push(error))
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'file-reference e2e cleanup failed')
  })

  it('inserts @file references from the menu and the picker, then sends them verbatim', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-file-references'))
    const composer = page.locator('textarea:enabled').last()
    await composer.waitFor({ timeout: 15_000 })

    // The '@' file menu lists folders with a trailing slash marking them
    // (node_modules omitted by the host walk).
    await composer.pressSequentially('@src')
    const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
    // Exact name: 'src/' is a substring of 'src/app.ts' by the default
    // substring matching.
    const folderOption = menu.getByRole('option', { name: 'src/', exact: true })
    await expect.poll(
      () => folderOption.count(),
      { timeout: 10_000 },
    ).toBe(1)
    await folderOption.click()
    await expect.poll(() => composer.inputValue(), { timeout: 10_000 }).toBe('@src/ ')

    // The '@' file menu inserts the plain-text file reference. Sequential
    // keys (not fill): the caret must sit at the draft end for the trigger
    // scan to see the '@'.
    await composer.pressSequentially('@app')
    const fileOption = menu.getByRole('option', { name: 'src/app.ts' })
    await expect.poll(
      () => fileOption.count(),
      { timeout: 10_000 },
    ).toBe(1)
    await fileOption.click()
    await expect.poll(() => composer.inputValue(), { timeout: 10_000 }).toBe('@src/ @src/app.ts ')

    // The paperclip picker browses the workspace tree: folders expand and
    // collapse in place, file rows multi-select.
    const picker = page.getByRole('button', { name: 'Reference workspace files' })
    await picker.click()
    const dialog = page.getByRole('dialog', { name: 'Select files to reference' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Expand folder src' }).click()
    await dialog.getByText('app.ts').click()
    await dialog.getByRole('button', { name: 'Expand folder docs' }).click()
    await dialog.getByText('guide.md').click()

    // The path editor jumps to a directory outside the workspace root; its
    // rows reference by absolute path.
    const outside = join(scaffold.workspaceCwd, 'sibling')
    const pathInput = dialog.getByRole('textbox', { name: 'Directory path' })
    await pathInput.fill(outside)
    await pathInput.press('Enter')
    await dialog.getByText('other.txt').click()
    await dialog.getByRole('button', { name: 'Insert references' }).click()
    const outsideRef = `${outside.split('\\').join('/')}/other.txt`
    const finalDraft = `@src/ @src/app.ts @src/app.ts @docs/guide.md @${outsideRef}`
    await expect.poll(() => composer.inputValue(), { timeout: 10_000 }).toBe(finalDraft)

    // Submit: the plain-text references ride the prompt verbatim.
    const settled = scaffold.whenTurnSettled()
    await composer.press('Enter')
    await settled
    // The user bubble carries the reference text (no lexicon decorates file
    // tokens), and the host answered through the replay adapter.
    await page.getByText(finalDraft).first()
      .waitFor({ timeout: 15_000 })
    expect(apiCalls).toContain('/api/host.listFiles')
    expect(apiCalls).toContain('/api/host.listLevel')
    await page.getByText(REPLY, { exact: false }).first().waitFor({ timeout: 15_000 })
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
