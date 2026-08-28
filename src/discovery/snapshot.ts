import { worldSlug } from './slug.js'
import { SUPPORTED_RANGE, type DiscoveredWorld, type LanSource, type PingResult, type PingSource } from './types.js'

// The shapes live in ./types.ts (frozen, shared with the server track); this
// module re-exports them so consumers can import the builder and its types
// from one place.
export { SUPPORTED_RANGE }
export type { DiscoveredWorld, LanSource, PingResult, PingSource }

function minor(version: string): number {
  const m = /^1\.(\d+)/.exec(version)
  return m ? Number(m[1]) : NaN
}

export function isVersionSupported(version: string): boolean {
  const v = minor(version)
  return v >= minor(SUPPORTED_RANGE[0]) && v <= minor(SUPPORTED_RANGE[1])
}

export async function buildSnapshot(
  lan: LanSource,
  ping: PingSource,
  extraPorts: number[] = [],
): Promise<DiscoveredWorld[]> {
  const seen = new Set<string>()
  const announcements = (await lan())
    .filter((a) => {
      const key = `${a.host}:${a.port}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    // Deterministic slug allocation: order by (host, port), never by UDP arrival.
    .sort((x, y) => x.host.localeCompare(y.host) || x.port - y.port)

  const ports = extraPorts.filter((p) => !seen.has(`127.0.0.1:${p}`))
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
