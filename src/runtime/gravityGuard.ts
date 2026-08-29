// mineflayer's creative plugin restores gravity from a value that only
// startFlying() ever sets:
//
//   let normalGravity = null
//   startFlying () { if (normalGravity == null) normalGravity = bot.physics.gravity
//                    bot.physics.gravity = 0 }
//   stopFlying  () { bot.physics.gravity = normalGravity }
//
// So stopFlying() on a bot that never flew assigns `null` — and a null gravity
// is permanent. The bot stops falling, `entity.onGround` never becomes true
// again, and because prismarine-physics only applies a jump while on ground,
// every jump silently does nothing: no nerd-poling, no climbing, no roof.
//
// This matters because defensive `stopFlying()` calls are the natural thing for
// a recipe to write ("make sure we are not flying before walking"), and the
// house recipe calls it on every single walk. Measured live: gravity was null
// after the first walk of the session, and two consecutive build runs logged
// 208 failed pillar attempts with `onGround` stuck false the whole time.
//
// The guard belongs in the runtime, not in a sentence in a recipe: a recipe
// cannot be trusted to remember, and every future recipe would have to.
export const PLAYER_GRAVITY = 0.08

type GravityBot = {
  physics: { gravity: number | null }
  creative: { stopFlying: () => Promise<void> | void }
}

/**
 * Wrap `bot.creative.stopFlying` so it can never leave the bot without
 * gravity. Captures the gravity in force at wrap time (spawn) and reinstates
 * it whenever the underlying call nulls it out.
 */
export function guardStopFlying(bot: GravityBot): void {
  const atSpawn = bot.physics.gravity
  const resting = typeof atSpawn === 'number' && atSpawn > 0 ? atSpawn : PLAYER_GRAVITY
  const original = bot.creative.stopFlying.bind(bot.creative)
  bot.creative.stopFlying = async () => {
    await original()
    // Not just null: mineflayer captures `normalGravity` on the FIRST
    // startFlying() of the bot's life. If that happened while gravity was
    // already 0 — a bot left hovering by an aborted script — the saved value
    // is 0, and every stopFlying() thereafter restores weightlessness.
    const g = bot.physics.gravity
    if (g === null || !(g > 0)) bot.physics.gravity = resting
  }
}
