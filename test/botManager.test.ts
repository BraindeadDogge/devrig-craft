import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { BotManager, type BotLike, type WorldAddress } from '../src/runtime/botManager.js'

function world(name: string): WorldAddress {
  return { worldName: name, host: 'h', port: 1 }
}

class FakeBot extends EventEmitter implements BotLike {
  entity = { position: { x: 1, y: 64, z: 3 } }
  health = 20
  food = 18
  ended = false
  end() {
    this.ended = true
  }
}

afterEach(() => vi.useRealTimers())

describe('BotManager', () => {
  it('tracks joining → ready on spawn', () => {
    const bot = new FakeBot()
    const mgr = new BotManager(() => bot)
    mgr.join(world('w'), 'devrig')
    expect(mgr.list()[0]).toMatchObject({ worldName: 'w', state: 'joining' })
    bot.emit('spawn')
    expect(mgr.list()[0]).toMatchObject({
      state: 'ready',
      position: { x: 1, y: 64, z: 3 },
      health: 20,
      food: 18,
    })
  })

  it('records kick reasons as error state', () => {
    const bot = new FakeBot()
    const mgr = new BotManager(() => bot)
    mgr.join(world('w'), 'devrig')
    bot.emit('kicked', 'You are banned')
    expect(mgr.list()[0]).toMatchObject({ state: 'error', error: 'kicked: You are banned' })
  })

  it('flips to error when a join never spawns within the timeout', () => {
    vi.useFakeTimers()
    const mgr = new BotManager(() => new FakeBot())
    mgr.join(world('w'), 'devrig')
    vi.advanceTimersByTime(60_001)
    expect(mgr.list()[0]).toMatchObject({ state: 'error' })
    expect(mgr.list()[0]!.error).toContain('join timed out')
  })

  it('spawn cancels the join timer', () => {
    vi.useFakeTimers()
    const bot = new FakeBot()
    const mgr = new BotManager(() => bot)
    mgr.join(world('w'), 'devrig')
    bot.emit('spawn')
    vi.advanceTimersByTime(120_000)
    expect(mgr.list()[0]).toMatchObject({ state: 'ready' })
  })

  it('is idempotent per world while a live bot exists', () => {
    let created = 0
    const mgr = new BotManager(() => {
      created++
      return new FakeBot()
    })
    mgr.join(world('w'), 'devrig')
    mgr.join(world('w'), 'devrig')
    expect(created).toBe(1)
  })

  it('rejoin after error ends the old bot and detaches its listeners', () => {
    const bots: FakeBot[] = []
    const mgr = new BotManager(() => {
      const b = new FakeBot()
      bots.push(b)
      return b
    })
    mgr.join(world('w'), 'devrig')
    bots[0]!.emit('end', 'socketClosed')
    mgr.join(world('w'), 'devrig')
    expect(bots).toHaveLength(2)
    expect(bots[0]!.ended).toBe(true)
    bots[1]!.emit('spawn')
    // A late event from the OLD emitter must not poison the new entry:
    bots[0]!.emit('end', 'late straggler')
    expect(mgr.list()[0]).toMatchObject({ state: 'ready' })
  })

  it('tryLock serializes executions per world', () => {
    const bot = new FakeBot()
    const mgr = new BotManager(() => bot)
    mgr.join(world('w'), 'devrig')
    const release = mgr.tryLock('w')
    expect(release).not.toBeNull()
    expect(mgr.tryLock('w')).toBeNull()
    release!()
    expect(mgr.tryLock('w')).not.toBeNull()
  })

  it('endAll ends every bot', () => {
    const bot = new FakeBot()
    const mgr = new BotManager(() => bot)
    mgr.join(world('w'), 'devrig')
    mgr.endAll()
    expect(bot.ended).toBe(true)
  })
})
