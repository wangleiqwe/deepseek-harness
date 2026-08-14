/**
 * Client-safe payload vocabulary for the OpenCode Go usage capability.
 * Types only — no runtime code, and nothing here reaches a Host-only symbol,
 * so a Client compilation face reads exactly the shape the Host emits.
 * @module @deepseek-ai/dsh-opencode-go-usage/types
 */

/** One usage window reported by the OpenCode Go gateway. */
export type UsageWindow = {
  /** Gateway status label (`ok` observed; kept as a string for forward compatibility). */
  status: string
  /** Consumed percentage of this window's limit; null when the gateway reports none. */
  percent: number | null
  /** ISO-8601 instant the window resets; null when the gateway reports none. */
  resetsAt: string | null
}

/** The three windows the Go subscription tracks, plus the fetch instant. */
export type UsageSnapshot = {
  /** ISO-8601 instant the gateway answered this snapshot. */
  fetchedAt: string
  /** Rolling five-hour window (about $12 of usage). */
  rolling: UsageWindow | null
  /** Weekly window (about $30 of usage). */
  weekly: UsageWindow | null
  /** Monthly window (about $60 of usage). */
  monthly: UsageWindow | null
}

/** Successful usage read. */
export type UsageSuccess = {
  ok: true
  /** ISO-8601 instant the gateway answered this snapshot. */
  fetchedAt: string
  /** Rolling five-hour window (about $12 of usage). */
  rolling: UsageWindow | null
  /** Weekly window (about $30 of usage). */
  weekly: UsageWindow | null
  /** Monthly window (about $60 of usage). */
  monthly: UsageWindow | null
}

/** Failed usage read with one actionable reason. */
export type UsageFailure = {
  ok: false
  /** Human-readable failure reason, safe for configuration surfaces. */
  error: string
}

/** Outcome of one usage read: a snapshot or one failure reason. */
export type UsageResult = UsageSuccess | UsageFailure
