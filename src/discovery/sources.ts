import dgram from 'node:dgram'
import mc from 'minecraft-protocol'
import type { NewPingResult, OldPingResult } from 'minecraft-protocol'
import { parseLanAnnouncement } from './lanParser.js'
import type { LanSource, PingResult, PingSource } from './snapshot.js'

const LAN_GROUP = '224.0.2.60'
export const LAN_PORT = 4445

// The port parameter exists for test isolation: two reuseAddr sockets on one
// port split unicast datagrams non-deterministically, so tests must never
// share 4445 with each other or with a real Minecraft client.
export function collectLanAnnouncements(windowMs = 1800, port = LAN_PORT): ReturnType<LanSource> {
  return new Promise((resolve) => {
    const found: Array<{ motd: string; port: number; host: string }> = []
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const done = () => {
      try {
        sock.close()
      } catch (e) {
        console.error('lan listener close failed:', e)
      }
      resolve(found)
    }
    sock.on('error', (e) => {
      console.error('lan listener error:', e)
      done()
    })
    sock.on('message', (buf, rinfo) => {
      const parsed = parseLanAnnouncement(buf.toString('utf8'))
      if (parsed) found.push({ ...parsed, host: rinfo.address })
    })
    sock.bind(port, () => {
      try {
        sock.addMembership(LAN_GROUP)
      } catch (e) {
        // No multicast on this interface — loopback datagrams still arrive.
        console.error('lan multicast join failed:', e)
      }
      setTimeout(done, windowMs)
    })
  })
}

type RawPing = {
  version?: { name?: unknown }
  description?: unknown
  players?: { online?: unknown; max?: unknown }
}

function motdText(description: unknown): string {
  if (typeof description === 'string') return description
  if (description && typeof description === 'object') {
    const d = description as { text?: unknown; extra?: unknown[] }
    const extra = Array.isArray(d.extra) ? d.extra.map(motdText).join('') : ''
    return `${typeof d.text === 'string' ? d.text : ''}${extra}`
  }
  return ''
}

export const pingWorld: PingSource = async (host, port) => {
  try {
    // Callback form (not the returned promise): mc.ping's own callback type is
    // the Old|New union, so narrow to RawPing after resolving.
    const settled = await new Promise<OldPingResult | NewPingResult>((resolve, reject) => {
      mc.ping({ host, port, closeTimeout: 1500, noPongTimeout: 1500 }, (err, res) =>
        err ? reject(err) : resolve(res),
      )
    })
    const result = settled as RawPing
    const name = result?.version?.name
    if (typeof name !== 'string') return null
    const players =
      typeof result.players?.online === 'number' && typeof result.players?.max === 'number'
        ? { online: result.players.online, max: result.players.max }
        : null
    const mapped: PingResult = { version: name, motd: motdText(result.description), players }
    return mapped
  } catch (e) {
    console.error(`ping ${host}:${port} failed:`, e)
    return null
  }
}
