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

  it('pings an announcement from this machine over loopback, not the announced address', async () => {
    // A VPN/Tailscale interface wins the multicast egress, so the datagram
    // arrives FROM the tunnel address (100.x). Connecting back to that address
    // hangs — but it is this machine, so 127.0.0.1 reaches the same world.
    const lan = async () => [{ motd: 'devrig_v1', port: 49871, host: '100.96.12.147' }]
    const loopbackOnly = async (host: string) =>
      host === '127.0.0.1' ? { version: '1.21.4', motd: '', players: null } : null
    const worlds = await buildSnapshot(lan, loopbackOnly, [], new Set(['127.0.0.1', '100.96.12.147']))
    expect(worlds[0]).toMatchObject({
      host: '127.0.0.1',
      port: 49871,
      version: '1.21.4',
      compatible: true,
    })
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

  it('does not double-list a local LAN world that also matches an extra port', async () => {
    // The announcement arrives from the machine's LAN interface IP, never
    // 127.0.0.1 — the overlap guard must key on local interfaces, not loopback.
    const lan = async () => [{ motd: 'My World', port: 25565, host: '192.168.1.10' }]
    const worlds = await buildSnapshot(lan, ping('1.21.4'), [25565], new Set(['192.168.1.10']))
    expect(worlds).toHaveLength(1)
    expect(worlds[0]).toMatchObject({ source: 'lan', worldName: 'my-world' })
  })

  it('dedupes repeated extra ports instead of listing phantom twins', async () => {
    const worlds = await buildSnapshot(noLan, ping('1.20.1', 'Epic Server'), [25565, 25565])
    expect(worlds).toHaveLength(1)
  })
})

describe('isVersionSupported', () => {
  it('accepts the pinned range and rejects outside it', () => {
    expect(isVersionSupported('1.21.4')).toBe(true)
    expect(isVersionSupported('1.18')).toBe(true)
    expect(isVersionSupported('1.8.9')).toBe(false)
    expect(isVersionSupported('1.22')).toBe(false)
  })

  it('handles vendor-prefixed Server List Ping version names', () => {
    expect(isVersionSupported('Paper 1.21.4')).toBe(true)
    expect(isVersionSupported('Velocity 1.7.2-1.21.4')).toBe(true)
    expect(isVersionSupported('Spigot 1.8.8')).toBe(false)
  })
})
