import { colourOf, isEmpty, type Rgb } from './palette.js'

export type BlockGrid = {
  sx: number
  sy: number
  sz: number
  /** Indexed by cellIndex(); null means empty. */
  cells: ReadonlyArray<string | null>
}
export type View = 'north' | 'south' | 'east' | 'west' | 'top'
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
