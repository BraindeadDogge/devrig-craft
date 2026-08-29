import { createRequire } from 'node:module'
import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import minecraftData from 'minecraft-data'
import type { Item as ItemClass } from 'prismarine-item'
import type { BotFactory, BotLike } from './botManager.js'
import { digSightRefusal, reachRefusal, sightRefusal } from './placementContract.js'

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
    // Human mouse flick: the default smooth-look turn is leisurely; a person
    // snaps to a nearby block in ~150ms. Raising the turn rates keeps looks
    // visible but quick, or a 170-block build drowns in head-turning time.
    const physics = bot.physics as unknown as { yawSpeed?: number; pitchSpeed?: number }
    if (typeof physics.yawSpeed === 'number') physics.yawSpeed = Math.max(physics.yawSpeed, 12)
    if (typeof physics.pitchSpeed === 'number') physics.pitchSpeed = Math.max(physics.pitchSpeed, 12)

    if (typeof bot.placeBlock !== 'function' || typeof bot.dig !== 'function') {
      console.error('human placement contract NOT installed: placeBlock/dig missing after inject_allowed')
      return
    }
    const REACH = 4.5
    const eye = () => bot.entity.position.offset(0, 1.62, 0)

    // Human pace: a person clicks 2-3 blocks a second with an uneven rhythm,
    // not 20. Shared across place and dig.
    let lastActionAt = 0
    const pace = async () => {
      const wait = lastActionAt + 260 + Math.random() * 200 - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      lastActionAt = Date.now()
    }

    // Human sight: you can only click a face your eye-ray reaches first —
    // never through walls, never a top face from underneath its plane.
    type RayHit = { position: Vec3; intersect?: Vec3 } | null
    const raycast = (dir: Vec3, dist: number): RayHit =>
      (bot.world as unknown as { raycast: (f: Vec3, d: Vec3, r: number) => RayHit }).raycast(
        eye(),
        dir,
        dist,
      )
    const canSeeFace = (refPos: Vec3, face: Vec3): boolean => {
      // Aim a hair INSIDE the face (0.45, not 0.5): a ray aimed exactly at
      // the face plane grazes it and, at shallow angles, numerically clips a
      // neighbor sharing that plane — measured live: adjacent placements
      // passed while 3-blocks-away ground placements were refused. Aiming
      // into the block makes the ray enter the ref through the clicked face.
      const aim = refPos.offset(0.5, 0.5, 0.5).plus(face.scaled(0.45))
      const dir = aim.minus(eye())
      const dist = dir.norm()
      if (dist < 0.001) return true
      const hit = raycast(dir.scaled(1 / dist), dist + 0.6)
      if (!hit || !hit.position || !hit.position.equals(refPos)) return false
      if (!hit.intersect) return true
      const axis = face.x !== 0 ? 'x' : face.y !== 0 ? 'y' : 'z'
      const plane = (refPos as unknown as Record<string, number>)[axis] + ((face as unknown as Record<string, number>)[axis] > 0 ? 1 : 0)
      return Math.abs((hit.intersect as unknown as Record<string, number>)[axis] - plane) < 0.05
    }
    const canSeeBlockCenter = (pos: Vec3): boolean => {
      const dir = pos.offset(0.5, 0.5, 0.5).minus(eye())
      const dist = dir.norm()
      if (dist < 0.001) return true
      const hit = raycast(dir.scaled(1 / dist), dist + 0.6)
      return Boolean(hit && hit.position && hit.position.equals(pos))
    }

    // Every face of a block, so a refusal can name the ones that WOULD work.
    const ALL_FACES = [
      new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
    ]
    const origPlaceBlock = bot.placeBlock.bind(bot)
    bot.placeBlock = async (ref, face) => {
      const target = ref.position.plus(face).offset(0.5, 0.5, 0.5)
      if (eye().distanceTo(target) > REACH)
        throw new Error(
          reachRefusal('placeBlock', target.floored(), eye().distanceTo(target), REACH),
        )
      if (!canSeeFace(ref.position, face))
        throw new Error(
          sightRefusal({
            refName: ref.name,
            refPos: ref.position,
            face,
            visibleFaces: ALL_FACES.filter((f) => canSeeFace(ref.position, f)),
            distance: eye().distanceTo(ref.position.offset(0.5, 0.5, 0.5)),
            reach: REACH,
          }),
        )
      await pace()
      await bot.lookAt(target, false) // smooth turn: the human sees the head move
      return origPlaceBlock(ref, face)
    }
    const origDig = bot.dig.bind(bot)
    bot.dig = (async (block: Parameters<typeof origDig>[0], ...rest: unknown[]) => {
      const target = block.position.offset(0.5, 0.5, 0.5)
      if (eye().distanceTo(target) > REACH)
        throw new Error(reachRefusal('dig', block.position, eye().distanceTo(target), REACH))
      if (!canSeeBlockCenter(block.position))
        throw new Error(
          digSightRefusal(block.name, block.position, eye().distanceTo(target), REACH),
        )
      await pace()
      await bot.lookAt(target, false)
      return (origDig as (...args: unknown[]) => Promise<void>)(block, ...rest)
    }) as typeof bot.dig
  })

  return bot as unknown as BotLike
}
