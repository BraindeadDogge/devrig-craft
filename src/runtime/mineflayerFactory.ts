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
  return bot as unknown as BotLike
}
