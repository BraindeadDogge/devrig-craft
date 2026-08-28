import { describe, it, expect } from 'vitest'
import { parseLanAnnouncement } from '../src/discovery/lanParser.js'

describe('parseLanAnnouncement', () => {
  it('parses a standard announcement', () => {
    expect(parseLanAnnouncement("[MOTD]Grigorii's world[/MOTD][AD]54321[/AD]"))
      .toEqual({ motd: "Grigorii's world", port: 54321 })
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
