import { describe, it, expect } from 'vitest'
import { buildSnapshot, isVersionSupported, type PingResult } from '../src/discovery/snapshot.js'

const noLan = async () => []
const noPing = async () => null
const ping = (version: string, motd = '', players: PingResult['players'] = null) =>
  async () => ({ version, motd, players })

describe('buildSnapshot', () => {
  it('lists LAN worlds with slugs and version from ping', async () => {
    const lan = async () => [{ motd: "Grigorii's world", port: 54321, host: '192.168.1.10' }]
    const worlds = await buildSnapshot(lan, ping('1.21.4'))
    expect(worlds).toEqual([
      {
        worldName: 'grigorii-s-world',
        displayName: "Grigorii's world",
        host: '192.168.1.10',
        port: 54321,
        source: 'lan',
        version: '1.21.4',
        players: null,
        compatible: true,
      },
    ])
  })

  it('assigns dedup suffixes independent of announcement arrival order', async () => {
    const a = { motd: 'w', port: 2000, host: 'b-host' }
    const b = { motd: 'w', port: 1000, host: 'a-host' }
    const order1 = await buildSnapshot(async () => [a, b], ping('1.21.4'))
    const order2 = await buildSnapshot(async () => [b, a], ping('1.21.4'))
    expect(order1).toEqual(order2)
    expect(order1.find((w) => w.host === 'a-host')!.worldName).toBe('w')
    expect(order1.find((w) => w.host === 'b-host')!.worldName).toBe('w-2')
  })

  it('dedupes identical repeated LAN announcements', async () => {
    const ann = { motd: 'w', port: 1000, host: 'h' }
    const worlds = await buildSnapshot(async () => [ann, ann, ann], noPing)
    expect(worlds).toHaveLength(1)
  })

  it('uses the server MOTD as display name and surfaces players', async () => {
    const p = ping('1.20.1', 'Epic Server', { online: 3, max: 20 })
    const worlds = await buildSnapshot(noLan, async (h, port) => (port === 25565 ? p() : null), [25565])
    expect(worlds[0]).toMatchObject({
      worldName: 'epic-server',
      displayName: 'Epic Server',
      source: 'server',
      players: { online: 3, max: 20 },
    })
  })

  it('falls back to localhost:PORT when the server MOTD is empty', async () => {
    const worlds = await buildSnapshot(noLan, ping('1.20.1'), [25565])
    expect(worlds[0]).toMatchObject({ worldName: 'localhost-25565', displayName: 'localhost:25565' })
  })

  it('keeps unreachable-ping LAN worlds with null version, marked incompatible', async () => {
    const lan = async () => [{ motd: 'w', port: 1000, host: 'h' }]
    const worlds = await buildSnapshot(lan, noPing)
    expect(worlds[0]!.version).toBeNull()
    expect(worlds[0]!.compatible).toBe(false)
  })
})

describe('isVersionSupported', () => {
  it('accepts the pinned range and rejects outside it', () => {
    expect(isVersionSupported('1.21.4')).toBe(true)
    expect(isVersionSupported('1.18')).toBe(true)
    expect(isVersionSupported('1.8.9')).toBe(false)
    expect(isVersionSupported('1.22')).toBe(false)
  })
})
