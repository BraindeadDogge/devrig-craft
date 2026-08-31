import type { EventEmitter } from 'node:events'
import type { Vec3 } from 'vec3'

// Structural subset of DiscoveredWorld (src/discovery/snapshot.ts) — kept
// local so the bot runtime has zero compile-time dependency on the
// discovery track. DiscoveredWorld is assignable to this.
export type WorldAddress = {
  worldName: string
  host: string
  port: number
}

export type BotLike = EventEmitter & {
  entity?: { position: { x: number; y: number; z: number } }
  health?: number
  food?: number
  // Present on a real mineflayer bot; the renderer reads the world through it.
  blockAt?: (pos: Vec3) => { name?: string } | null
  end: (reason?: string) => void
}

export type BotFactory = (opts: {
  host: string
  port: number
  username: string
  auth: 'offline'
}) => BotLike

type BotState = 'joining' | 'ready' | 'error'

export const JOIN_TIMEOUT_MS = 60_000

type Entry = {
  world: WorldAddress
  username: string
  bot: BotLike
  state: BotState
  error?: string
  joinTimer?: NodeJS.Timeout
  locked: boolean
}

export class BotManager {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly factory: BotFactory) {}

  join(world: WorldAddress, username: string): void {
    const existing = this.entries.get(world.worldName)
    if (existing && existing.state !== 'error') return
    if (existing) this.dispose(existing)

    const bot = this.factory({ host: world.host, port: world.port, username, auth: 'offline' })
    const entry: Entry = { world, username, bot, state: 'joining', locked: false }
    this.entries.set(world.worldName, entry)

    const fail = (error: string) => {
      entry.state = 'error'
      entry.error = error
      clearTimeout(entry.joinTimer)
      console.error(`bot ${world.worldName}: ${error}`)
    }
    entry.joinTimer = setTimeout(() => {
      if (entry.state === 'joining')
        fail(`join timed out after ${JOIN_TIMEOUT_MS / 1000}s — is the world still open to LAN?`)
    }, JOIN_TIMEOUT_MS)
    bot.on('spawn', () => {
      entry.state = 'ready'
      clearTimeout(entry.joinTimer)
    })
    bot.on('error', (e: unknown) => fail(`error: ${String(e)}`))
    bot.on('kicked', (reason: unknown) => fail(`kicked: ${String(reason)}`))
    bot.on('end', (reason: unknown) => {
      if (entry.state !== 'error') fail(`connection ended: ${String(reason)}`)
    })
  }

  private dispose(entry: Entry): void {
    clearTimeout(entry.joinTimer)
    entry.bot.removeAllListeners()
    try {
      entry.bot.end('devrig-craft: replaced by rejoin')
    } catch (e) {
      console.error('bot end failed:', e)
    }
  }

  list() {
    return [...this.entries.values()].map((e) => ({
      worldName: e.world.worldName,
      username: e.username,
      state: e.state,
      ...(e.error ? { error: e.error } : {}),
      ...(e.state === 'ready' && e.bot.entity ? { position: e.bot.entity.position } : {}),
      ...(e.state === 'ready' && e.bot.health !== undefined ? { health: e.bot.health } : {}),
      ...(e.state === 'ready' && e.bot.food !== undefined ? { food: e.bot.food } : {}),
    }))
  }

  get(worldName: string): { bot: BotLike; state: BotState } | undefined {
    const e = this.entries.get(worldName)
    return e ? { bot: e.bot, state: e.state } : undefined
  }

  tryLock(worldName: string): (() => void) | null {
    const e = this.entries.get(worldName)
    if (!e || e.locked) return null
    e.locked = true
    return () => {
      e.locked = false
    }
  }

  endAll(): void {
    for (const e of this.entries.values()) this.dispose(e)
    this.entries.clear()
  }
}
