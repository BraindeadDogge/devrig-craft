// FROZEN DI types shared between the discovery track and the server track.
// Do not change these shapes without a PR discussion — both tracks compile
// against them (see issues #4 and #9).

export type PingResult = {
  version: string
  motd: string
  players: { online: number; max: number } | null
}

export type DiscoveredWorld = {
  worldName: string
  displayName: string
  host: string
  port: number
  source: 'lan' | 'server'
  version: string | null
  players: { online: number; max: number } | null
  compatible: boolean
}

export type LanSource = () => Promise<Array<{ motd: string; port: number; host: string }>>
export type PingSource = (host: string, port: number) => Promise<PingResult | null>

// Pinned mineflayer compatibility window (spec §4); update as mineflayer
// catches up with new Minecraft releases.
export const SUPPORTED_RANGE: [string, string] = ['1.18', '1.21']
