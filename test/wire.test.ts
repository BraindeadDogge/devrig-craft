import { describe, it, expect } from 'vitest'
import { toWire } from '../src/wire.js'

describe('toWire', () => {
  it('snake_cases keys recursively, leaving values and arrays intact', () => {
    expect(
      toWire({ worldName: 'w', players: { onlineCount: 1 }, list: [{ displayName: 'x' }] }),
    ).toEqual({ world_name: 'w', players: { online_count: 1 }, list: [{ display_name: 'x' }] })
  })

  it('passes primitives through', () => {
    expect(toWire('a')).toBe('a')
    expect(toWire(null)).toBeNull()
  })
})
