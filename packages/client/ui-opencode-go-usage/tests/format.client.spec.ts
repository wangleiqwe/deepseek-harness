import { describe, expect, it } from 'vitest'
import { barWidth, fmtTime, levelColor } from '../src/client/format.ts'

describe('fmtTime', () => {
  it('renders an em dash for an absent instant', () => {
    expect(fmtTime(null)).toBe('—')
    expect(fmtTime('')).toBe('—')
  })

  it('keeps an unparseable instant verbatim', () => {
    expect(fmtTime('not-a-date')).toBe('not-a-date')
  })

  it('renders a wall clock with zero-padded fields', () => {
    expect(fmtTime('2026-08-14T15:46:52.610Z')).toBe('2026-08-14 23:46')
  })
})

describe('levelColor', () => {
  it('uses the neutral token for an unknown percentage', () => {
    expect(levelColor(null)).toBe('var(--dsw-alias-label-secondary)')
  })

  it('uses the error token at 80% and above', () => {
    expect(levelColor(80)).toBe('var(--dsw-alias-state-error-primary)')
  })

  it('uses the warning token between 60% and 80%', () => {
    expect(levelColor(60)).toBe('var(--dsw-alias-state-warn-primary)')
  })

  it('uses the success token below 60%', () => {
    expect(levelColor(59)).toBe('var(--dsw-alias-state-success-primary)')
  })
})

describe('barWidth', () => {
  it('renders an empty bar for an unknown percentage', () => {
    expect(barWidth(null)).toBe('0%')
  })

  it('clamps negative and oversized percentages', () => {
    expect(barWidth(-3)).toBe('0%')
    expect(barWidth(140)).toBe('100%')
  })

  it('renders an ordinary percentage', () => {
    expect(barWidth(53)).toBe('53%')
  })
})
