import { describe, it, expect, vi } from 'vitest'
import dgram from 'node:dgram'
import type { AddressInfo } from 'node:net'

vi.mock('minecraft-protocol', () => ({ default: { ping: vi.fn() } }))
import mc from 'minecraft-protocol'
import { collectLanAnnouncements, pingWorld } from '../src/discovery/sources.js'

type PingCallback = (err: unknown, res?: unknown) => void
const mockedPing = vi.mocked(mc.ping as unknown as (options: unknown, callback: PingCallback) => void)

function freeUdpPort(): Promise<number> {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4')
    s.bind(0, () => {
      const port = (s.address() as AddressInfo).port
      s.close(() => resolve(port))
    })
  })
}

describe('collectLanAnnouncements', () => {
  it('collects a datagram sent during the window and ignores garbage', async () => {
    const port = await freeUdpPort()
    const pending = collectLanAnnouncements(600, port)
    await new Promise((r) => setTimeout(r, 150))
    const sock = dgram.createSocket('udp4')
    sock.send('garbage', port, '127.0.0.1')
    sock.send('[MOTD]loop world[/MOTD][AD]7777[/AD]', port, '127.0.0.1', () => sock.close())
    const anns = await pending
    expect(anns).toContainEqual({ motd: 'loop world', port: 7777, host: '127.0.0.1' })
    expect(anns.filter((a) => a.motd === 'loop world')).toHaveLength(1)
  })
})

describe('pingWorld', () => {
  it('maps a full response to version, motd and players', async () => {
    mockedPing.mockImplementationOnce((_o, cb) =>
      cb(null, {
        version: { name: '1.21.4' },
        description: { text: 'Epic Server' },
        players: { online: 3, max: 20 },
      }),
    )
    expect(await pingWorld('h', 1)).toEqual({
      version: '1.21.4',
      motd: 'Epic Server',
      players: { online: 3, max: 20 },
    })
  })

  it('handles string descriptions and missing players', async () => {
    mockedPing.mockImplementationOnce((_o, cb) =>
      cb(null, { version: { name: '1.20.1' }, description: 'plain motd' }),
    )
    expect(await pingWorld('h', 1)).toEqual({ version: '1.20.1', motd: 'plain motd', players: null })
  })

  it('returns null when version.name is missing', async () => {
    mockedPing.mockImplementationOnce((_o, cb) => cb(null, { version: {} }))
    expect(await pingWorld('h', 1)).toBeNull()
  })

  it('returns null when ping errors', async () => {
    mockedPing.mockImplementationOnce((_o, cb) => cb(new Error('ECONNREFUSED')))
    expect(await pingWorld('h', 1)).toBeNull()
  })
})
