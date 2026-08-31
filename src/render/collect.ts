import { Vec3 } from 'vec3'
import type { BlockGrid } from './blockView.js'
import { isEmpty } from './palette.js'

/**
 * The position must be a real Vec3: mineflayer forwards it to prismarine-world,
 * which calls `pos.floored()`. A structural `{x, y, z}` type-checks but throws
 * on the first loaded cell, so the parameter is deliberately nominal here.
 */
export type BlockSource = {
  blockAt: (pos: Vec3) => { name?: string } | null
}

/**
 * Read a cube of the world into a dense grid. The box's minimum corner
 * becomes grid (0,0,0), so the renderer never has to know world coordinates.
 *
 * An unloaded chunk answers null; that is stored as empty rather than as an
 * error. A render of the part of the world that IS loaded is more useful than
 * a refusal, and the caller can see the hole.
 */
export function collectGrid(
  bot: BlockSource,
  centre: { x: number; y: number; z: number },
  radius: number,
): BlockGrid {
  const cx = Math.floor(centre.x), cy = Math.floor(centre.y), cz = Math.floor(centre.z)
  const side = radius * 2 + 1
  const cells: Array<string | null> = new Array(side * side * side).fill(null)
  for (let y = 0; y < side; y++) {
    for (let z = 0; z < side; z++) {
      for (let x = 0; x < side; x++) {
        const block = bot.blockAt(new Vec3(cx - radius + x, cy - radius + y, cz - radius + z))
        const name = block?.name
        if (isEmpty(name)) continue
        cells[(y * side + z) * side + x] = name as string
      }
    }
  }
  return { sx: side, sy: side, sz: side, cells }
}
