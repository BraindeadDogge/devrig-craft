import { describe, it, expect } from 'vitest'
import { parseLanAnnouncement } from '../src/discovery/lanParser.js'

describe('parseLanAnnouncement', () => {
  it('parses a standard announcement', () => {
    expect(parseLanAnnouncement("[MOTD]Grigorii's world[/MOTD][AD]54321[/AD]"))
      .toEqual({ motd: "Grigorii's world", port: 54321 })
  })

  it('parses a real captured announcement (vanilla 1.21.4 via Prism, 2026-08-28)', () => {
    // Captured verbatim from UDP 224.0.2.60:4445 during the manual demo
    // (docs/manual-demo.md step 4) — the one non-synthetic fixture.
    expect(parseLanAnnouncement('[MOTD]BraindeadDogge - New World[/MOTD][AD]59281[/AD]'))
      .toEqual({ motd: 'BraindeadDogge - New World', port: 59281 })
  })

  it('parses a MOTD containing brackets', () => {
    expect(parseLanAnnouncement('[MOTD]a [fun] world[/MOTD][AD]1234[/AD]'))
      .toEqual({ motd: 'a [fun] world', port: 1234 })
  })

  it('returns null for garbage', () => {
    expect(parseLanAnnouncement('hello')).toBeNull()
  })

  it('returns null for out-of-range ports', () => {
    expect(parseLanAnnouncement('[MOTD]x[/MOTD][AD]99999[/AD]')).toBeNull()
    expect(parseLanAnnouncement('[MOTD]x[/MOTD][AD]0[/AD]')).toBeNull()
  })
})
