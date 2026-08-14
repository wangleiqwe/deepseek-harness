/**
 * Shared usage state vocabulary and the one polling hook every entry renders
 * from. The Host owns the read (Remote namespace); this module owns only the
 * browser-local polling lifecycle and its render projection.
 * @module @deepseek-ai/dsh-client-ui-opencode-go-usage/client/usage
 */

import { useEffect, useState } from 'react'
import type { UsageResult, UsageSuccess } from '@deepseek-ai/dsh-opencode-go-usage/types'

/** Poll interval: the rolling five-hour window moves slowly, one minute is plenty. */
const POLL_INTERVAL_MS = 60_000

/** One entry's render state. */
export type UsageState =
  | { status: 'loading' }
  | { status: 'ok'; snapshot: UsageSuccess }
  | { status: 'error'; error: string }

/** The injected face every entry receives: one read verb, nothing else. */
export interface OpencodeUsageInjected {
  /** Read the current usage through the Host Remote; never rejects. */
  fetchUsage: () => Promise<UsageResult>
}

/** The read verb this hook polls through. */
export type FetchUsage = () => Promise<UsageResult>

/**
 * Poll one usage snapshot on mount and every minute, guarded against
 * set-after-unmount. A rejection is folded into the error state like a
 * business failure, so the render surface reads one status union.
 * @param fetchUsage - the injected Host read verb.
 * @returns the render state plus a manual refresh trigger.
 */
export function useUsage(fetchUsage: FetchUsage): UsageState & { refresh: () => void } {
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<UsageState>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    const load = (): void => {
      fetchUsage().then((result) => {
        if (!alive) return
        setState(result.ok
          ? { status: 'ok', snapshot: result }
          : { status: 'error', error: result.error })
      }, (error: unknown) => {
        if (alive) setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      })
    }
    load()
    const id = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [fetchUsage, tick])
  return { ...state, refresh: () => { setTick(current => current + 1) } }
}
