/**
 * Package-owned invariant companion for the host file-browser seam.
 * @module @deepseek-ai/dsh-host-file-browser/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-file-browser'

/** Cordis companion plugin name. */
export const name = 'host-file-browser-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: each listing is one stateless bounded filesystem walk; the filesystem itself is the authoritative state. */
const install: InvariantInstaller = () => {}

/**
 * Register the file-browser invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
