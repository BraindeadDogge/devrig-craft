import { createRequire } from 'node:module'
import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import minecraftData from 'minecraft-data'
import type { Item as ItemClass } from 'prismarine-item'
import type { BotFactory, BotLike } from './botManager.js'

// prismarine-item ships ESM-style typings over a CJS module.exports —
// a NodeNext default import resolves to the namespace and is not callable.
const require = createRequire(import.meta.url)
const prismarineItem = require('prismarine-item') as (mcVersion: string) => typeof ItemClass

const { pathfinder, Movements, goals } = pathfinderPkg

export const mineflayerFactory: BotFactory = ({ host, port, username, auth }) => {
  const bot = mineflayer.createBot({ host, port, username, auth })
  bot.loadPlugin(pathfinder)

  // Auto-jump for RAW forward movement (mobility self-tests, unstick walks):
  // walking into a 1-block ledge otherwise pins the bot against it forever —
  // observed live when a bot rejoined inside leftover walls. Only manages the
  // jump control it set itself, so pathfinder's own jumps are untouched.
  let autoJumping = false
  bot.on('physicsTick', () => {
    const forward = bot.getControlState('forward')
    const collided = Boolean(
      (bot.entity as { isCollidedHorizontally?: boolean }).isCollidedHorizontally,
    )
    if (forward && collided && bot.entity.onGround) {
      autoJumping = true
      bot.setControlState('jump', true)
    } else if (autoJumping && (!forward || !collided)) {
      autoJumping = false
      bot.setControlState('jump', false)
    }
  })
  ;(bot as unknown as { craftScope: () => Record<string, unknown> }).craftScope = () => ({
    bot,
    Vec3,
    mcData: minecraftData(bot.version),
    goals,
    Movements,
    Item: prismarineItem(bot.version),
    waitFor: (event: string, timeoutMs = 10000) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error(`waitFor("${event}") timed out after ${timeoutMs} ms`)),
          timeoutMs,
        )
        bot.once(event as Parameters<typeof bot.once>[0], (...args: unknown[]) => {
          clearTimeout(t)
          resolve(args)
        })
      }),
  })
  // Human placement contract, enforced at the TOOL level so no script can
  // bypass it: a real player must face a block to click it and cannot reach
  // past ~4.5. Every placeBlock/dig first TURNS the head smoothly toward the
  // target (visible, human), and refuses targets out of arm's reach with an
  // actionable error instead of silently spawning blocks behind the back.
  // Patched on 'inject_allowed': mineflayer attaches placeBlock/dig via
  // plugins AFTER createBot returns — binding them synchronously here reads
  // undefined and breaks the join.
  bot.once('inject_allowed', () => {
    if (typeof bot.placeBlock !== 'function' || typeof bot.dig !== 'function') {
      console.error('human placement contract NOT installed: placeBlock/dig missing after inject_allowed')
      return
    }
    const REACH = 4.5
    const eye = () => bot.entity.position.offset(0, 1.62, 0)
    const origPlaceBlock = bot.placeBlock.bind(bot)
    bot.placeBlock = async (ref, face) => {
      const target = ref.position.plus(face).offset(0.5, 0.5, 0.5)
      if (eye().distanceTo(target) > REACH)
        throw new Error(`placeBlock: target ${target.floored()} is out of arm's reach (${REACH}) — walk closer first`)
      await bot.lookAt(target, false) // smooth turn: the human sees the head move
      return origPlaceBlock(ref, face)
    }
    const origDig = bot.dig.bind(bot)
    bot.dig = (async (block: Parameters<typeof origDig>[0], ...rest: unknown[]) => {
      const target = block.position.offset(0.5, 0.5, 0.5)
      if (eye().distanceTo(target) > REACH)
        throw new Error(`dig: block ${block.position} is out of arm's reach (${REACH}) — walk closer first`)
      await bot.lookAt(target, false)
      return (origDig as (...args: unknown[]) => Promise<void>)(block, ...rest)
    }) as typeof bot.dig
  })

  return bot as unknown as BotLike
}
