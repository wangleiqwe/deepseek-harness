import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { CAPTION_PREFIX } from '../src/caption.ts'

// Keep the Loader config under examples so the fixture exercises the same
// deployable topology as every other keyless smoke.
const driver = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/context/image-caption/driver.ts',
  import.meta.url,
))
const configPath = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/context/image-caption/cordis.yml',
  import.meta.url,
))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

describe('image-caption through a real headless cordis.yml', () => {
  it('logs the captioned message in place of the image and completes the turn', async () => {
    let events: SessionEvent[] = []
    const { stderr } = await runLoaderSmoke({
      label: 'image-caption headless smoke',
      tempDirPrefix: 'image-caption-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    expect(stderr).not.toContain('UNHANDLED')
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)

    // The inbox receipt keeps the original message with its image block —
    // proof the turn really started from an image. Every logged user/message
    // that reaches the model must instead carry the caption text only.
    expect(JSON.stringify(events)).toContain('"type":"image"')
    for (const event of events) {
      if (event.type !== 'user/message') continue
      expect(event.data.content.some(block => block.type === 'image')).toBe(false)
    }
    const userMessages = events.filter(
      (event): event is SessionEvent<'user/message'> => event.type === 'user/message' && event.data.source.kind === 'user',
    )
    expect(userMessages).toHaveLength(1)
    const content = userMessages[0]!.data.content
    expect(content).toHaveLength(2)
    expect(content[0]).toEqual({
      type: 'text',
      text: `${CAPTION_PREFIX}a bar chart titled Q3 quarterly revenue with bars 320, 480, and 610`,
    })
    expect(content[1]).toEqual({ type: 'text', text: 'What does the attached image say?' })

    const assistant = events.find(
      (event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message',
    )
    expect(assistant?.data.message.content.some(block => block.type === 'text' && block.text === 'ok')).toBe(true)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
