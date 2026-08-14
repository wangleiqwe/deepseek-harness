#!/usr/bin/env node
/** Test driver: one turn whose user message carries a fixture image block, through one Headless Loader composition. */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('image-caption driver requires a config path')

const ctx = await boot('image-caption-e2e', resolveConfigPath(configPath, undefined))
try {
  const agent = ctx.get('agents')?.roots()[0]
  if (agent === undefined) throw new Error('image-caption driver requires one root agent')
  await agent.whenIdle()
  agent.followup(createUserMessage({
    source: { kind: 'user' },
    content: [
      {
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:image-caption-fixture'),
          mediaType: 'image/png',
          bytes: 4,
          width: 2,
          height: 2,
          name: 'fixture.png',
        },
      },
      { type: 'text', text: 'What does the attached image say?' },
    ],
  }))
  await agent.whenIdle()
  await ctx.sessions.flush(agent.session)
} finally {
  await ctx.fiber.dispose()
}
