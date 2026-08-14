import { describe, expect, it } from 'vitest'
import { CaptionConfig } from '../src/config.ts'

describe('CaptionConfig', () => {
  it('accepts an empty section: the route names live in settings or the entry base', () => {
    expect(CaptionConfig({})).toEqual({})
  })

  it('accepts the minimal explicit route', () => {
    expect(CaptionConfig({ provider: 'p', model: 'm' })).toEqual({ provider: 'p', model: 'm' })
  })

  it('accepts explicit values', () => {
    expect(CaptionConfig({
      provider: 'p',
      model: 'm',
      prompt: 'describe it',
      maxTokens: 256,
      onError: 'fail',
      enabled: false,
      autoSkipWhenMainModelAcceptsImages: false,
    })).toEqual({
      provider: 'p',
      model: 'm',
      prompt: 'describe it',
      maxTokens: 256,
      onError: 'fail',
      enabled: false,
      autoSkipWhenMainModelAcceptsImages: false,
    })
  })

  it('rejects invalid values at load', () => {
    // The interface accepts any number; the schema rejects out-of-range caps.
    expect(() => CaptionConfig({ provider: 'p', model: 'm', maxTokens: 0 })).toThrow()
    expect(() => CaptionConfig({ provider: 'p', model: 'm', maxTokens: 20_000 })).toThrow()
    expect(() => CaptionConfig({ provider: 'p', model: 'm', onError: 'nope' } as unknown as CaptionConfig)).toThrow()
    expect(() => CaptionConfig({ provider: 5, model: 'm' } as unknown as CaptionConfig)).toThrow()
  })
})
