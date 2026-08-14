/**
 * Pure presentation helpers for the usage windows: local wall-clock rendering,
 * the health colour of one percentage, and the progress-bar width.
 * @module @deepseek-ai/dsh-client-ui-opencode-go-usage/client/format
 */

/** Two-digit zero-padded clock field. */
function pad(value: number): string {
  return (value < 10 ? '0' : '') + String(value)
}

/**
 * Local wall-clock rendering of one ISO instant; the raw string survives
 * unparseable input, and absence renders as an em dash.
 * @param iso - ISO-8601 instant or null.
 * @returns the minute-precision wall-clock text.
 */
export function fmtTime(iso: string | null): string {
  if (iso === null || iso.length === 0) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Theme token for the health colour of one consumed percentage.
 * @param percent - consumed percentage, or null when unknown.
 * @returns a `--dsw-*` colour token the bar and dot resolve at render time.
 */
export function levelColor(percent: number | null): string {
  if (percent === null) return 'var(--dsw-alias-label-secondary)'
  if (percent >= 80) return 'var(--dsw-alias-state-error-primary)'
  if (percent >= 60) return 'var(--dsw-alias-state-warn-primary)'
  return 'var(--dsw-alias-state-success-primary)'
}

/**
 * Clamped percentage string for a progress-bar width.
 * @param percent - consumed percentage, or null when unknown.
 * @returns `0%`–`100%` width, `0%` while unknown.
 */
export function barWidth(percent: number | null): string {
  if (percent === null) return '0%'
  return `${Math.min(100, Math.max(0, percent))}%`
}
