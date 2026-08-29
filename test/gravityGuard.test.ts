import { describe, it, expect } from 'vitest'
import { PLAYER_GRAVITY, guardStopFlying } from '../src/runtime/gravityGuard.js'

// mineflayer's creative plugin:
//   let normalGravity = null
//   startFlying() { if (normalGravity == null) normalGravity = bot.physics.gravity; gravity = 0 }
//   stopFlying()  { bot.physics.gravity = normalGravity }
// so stopFlying() without a prior startFlying() restores `null` — permanently
// removing gravity. The bot then never lands, onGround stays false, and every
// jump silently does nothing. Recipes call stopFlying() defensively before
// walking, so a single walk disables climbing for the rest of the session.
function fakeBot(spawnGravity: number | null = 0.08) {
  let normalGravity: number | null = null
  const bot = {
    physics: { gravity: spawnGravity as number | null },
    creative: {
      startFlying() {
        if (normalGravity == null) normalGravity = bot.physics.gravity
        bot.physics.gravity = 0
      },
      async stopFlying() {
        bot.physics.gravity = normalGravity
      },
    },
  }
  return bot
}

describe('gravity guard', () => {
  it('reproduces the upstream defect without the guard', async () => {
    const bot = fakeBot()
    await bot.creative.stopFlying()
    expect(bot.physics.gravity, 'this is the bug being guarded against').toBeNull()
  })

  it('keeps gravity when stopFlying is called without ever flying', async () => {
    const bot = fakeBot()
    guardStopFlying(bot)
    await bot.creative.stopFlying()
    expect(bot.physics.gravity).toBe(0.08)
  })

  it('survives being called repeatedly, as walkTo does', async () => {
    const bot = fakeBot()
    guardStopFlying(bot)
    for (let i = 0; i < 5; i++) await bot.creative.stopFlying()
    expect(bot.physics.gravity).toBe(0.08)
  })

  it('still restores gravity after a real flight', async () => {
    const bot = fakeBot()
    guardStopFlying(bot)
    bot.creative.startFlying()
    expect(bot.physics.gravity).toBe(0)
    await bot.creative.stopFlying()
    expect(bot.physics.gravity).toBe(0.08)
  })

  it('rescues a bot whose saved gravity is 0 because it was already hovering', async () => {
    // mineflayer captures normalGravity once per bot. Start flying while
    // gravity is already 0 (an aborted script left the bot hovering) and the
    // saved value is 0 — stopFlying then restores weightlessness forever.
    const bot = fakeBot()
    guardStopFlying(bot)
    bot.physics.gravity = 0 // left hovering by an earlier run
    bot.creative.startFlying() // captures 0 as "normal"
    await bot.creative.stopFlying()
    expect(bot.physics.gravity).toBe(0.08)
  })

  it('falls back to the player default when spawn gravity was never readable', async () => {
    const bot = fakeBot(null)
    guardStopFlying(bot)
    await bot.creative.stopFlying()
    expect(bot.physics.gravity).toBe(PLAYER_GRAVITY)
  })
})
