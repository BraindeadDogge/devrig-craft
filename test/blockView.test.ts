import { describe, it, expect } from 'vitest'
import { renderView, cellIndex, BACKGROUND, type BlockGrid } from '../src/render/blockView.js'
import { colourOf } from '../src/render/palette.js'

/** Build a grid from a literal so the fixtures read like the world. */
function grid(sx: number, sy: number, sz: number, fill: Array<[number, number, number, string]>): BlockGrid {
  const g: BlockGrid = { sx, sy, sz, cells: new Array(sx * sy * sz).fill(null) }
  for (const [x, y, z, name] of fill) (g.cells as Array<string | null>)[cellIndex(g, x, y, z)] = name
  return g
}
const pixel = (r: { width: number; rgb: Uint8Array }, px: number, py: number) =>
  [...r.rgb.subarray((py * r.width + px) * 3, (py * r.width + px) * 3 + 3)]

describe('orthographic views', () => {
  it('sizes the image from the box and the scale', () => {
    const g = grid(3, 2, 5, [])
    expect(renderView(g, 'north', 4)).toMatchObject({ width: 12, height: 8 }) // x by y
    expect(renderView(g, 'west', 4)).toMatchObject({ width: 20, height: 8 })  // z by y
    expect(renderView(g, 'top', 4)).toMatchObject({ width: 12, height: 20 })  // x by z
  })

  it('paints the sky where nothing stands', () => {
    const r = renderView(grid(2, 2, 2, []), 'north', 1)
    expect(pixel(r, 0, 0)).toEqual([...BACKGROUND])
  })

  it('puts y=0 at the BOTTOM of an elevation, the way a building stands', () => {
    const g = grid(1, 2, 1, [[0, 0, 0, 'cobblestone']]) // one block on the ground
    const r = renderView(g, 'north', 1)
    expect(pixel(r, 0, 1), 'the block belongs on the lower row').toEqual([...colourOf('cobblestone')])
    expect(pixel(r, 0, 0), 'and sky above it').toEqual([...BACKGROUND])
  })

  it('shows the nearest block along the line of sight, not the far one', () => {
    // near the camera at z=0, far at z=1; north looks from -z toward +z
    const g = grid(1, 1, 2, [[0, 0, 0, 'oak_planks'], [0, 0, 1, 'cobblestone']])
    expect(pixel(renderView(g, 'north', 1), 0, 0)).toEqual([...colourOf('oak_planks')])
    expect(pixel(renderView(g, 'south', 1), 0, 0)).toEqual([...colourOf('cobblestone')])
  })

  it('mirrors the horizontal axis when you walk round to the other side', () => {
    const g = grid(2, 1, 1, [[0, 0, 0, 'oak_log']]) // a post at the west end
    expect(pixel(renderView(g, 'north', 1), 0, 0), 'west end on the left from the north').toEqual([...colourOf('oak_log')])
    expect(pixel(renderView(g, 'south', 1), 1, 0), 'and on the right from the south').toEqual([...colourOf('oak_log')])
  })

  it('shades a block further from the camera darker, so depth reads', () => {
    const near = grid(1, 1, 4, [[0, 0, 0, 'oak_planks']])
    const far = grid(1, 1, 4, [[0, 0, 3, 'oak_planks']])
    const n = pixel(renderView(near, 'north', 1), 0, 0)
    const f = pixel(renderView(far, 'north', 1), 0, 0)
    expect(f[0]!).toBeLessThan(n[0]!)
    expect(f[0]!).toBeGreaterThan(0)
  })

  it('scales a block into a solid square of pixels', () => {
    const g = grid(1, 1, 1, [[0, 0, 0, 'oak_planks']])
    const r = renderView(g, 'north', 3)
    for (const px of [0, 1, 2]) for (const py of [0, 1, 2])
      expect(pixel(r, px, py)).toEqual([...colourOf('oak_planks')])
  })

  it('looks straight down for the top view', () => {
    // a roof over a floor: from above you see the roof
    const g = grid(1, 2, 1, [[0, 0, 0, 'cobblestone'], [0, 1, 0, 'oak_planks']])
    expect(pixel(renderView(g, 'top', 1), 0, 0)).toEqual([...colourOf('oak_planks')])
  })

  it('mirrors columns between west and east across the same z axis', () => {
    const g = grid(1, 1, 3, [[0, 0, 0, 'oak_log']]) // a post at the -z end
    expect(pixel(renderView(g, 'west', 1), 2, 0), 'west sees the -z end on its far column').toEqual([...colourOf('oak_log')])
    expect(pixel(renderView(g, 'east', 1), 0, 0), 'east sees the same post on the opposite column').toEqual([...colourOf('oak_log')])
  })

  it('east and west look from opposite ends, seeing different nearest blocks', () => {
    const g = grid(2, 1, 1, [[0, 0, 0, 'oak_planks'], [1, 0, 0, 'cobblestone']])
    expect(pixel(renderView(g, 'west', 1), 0, 0), 'west stands at -x, sees the near oak_planks first').toEqual([...colourOf('oak_planks')])
    expect(pixel(renderView(g, 'east', 1), 0, 0), 'east stands at +x, sees the near cobblestone first').toEqual([...colourOf('cobblestone')])
  })
})

describe('isometric view', () => {
  it('sizes the canvas from all three axes', () => {
    const g = grid(2, 3, 2, [])
    const r = renderView(g, 'iso', 4)
    expect(r.width).toBe((2 + 2) * 4)
    expect(r.height).toBe(((2 + 2) * 4) / 2 + 3 * 4)
  })

  // Every size the schema permits, because odd scales used to drop the top
  // face entirely: `ox + scale / 2` is fractional, and a fractional index into
  // a Uint8Array writes nowhere at all.
  for (const scale of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    it(`draws top, left and right faces at scale ${scale}`, () => {
      const g = grid(1, 1, 1, [[0, 0, 0, 'oak_planks']])
      const r = renderView(g, 'iso', scale)
      const seen = new Set<string>()
      for (let py = 0; py < r.height; py++)
        for (let px = 0; px < r.width; px++) seen.add(pixel(r, px, py).join(','))
      seen.delete([...BACKGROUND].join(','))
      const faces = [...seen].map((c) => c.split(',').map(Number) as [number, number, number])
      expect(faces, 'three face shades, none of them the sky').toHaveLength(3)
      // The lit top face keeps the block's own colour; the two sides are
      // darker, and darker by different amounts, or the form does not read.
      const top = [...colourOf('oak_planks')]
      expect(faces.map((f) => f.join(',')), 'the top face is the undimmed colour').toContain(top.join(','))
      const reds = faces.map((f) => f[0]).sort((a, b) => b - a)
      expect(reds[0]).toBe(top[0])
      expect(reds[1]!).toBeLessThan(reds[0]!)
      expect(reds[2]!).toBeLessThan(reds[1]!)
    })
  }

  it('lets a nearer block cover one behind it', () => {
    // (1,1,1) sits exactly on top of (0,0,0) on screen: same column, same row.
    const behind = grid(2, 2, 2, [[0, 0, 0, 'cobblestone']])
    const both = grid(2, 2, 2, [[0, 0, 0, 'cobblestone'], [1, 1, 1, 'oak_planks']])
    const scale = 6
    const a = renderView(behind, 'iso', scale)
    const b = renderView(both, 'iso', scale)
    // the middle of the shared top face — the far block owns it alone, then loses it
    const px = 1 * scale + scale, py = Math.round((2 * scale) / 2) + 1
    expect(pixel(a, px, py), 'the far block alone').toEqual([...colourOf('cobblestone')])
    expect(pixel(b, px, py), 'the near block paints over it').toEqual([...colourOf('oak_planks')])
  })
})
