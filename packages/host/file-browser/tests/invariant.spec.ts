/**
 * Invariant companion registration: the explained-empty installer reserves
 * the package name and rejects a duplicate registration.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as FileBrowserInvariant from '../src/invariant.ts'

describe('host file-browser invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(FileBrowserInvariant)
    await expect(ctx.plugin(FileBrowserInvariant).await()).rejects.toThrow(/@deepseek-ai\/dsh-host-file-browser/)
    await fiber.dispose()
  })
})
