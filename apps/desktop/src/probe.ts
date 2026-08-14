/**
 * HTTP readiness probing for the local dsh web server. Any HTTP response —
 * even an error status — means the server is up and serving; only a refused
 * connection, a timeout, or another network failure means it is not.
 * @module @deepseek-ai/dsh-desktop/probe
 */

import { request } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'

/** Default polling cadence for {@link waitForReachable}. */
const DEFAULT_PROBE_INTERVAL_MS = 250

/**
 * Probe whether an HTTP server answers on `url` within `timeoutMs`.
 * @param url - the URL to probe.
 * @param timeoutMs - per-attempt deadline.
 * @returns true when any response arrives in time.
 */
export async function isReachable(url: string, timeoutMs = 2000): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const probe = request(new URL(url), { method: 'GET' }, (response) => {
      response.resume()
      resolve(true)
    })
    probe.setTimeout(timeoutMs, () => { probe.destroy() })
    probe.on('error', () => { resolve(false) })
    probe.end()
  })
}

export interface WaitForReachableOptions {
  /** Overall deadline; polling stops the moment it passes. */
  timeoutMs: number
  /** Time between attempts; {@link DEFAULT_PROBE_INTERVAL_MS} when absent. */
  intervalMs?: number
}

/**
 * Poll {@link isReachable} until a response arrives or the deadline passes.
 * @param url - the URL to wait for.
 * @param options - deadline and polling cadence.
 * @returns true when the server answered before the deadline.
 */
export async function waitForReachable(url: string, options: WaitForReachableOptions): Promise<boolean> {
  const deadline = Date.now() + options.timeoutMs
  const intervalMs = options.intervalMs ?? DEFAULT_PROBE_INTERVAL_MS
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    if (await isReachable(url, Math.min(2000, remaining))) return true
    await sleep(Math.min(intervalMs, remaining))
  }
}
