import { colourOf, isEmpty, type Rgb } from './palette.js'

export type BlockGrid = {
  sx: number
  sy: number
  sz: number
  /** Indexed by cellIndex(); null means empty. */
  cells: ReadonlyArray<string | null>
}
export type View = 'north' | 'south' | 'east' | 'west' | 'top' | 'iso'
export type Raster = { width: number; height: number; rgb: Uint8Array }

/** A pale sky, so a dark building still has a silhouette against it. */
export const BACKGROUND: Rgb = [222, 233, 243]

export function cellIndex(grid: BlockGrid, x: number, y: number, z: number): number {
  return (y * grid.sz + z) * grid.sx + x
}

export function blockAtCell(grid: BlockGrid, x: number, y: number, z: number): string | null {
  if (x < 0 || y < 0 || z < 0 || x >= grid.sx || y >= grid.sy || z >= grid.sz) return null
  return grid.cells[cellIndex(grid, x, y, z)] ?? null
}

// How much darker the far side of the box is drawn than the near side. Enough
// that a recessed window reads as recessed; not so much that the back wall
// disappears.
const DEPTH_FALLOFF = 0.45

type Ray = {
  /** columns across the image, and rows down it */
  width: number
  height: number
  /** the world cell seen at (column, row, depth), depth 0 being nearest */
  sample: (column: number, row: number, depth: number) => { x: number; y: number; z: number }
  depth: number
}

function rayFor(grid: BlockGrid, view: View): Ray {
  const { sx, sy, sz } = grid
  switch (view) {
    // Looking from -z toward +z: x runs left to right, y runs bottom to top.
    case 'north':
      return { width: sx, height: sy, depth: sz, sample: (c, r, d) => ({ x: c, y: sy - 1 - r, z: d }) }
    // From +z toward -z: the same building seen from behind, so x is mirrored.
    case 'south':
      return { width: sx, height: sy, depth: sz, sample: (c, r, d) => ({ x: sx - 1 - c, y: sy - 1 - r, z: sz - 1 - d }) }
    // From -x toward +x: z runs left to right.
    case 'west':
      return { width: sz, height: sy, depth: sx, sample: (c, r, d) => ({ x: d, y: sy - 1 - r, z: sz - 1 - c }) }
    case 'east':
      return { width: sz, height: sy, depth: sx, sample: (c, r, d) => ({ x: sx - 1 - d, y: sy - 1 - r, z: c }) }
    // Straight down: x across, z down the image, y from the top.
    case 'top':
      return { width: sx, height: sz, depth: sy, sample: (c, r, d) => ({ x: c, y: sy - 1 - d, z: r }) }
    // renderView delegates to renderIso before this helper is ever called.
    case 'iso':
      throw new Error("rayFor has no orthographic ray for 'iso'")
  }
}

function shade(colour: Rgb, factor: number): Rgb {
  return [
    Math.round(colour[0] * factor),
    Math.round(colour[1] * factor),
    Math.round(colour[2] * factor),
  ] as const
}

/**
 * Orthographic projection: for every pixel column, walk the box away from the
 * camera and take the first block that is not air. There is no perspective —
 * a wall is the same size wherever it stands — which is what makes two views
 * of the same building comparable.
 */
export function renderView(grid: BlockGrid, view: View, scale: number): Raster {
  if (view === 'iso') return renderIso(grid, scale)
  const ray = rayFor(grid, view)
  const width = ray.width * scale
  const height = ray.height * scale
  const rgb = new Uint8Array(width * height * 3)

  for (let row = 0; row < ray.height; row++) {
    for (let column = 0; column < ray.width; column++) {
      let colour: Rgb = BACKGROUND
      for (let d = 0; d < ray.depth; d++) {
        const at = ray.sample(column, row, d)
        const name = blockAtCell(grid, at.x, at.y, at.z)
        if (isEmpty(name)) continue
        const nearness = ray.depth === 1 ? 1 : 1 - (d / (ray.depth - 1)) * DEPTH_FALLOFF
        colour = shade(colourOf(name as string), nearness)
        break
      }
      for (let py = row * scale; py < (row + 1) * scale; py++) {
        for (let px = column * scale; px < (column + 1) * scale; px++) {
          const at = (py * width + px) * 3
          rgb[at] = colour[0]
          rgb[at + 1] = colour[1]
          rgb[at + 2] = colour[2]
        }
      }
    }
  }
  return { width, height, rgb }
}

// A 2:1 isometric cell: the top face is a rhombus scale wide and scale/2 tall,
// with the two visible sides hanging below it.
const TOP_SHADE = 1.0
const LEFT_SHADE = 0.8
const RIGHT_SHADE = 0.62

function put(raster: Raster, px: number, py: number, colour: Rgb): void {
  if (px < 0 || py < 0 || px >= raster.width || py >= raster.height) return
  const at = (py * raster.width + px) * 3
  raster.rgb[at] = colour[0]
  raster.rgb[at + 1] = colour[1]
  raster.rgb[at + 2] = colour[2]
}

function renderIso(grid: BlockGrid, scale: number): Raster {
  const { sx, sy, sz } = grid
  // A cell's top face is a rhombus 2*scale wide and 2*half tall; neighbours
  // interlock at half that width, so the canvas is (sx + sz) * scale across.
  // `half` is rounded up for odd scales, which the height must allow for.
  const half = Math.max(1, Math.round(scale / 2))
  const width = (sx + sz) * scale
  const height = Math.round(((sx + sz - 2) * scale) / 2) + sy * scale + half * 2
  const raster: Raster = { width, height, rgb: new Uint8Array(width * height * 3) }
  for (let i = 0; i < width * height; i++) {
    raster.rgb[i * 3] = BACKGROUND[0]
    raster.rgb[i * 3 + 1] = BACKGROUND[1]
    raster.rgb[i * 3 + 2] = BACKGROUND[2]
  }

  // Painter's algorithm: far blocks first, so near ones overwrite them. Depth
  // grows with x + z (rightward and toward the viewer) and with height.
  for (let y = 0; y < sy; y++) {
    for (let d = 0; d <= sx + sz - 2; d++) {
      for (let x = Math.max(0, d - sz + 1); x <= Math.min(sx - 1, d); x++) {
        const z = d - x
        const name = blockAtCell(grid, x, y, z)
        if (isEmpty(name)) continue
        const base = colourOf(name as string)
        // origin of this cell's top-face rhombus
        const ox = (x + (sz - 1 - z)) * scale
        const oy = Math.round(((x + z) * scale) / 2) + (sy - 1 - y) * scale
        // The top face, drawn from its horizontal centre outward and mirrored
        // about its waist. Every index is an integer: a fractional one lands
        // nowhere in a Uint8Array, and the face silently disappears.
        const centre = ox + scale
        for (let row = 0; row < half; row++) {
          const spread = Math.max(1, Math.round(((row + 1) / half) * scale))
          for (let col = -spread; col < spread; col++) {
            put(raster, centre + col, oy + row, shade(base, TOP_SHADE))
            put(raster, centre + col, oy + half * 2 - 1 - row, shade(base, TOP_SHADE))
          }
        }
        // The two visible sides hang below the rhombus's lower edges, each one
        // scale wide, so together they span the same width as the top face.
        for (let col = 0; col < scale; col++) {
          const drop = Math.round(((col + 1) / scale) * half)
          for (let row = 0; row < scale; row++) {
            put(raster, ox + col, oy + half + drop + row, shade(base, LEFT_SHADE))
            put(raster, ox + scale * 2 - 1 - col, oy + half + drop + row, shade(base, RIGHT_SHADE))
          }
        }
      }
    }
  }
  return raster
}
