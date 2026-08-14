/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-opencode-go-usage`.
 * @module @deepseek-ai/dsh-client-ui-opencode-go-usage/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-opencode-go-usage'

/** Cordis companion plugin name. */
export const name = 'client-ui-opencode-go-usage-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: two additive slot registrations whose disposal is
 * proven by the browser-plugin spec. The one mutable relation this package
 * owns — the per-entry usage polling state — lives inside React components in
 * the browser process, out of reach of the host invariant service, and the
 * node half emits no cordis events and holds no cross-plugin state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
