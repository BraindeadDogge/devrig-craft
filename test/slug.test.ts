import { describe, it, expect } from 'vitest'
import { worldSlug } from '../src/discovery/slug.js'

describe('worldSlug', () => {
  it('kebab-cases display names', () => {
    expect(worldSlug("Grigorii's world", new Set())).toBe('grigorii-s-world')
  })

  it('collapses runs and trims edge dashes', () => {
    expect(worldSlug('  My -- World!! ', new Set())).toBe('my-world')
  })

  it('falls back to "world" when nothing survives', () => {
    expect(worldSlug('!!!', new Set())).toBe('world')
  })

  it('deduplicates against taken slugs', () => {
    const taken = new Set(['my-world', 'my-world-2'])
    expect(worldSlug('My World', taken)).toBe('my-world-3')
  })
})
