import os from 'node:os'
import { worldSlug } from './slug.js'
import { SUPPORTED_RANGE, type DiscoveredWorld, type LanSource, type PingResult, type PingSource } from './types.js'

// The shapes live in ./types.ts (frozen, shared with the server track); this
// module re-exports them so consumers can import the builder and its types
// from one place.
export { SUPPORTED_RANGE }
export type { DiscoveredWorld, LanSource, PingResult, PingSource }

// Server List Ping version names are often vendor-prefixed ("Paper 1.21.4",
// "Velocity 1.7.2-1.21.4") — take the LAST 1.<minor> token, not a
// start-anchored match.
function minor(version: string): number {
  const matches = [...version.matchAll(/1\.(\d+)/g)]
  const last = matches[matches.length - 1]
  return last ? Number(last[1]) : NaN
}

export function isVersionSupported(version: string): boolean {
  const v = minor(version)
  return v >= minor(SUPPORTED_RANGE[0]) && v <= minor(SUPPORTED_RANGE[1])
}

function defaultLocalHosts(): Set<string> {
  const hosts = new Set<string>(['127.0.0.1', '::1'])
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) hosts.add(a.address)
  }
  return hosts
}

export async function buildSnapshot(
  lan: LanSource,
  ping: PingSource,
  extraPorts: number[] = [],
  // Addresses that mean "this machine" — a LAN announcement from one of these
  // covers the same server an extraPorts loopback ping would find. Injectable
  // for tests; defaults to the real interface list.
  localHosts: Set<string> = defaultLocalHosts(),
): Promise<DiscoveredWorld[]> {
  const seen = new Set<string>()
  const localAnnouncedPorts = new Set<number>()
  const announcements = (await lan())
    .filter((a) => {
      const key = `${a.host}:${a.port}`
      if (seen.has(key)) return false
      seen.add(key)
      if (localHosts.has(a.host)) localAnnouncedPorts.add(a.port)
      return true
    })
    // Deterministic slug allocation: order by (host, port), never by UDP arrival.
    .sort((x, y) => x.host.localeCompare(y.host) || x.port - y.port)

  const ports = [...new Set(extraPorts)].filter((p) => !localAnnouncedPorts.has(p))
  const [lanPings, serverPings] = await Promise.all([
    Promise.all(announcements.map((a) => ping(a.host, a.port))),
    Promise.all(ports.map((p) => ping('127.0.0.1', p))),
  ])

  const taken = new Set<string>()
  const worlds: DiscoveredWorld[] = []

  announcements.forEach((a, i) => {
    const pinged = lanPings[i] ?? null
    const worldName = worldSlug(a.motd, taken)
    taken.add(worldName)
    worlds.push({
      worldName,
      displayName: a.motd,
      host: a.host,
      port: a.port,
      source: 'lan',
      version: pinged?.version ?? null,
      players: pinged?.players ?? null,
      compatible: pinged !== null && isVersionSupported(pinged.version),
    })
  })

  ports.forEach((port, i) => {
    const pinged = serverPings[i] ?? null
    if (!pinged) return
    const displayName = pinged.motd.trim() || `localhost:${port}`
    const worldName = worldSlug(displayName, taken)
    taken.add(worldName)
    worlds.push({
      worldName,
      displayName,
      host: '127.0.0.1',
      port,
      source: 'server',
      version: pinged.version,
      players: pinged.players,
      compatible: isVersionSupported(pinged.version),
    })
  })

  return worlds
}
