/**
 * Invariant companion registration and the node half: the explained-empty
 * installer reserves the package name, and the node-half apply is the no-op
 * host placeholder that keeps the plugin in the Loader tree.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as FileReferenceInvariant from '../src/invariant.ts'
import { apply } from '../src/index.ts'

describe('ui-file-reference invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(FileReferenceInvariant)
    // The name is reserved; a second registration of the same package fails.
    await expect(ctx.plugin(FileReferenceInvariant).await()).rejects.toThrow(/@deepseek-ai\/dsh-client-ui-file-reference/)
    await fiber.dispose()
  })

  it('node-half apply is a no-op host placeholder', () => {
    apply()
  })
})
