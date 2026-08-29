# Block-data screenshots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `craft_take_screenshot` a success path that renders the world from block data and returns a PNG, so an agent can look at what it built.

**Architecture:** Three pure modules with no bot and no world in them — a PNG encoder over `node:zlib`, a block-name-to-colour palette, and an orthographic projection from a dense block grid to pixels. The server collects the grid from `bot.blockAt` over a bounded box and wraps the raster as MCP image content. No GL, no `prismarine-viewer`, no new dependencies.

**Tech Stack:** TypeScript (ESM, NodeNext), `node:zlib`, `zod`, vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-seeing-and-planning-design.md`

## Global Constraints

- Node 22+ / TypeScript 5, ESM with `NodeNext` resolution — every relative import ends in `.js`.
- **No new runtime dependencies.** Anything imported must already be in `package.json` or be a Node built-in.
- **Never write to stdout.** Stdout is the JSON-RPC channel. Diagnostics go to `console.error`.
- **No empty catch.** Every catch rethrows, logs to stderr, or both.
- **Bound every model-supplied input** with a zod `.max()`. A render box scales cubically.
- **No runtime skip-detection in tests.** A missing prerequisite fails the test; it never self-skips.
- Type-check tests too: `npx tsc --noEmit` must pass (it reads `tsconfig.test.json`).
- Commit messages say what and why. Never mention AI, never add an AI co-author.

---

### Task 1: PNG encoder

**Files:**
- Create: `src/render/png.ts`
- Test: `test/png.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `encodePng(width: number, height: number, rgb: Uint8Array): Buffer` — truecolour 8-bit PNG. `rgb` is row-major, three bytes per pixel, length exactly `width * height * 3`. Throws on a length mismatch.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { inflateSync } from 'node:zlib'
import { encodePng } from '../src/render/png.js'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Walk the chunk list so the test reads the file the way a decoder would. */
function chunks(png: Buffer): Array<{ type: string; data: Buffer }> {
  const out: Array<{ type: string; data: Buffer }> = []
  let at = SIGNATURE.length
  while (at < png.length) {
    const len = png.readUInt32BE(at)
    out.push({ type: png.subarray(at + 4, at + 8).toString('ascii'), data: png.subarray(at + 8, at + 8 + len) })
    at += 12 + len
  }
  return out
}

describe('png encoder', () => {
  it('writes a decodable truecolour PNG with the pixels it was given', () => {
    // two pixels side by side: red, then green
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0])
    const png = encodePng(2, 1, rgb)

    expect(png.subarray(0, 8)).toEqual(SIGNATURE)
    const parts = chunks(png)
    expect(parts.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])

    const ihdr = parts[0]!.data
    expect(ihdr.readUInt32BE(0)).toBe(2) // width
    expect(ihdr.readUInt32BE(4)).toBe(1) // height
    expect(ihdr[8]).toBe(8) // bit depth
    expect(ihdr[9]).toBe(2) // colour type: truecolour

    // one scanline: a leading filter byte, then the pixels, unchanged
    const raw = inflateSync(parts[1]!.data)
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0])
  })

  it('refuses a buffer that is not width * height * 3', () => {
    expect(() => encodePng(2, 2, new Uint8Array(3))).toThrow(/expected 12 bytes/)
  })

  it('round-trips a larger image without corrupting any row', () => {
    const w = 17, h = 9 // deliberately not a power of two
    const rgb = new Uint8Array(w * h * 3)
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 7) % 256
    const raw = inflateSync(chunks(encodePng(w, h, rgb))[1]!.data)
    for (let y = 0; y < h; y++) {
      const row = raw.subarray(y * (1 + w * 3), (y + 1) * (1 + w * 3))
      expect(row[0], `row ${y} must use filter 0`).toBe(0)
      expect([...row.subarray(1)]).toEqual([...rgb.subarray(y * w * 3, (y + 1) * w * 3)])
    }
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/png.test.ts`
Expected: FAIL — `Cannot find module '../src/render/png.js'`.

- [ ] **Step 3: Write the encoder**

```ts
import { deflateSync } from 'node:zlib'

// PNG needs a CRC32 over each chunk's type+data. Building the table once at
// module load costs nothing and keeps the hot loop a single xor and shift.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Encode a truecolour 8-bit PNG. `rgb` is row-major, three bytes per pixel.
 *
 * Every scanline uses filter 0 (none). Filtering exists to help compression,
 * and these images are flat colour fields that deflate well already — the
 * simplicity is worth more here than the handful of bytes.
 */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const expected = width * height * 3
  if (rgb.length !== expected)
    throw new Error(`encodePng: expected ${expected} bytes for ${width}x${height}, got ${rgb.length}`)

  const stride = 1 + width * 3
  const raw = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    Buffer.from(rgb.subarray(y * width * 3, (y + 1) * width * 3)).copy(raw, y * stride + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  ihdr[10] = 0 // compression: deflate
  ihdr[11] = 0 // filter method: adaptive
  ihdr[12] = 0 // interlace: none

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/png.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/render/png.ts test/png.test.ts
git commit -m "Add a dependency-free PNG encoder

Rendering the world needs an image, and the reason screenshots were
descoped in the first place was a native dependency that would not build
reliably. node:zlib plus a CRC table is the whole requirement for a
truecolour PNG, so there is no dependency to be unreliable."
```

---

### Task 2: Block palette

**Files:**
- Create: `src/render/palette.ts`
- Test: `test/palette.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Rgb = readonly [number, number, number]`
  - `colourOf(blockName: string): Rgb` — never throws; unknown names get a neutral grey.
  - `isEmpty(blockName: string | null | undefined): boolean` — true for air and for absent blocks.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { colourOf, isEmpty, type Rgb } from '../src/render/palette.js'

describe('block palette', () => {
  it('knows the blocks the house recipe builds with', () => {
    for (const name of ['oak_planks', 'oak_log', 'cobblestone', 'glass_pane', 'oak_door'])
      expect(colourOf(name), `${name} needs its own colour`).not.toEqual(colourOf('__nothing__'))
  })

  it('tells wood from stone from glass', () => {
    const [wood, stone, glass] = ['oak_planks', 'cobblestone', 'glass_pane'].map(colourOf) as Rgb[]
    expect(wood).not.toEqual(stone)
    expect(stone).not.toEqual(glass)
    expect(wood).not.toEqual(glass)
  })

  it('resolves a coloured variant through its family', () => {
    // there are sixteen beds and sixteen wools; the family is what matters
    expect(colourOf('blue_bed')).toEqual(colourOf('red_bed'))
    expect(colourOf('lime_wool')).toEqual(colourOf('white_wool'))
  })

  it('gives an unknown block a neutral grey rather than throwing', () => {
    const c = colourOf('some_block_added_in_a_later_version')
    expect(c).toHaveLength(3)
    expect(c[0]).toBe(c[1])
    expect(c[1]).toBe(c[2])
  })

  it('treats every flavour of air, and a missing block, as empty', () => {
    for (const n of ['air', 'cave_air', 'void_air', '', null, undefined]) expect(isEmpty(n)).toBe(true)
    expect(isEmpty('oak_planks')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/palette.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the palette**

```ts
export type Rgb = readonly [number, number, number]

// Flat colours, picked to be told apart at one pixel per block rather than to
// match the game. Wood warm, stone neutral, glass pale, foliage green.
const EXACT: Record<string, Rgb> = {
  oak_planks: [162, 130, 78],
  oak_log: [109, 85, 50],
  oak_door: [145, 115, 66],
  oak_stairs: [150, 120, 72],
  oak_slab: [162, 130, 78],
  oak_fence: [150, 120, 72],
  cobblestone: [122, 122, 122],
  stone: [136, 136, 136],
  stone_bricks: [124, 124, 124],
  glass: [196, 228, 236],
  glass_pane: [196, 228, 236],
  grass_block: [106, 148, 66],
  dirt: [134, 96, 67],
  sand: [219, 207, 163],
  gravel: [150, 144, 140],
  water: [63, 118, 228],
  lava: [222, 110, 30],
  torch: [255, 200, 90],
  wall_torch: [255, 200, 90],
  chest: [150, 110, 46],
  crafting_table: [138, 106, 62],
  furnace: [104, 104, 104],
  ladder: [150, 120, 72],
}

// Families: sixteen dyed variants of the same thing should read the same.
const FAMILIES: Array<[string, Rgb]> = [
  ['_bed', [173, 52, 47]],
  ['_wool', [233, 236, 236]],
  ['_carpet', [233, 236, 236]],
  ['_stained_glass_pane', [196, 228, 236]],
  ['_stained_glass', [196, 228, 236]],
  ['_planks', [162, 130, 78]],
  ['_log', [109, 85, 50]],
  ['_door', [145, 115, 66]],
  ['_stairs', [150, 120, 72]],
  ['_slab', [162, 130, 78]],
  ['_leaves', [72, 118, 48]],
  ['_torch', [255, 200, 90]],
]

const UNKNOWN: Rgb = [150, 150, 150]

const AIR = new Set(['air', 'cave_air', 'void_air', ''])

export function isEmpty(blockName: string | null | undefined): boolean {
  return blockName == null || AIR.has(blockName)
}

/**
 * A colour for every block name. Unknown blocks get a neutral grey rather
 * than an exception: a render is a diagnostic, and it is more useful showing
 * an unfamiliar block in grey than refusing to draw the building.
 */
export function colourOf(blockName: string): Rgb {
  const exact = EXACT[blockName]
  if (exact) return exact
  for (const [suffix, colour] of FAMILIES) if (blockName.endsWith(suffix)) return colour
  return UNKNOWN
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/palette.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/render/palette.ts test/palette.test.ts
git commit -m "Give every block a colour, and unknown blocks a grey

A render is a diagnostic. Refusing to draw a building because one block is
from a version we have no entry for would defeat the point, so an unknown
name gets neutral grey and the shape still reads. Dyed variants resolve
through their family: sixteen beds should not need sixteen entries."
```

---

### Task 3: Orthographic elevations and the top view

**Files:**
- Create: `src/render/blockView.ts`
- Test: `test/blockView.test.ts`

**Interfaces:**
- Consumes: `colourOf`, `isEmpty` from `src/render/palette.js`.
- Produces:
  - `type BlockGrid = { sx: number; sy: number; sz: number; cells: ReadonlyArray<string | null> }` — `cells` is indexed by `cellIndex(grid, x, y, z)`; `null` means empty.
  - `type View = 'north' | 'south' | 'east' | 'west' | 'top'` (`'iso'` is added in Task 5).
  - `type Raster = { width: number; height: number; rgb: Uint8Array }`
  - `cellIndex(grid: BlockGrid, x: number, y: number, z: number): number`
  - `blockAtCell(grid: BlockGrid, x: number, y: number, z: number): string | null`
  - `renderView(grid: BlockGrid, view: View, scale: number): Raster`
  - `BACKGROUND: Rgb` — the sky colour behind the silhouette.

The grid's axes are world axes with the box's minimum corner at `(0, 0, 0)`.
`north` means the camera stands on the **−z** side looking toward **+z** — the
face a player sees when standing north of the building.

- [ ] **Step 1: Write the failing test**

```ts
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
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/blockView.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the projection**

```ts
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
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/blockView.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/render/blockView.ts test/blockView.test.ts
git commit -m "Project a block grid into an orthographic elevation

Four elevations and a top-down view, each answering 'what does this look
like from over here'. Orthographic rather than perspective on purpose: a
wall is the same size wherever it stands, so two views of one building can
be compared, and a plan can be checked against a photograph.

Depth shading is what makes a recessed window read as recessed."
```

---

### Task 4: Collect the grid from a live bot

**Files:**
- Create: `src/render/collect.ts`
- Modify: `src/runtime/botManager.ts` — widen `BotLike` with the optional `blockAt` the renderer needs
- Test: `test/collect.test.ts`

**Interfaces:**
- Consumes: `BlockGrid` from `src/render/blockView.js`.
- Produces: `collectGrid(bot: BlockSource, centre: { x: number; y: number; z: number }, radius: number): BlockGrid`, where `type BlockSource = { blockAt: (pos: { x: number; y: number; z: number }) => { name?: string } | null }`. The grid's `(0,0,0)` is the box's minimum corner, i.e. `centre - radius` on each axis.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { collectGrid } from '../src/render/collect.js'
import { blockAtCell } from '../src/render/blockView.js'

/** A world that is solid stone below y=0 and a single oak post at the origin. */
const fakeWorld = {
  blockAt: (p: { x: number; y: number; z: number }) => {
    if (p.y < 0) return { name: 'stone' }
    if (p.x === 0 && p.z === 0 && p.y === 0) return { name: 'oak_log' }
    return { name: 'air' }
  },
}

describe('collectGrid', () => {
  it('spans the whole box around the centre', () => {
    const g = collectGrid(fakeWorld, { x: 0, y: 0, z: 0 }, 2)
    expect(g).toMatchObject({ sx: 5, sy: 5, sz: 5 }) // radius 2 either side, plus the centre
  })

  it('places the box minimum at grid (0,0,0)', () => {
    const g = collectGrid(fakeWorld, { x: 0, y: 0, z: 0 }, 1)
    // world y=-1 is stone and sits at grid y=0
    expect(blockAtCell(g, 1, 0, 1)).toBe('stone')
    // the post at world (0,0,0) sits at the grid centre
    expect(blockAtCell(g, 1, 1, 1)).toBe('oak_log')
  })

  it('stores air as null rather than as a name', () => {
    const g = collectGrid(fakeWorld, { x: 0, y: 0, z: 0 }, 1)
    expect(blockAtCell(g, 0, 1, 0)).toBeNull()
  })

  it('treats an unloaded chunk (a null block) as empty', () => {
    const g = collectGrid({ blockAt: () => null }, { x: 0, y: 0, z: 0 }, 1)
    expect(g.cells.every((c) => c === null)).toBe(true)
  })

  it('floors a fractional centre, so a bot position works as-is', () => {
    const g = collectGrid(fakeWorld, { x: 0.7, y: 0.2, z: -0.4 }, 1)
    expect(g).toMatchObject({ sx: 3, sy: 3, sz: 3 })
    expect(blockAtCell(g, 1, 1, 2)).toBe('oak_log') // world (0,0,0) after flooring the centre to (0,0,-1)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/collect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the collector, and widen BotLike**

Create `src/render/collect.ts`:

```ts
import type { BlockGrid } from './blockView.js'
import { isEmpty } from './palette.js'

export type BlockSource = {
  blockAt: (pos: { x: number; y: number; z: number }) => { name?: string } | null
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
        const block = bot.blockAt({ x: cx - radius + x, y: cy - radius + y, z: cz - radius + z })
        const name = block?.name
        if (isEmpty(name)) continue
        cells[(y * side + z) * side + x] = name as string
      }
    }
  }
  return { sx: side, sy: side, sz: side, cells }
}
```

Modify `src/runtime/botManager.ts`, adding one line to `BotLike`:

```ts
export type BotLike = EventEmitter & {
  entity?: { position: { x: number; y: number; z: number } }
  health?: number
  food?: number
  // Present on a real mineflayer bot; the renderer reads the world through it.
  blockAt?: (pos: { x: number; y: number; z: number }) => { name?: string } | null
  end: (reason?: string) => void
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run test/collect.test.ts test/botManager.test.ts`
Expected: PASS. `botManager.test.ts` must stay green — the new field is optional, so no existing fake bot needs changing.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/render/collect.ts test/collect.test.ts src/runtime/botManager.ts
git commit -m "Read a cube of the world into a dense grid for rendering

Keeps world coordinates out of the renderer: the box minimum becomes grid
origin, so a projection only ever thinks in grid space. An unloaded chunk
is stored as empty rather than raised as an error — a render of the loaded
part is more useful than a refusal, and the hole is visible in the picture."
```

---

### Task 5: Isometric view

**Files:**
- Modify: `src/render/blockView.ts`
- Test: `test/blockView.test.ts`

**Interfaces:**
- Consumes: everything from Task 3.
- Produces: `'iso'` becomes a legal `View`. `renderView(grid, 'iso', scale)` returns a raster of `width = (sx + sz) * scale`, `height = (sx + sz) * scale / 2 + sy * scale`.

This task can be deferred without blocking Task 6 — the four elevations and
the top view already answer "how did it come out". Ship it when the flat views
prove hard to judge a roof from.

- [ ] **Step 1: Write the failing test**

Append to `test/blockView.test.ts`:

```ts
describe('isometric view', () => {
  it('sizes the canvas from all three axes', () => {
    const g = grid(2, 3, 2, [])
    const r = renderView(g, 'iso', 4)
    expect(r.width).toBe((2 + 2) * 4)
    expect(r.height).toBe(((2 + 2) * 4) / 2 + 3 * 4)
  })

  it('draws the top of a block brighter than its sides, so the form reads', () => {
    const g = grid(1, 1, 1, [[0, 0, 0, 'oak_planks']])
    const r = renderView(g, 'iso', 8)
    const seen = new Set<string>()
    for (let py = 0; py < r.height; py++)
      for (let px = 0; px < r.width; px++) seen.add(pixel(r, px, py).join(','))
    // background plus three distinct face shades
    expect(seen.size).toBeGreaterThanOrEqual(4)
  })

  it('lets a nearer block cover one behind it', () => {
    const behind = grid(2, 1, 2, [[0, 0, 0, 'cobblestone']])
    const both = grid(2, 1, 2, [[0, 0, 0, 'cobblestone'], [1, 0, 1, 'oak_planks']])
    const a = renderView(behind, 'iso', 6)
    const b = renderView(both, 'iso', 6)
    expect(Buffer.from(b.rgb).equals(Buffer.from(a.rgb))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/blockView.test.ts`
Expected: FAIL — `'iso'` is not assignable to `View`.

- [ ] **Step 3: Add the isometric projection**

In `src/render/blockView.ts`, extend the type and add the renderer:

```ts
export type View = 'north' | 'south' | 'east' | 'west' | 'top' | 'iso'
```

Add these below `renderView`, and make `renderView` delegate when the view is
`'iso'` by inserting `if (view === 'iso') return renderIso(grid, scale)` as its
first line:

```ts
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
  const width = (sx + sz) * scale
  const height = Math.round(((sx + sz) * scale) / 2) + sy * scale
  const raster: Raster = { width, height, rgb: new Uint8Array(width * height * 3) }
  for (let i = 0; i < width * height; i++) {
    raster.rgb[i * 3] = BACKGROUND[0]
    raster.rgb[i * 3 + 1] = BACKGROUND[1]
    raster.rgb[i * 3 + 2] = BACKGROUND[2]
  }

  const half = Math.max(1, Math.round(scale / 2))
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
        for (let row = 0; row < half; row++) {
          const spread = Math.round(((row + 1) / half) * scale)
          for (let col = -spread; col < spread; col++) {
            put(raster, ox + scale / 2 + col, oy + row, shade(base, TOP_SHADE))
            put(raster, ox + scale / 2 + col, oy + half * 2 - 1 - row, shade(base, TOP_SHADE))
          }
        }
        for (let row = 0; row < scale; row++) {
          for (let col = 0; col < scale / 2; col++) {
            put(raster, ox + col, oy + half + row + Math.round(col / 2), shade(base, LEFT_SHADE))
            put(raster, ox + scale - 1 - col, oy + half + row + Math.round(col / 2), shade(base, RIGHT_SHADE))
          }
        }
      }
    }
  }
  return raster
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/blockView.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/render/blockView.ts test/blockView.test.ts
git commit -m "Add an isometric view, so a roof can be judged as a shape

Four flat elevations tell you a wall is complete; none of them tells you
whether the gable reads as a gable. Three face shades and a painter's
ordering are enough for that, and cost no dependency."
```

---

### Task 6: Wire craft_take_screenshot

**Files:**
- Modify: `src/server.ts` — replace the error-only tool with a real one
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: `collectGrid`, `renderView`, `encodePng`.
- Produces: `craft_take_screenshot` returns one `{ type: 'image', data, mimeType: 'image/png' }` per requested view, preceded by a text line naming the box and the views.

Bounds, all enforced by zod: `radius` 1..32 (a 65-block cube is 274k `blockAt`
calls, which is already a second of work), `size` 1..12 pixels per block,
`views` 1..6 entries.

- [ ] **Step 1: Write the failing test**

Append to `test/server.test.ts`, inside the existing `describe`:

```ts
it('renders the world around the bot as PNG images', async () => {
  await joinAndSpawn()
  const shot = await client.callTool({
    name: 'craft_take_screenshot',
    arguments: { world_name: WORLD, task_id: 't', reason: 'checking the build',
                 radius: 2, views: ['north', 'top'], size: 2 },
  })
  expect(shot.isError).toBeFalsy()
  const content = shot.content as Array<{ type: string; data?: string; mimeType?: string; text?: string }>
  const images = content.filter((c) => c.type === 'image')
  expect(images).toHaveLength(2)
  for (const image of images) {
    expect(image.mimeType).toBe('image/png')
    const png = Buffer.from(image.data!, 'base64')
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  expect(content.find((c) => c.type === 'text')?.text).toContain('north')
})

it('rejects a render box that would take the process down', async () => {
  await joinAndSpawn()
  const tooBig = await client.callTool({
    name: 'craft_take_screenshot',
    arguments: { world_name: WORLD, task_id: 't', reason: 'r', radius: 33 },
  })
  expect(tooBig.isError).toBe(true)
  expect(text(tooBig)).toContain('less than or equal to 32')
})

it('says so plainly when there is no bot to look through', async () => {
  const shot = await client.callTool({
    name: 'craft_take_screenshot',
    arguments: { world_name: 'nowhere', task_id: 't', reason: 'r' },
  })
  expect(shot.isError).toBe(true)
  expect(text(shot)).toContain('craft_join_world')
})
```

The fake bot used by `joinAndSpawn` needs a `blockAt`. Find the bot factory in
`test/server.test.ts` and add one field to the object it returns:

```ts
blockAt: (p: { x: number; y: number; z: number }) => ({ name: p.y < 0 ? 'stone' : 'air' }),
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/server.test.ts`
Expected: FAIL — the tool returns its "not available on this install" error.

- [ ] **Step 3: Replace the tool**

In `src/server.ts`, add the imports:

```ts
import { collectGrid } from './render/collect.js'
import { renderView, type View } from './render/blockView.js'
import { encodePng } from './render/png.js'
```

Replace the whole `server.registerTool('craft_take_screenshot', …)` block with:

```ts
  const VIEWS = ['north', 'south', 'east', 'west', 'top', 'iso'] as const

  server.registerTool(
    'craft_take_screenshot',
    {
      description:
        'Render the build from block data as PNG — four elevations, straight down, and isometric. ' +
        'Use it to judge how the build LOOKS once it stands; for whether a block actually landed, ' +
        'a bot.blockAt sweep is still the answer (mcp-craft://skill/world-queries).',
      inputSchema: {
        world_name: z.string().max(256),
        task_id: z.string().max(256),
        reason: z.string().max(4096),
        center: z
          .object({ x: z.number(), y: z.number(), z: z.number() })
          .optional()
          .describe('what to look at; defaults to the bot'),
        radius: z.number().int().min(1).max(32).optional().describe('half-extent of the box, default 12'),
        views: z.array(z.enum(VIEWS)).min(1).max(6).optional().describe('default: all four elevations'),
        size: z.number().int().min(1).max(12).optional().describe('pixels per block, default 6'),
      },
    },
    async ({ world_name, task_id, reason, center, radius, views, size }) => {
      const entry = bots.get(world_name)
      if (!entry || entry.state !== 'ready')
        return err(
          `No ready bot in "${world_name}" (state: ${entry?.state ?? 'none'}). Call craft_join_world, then poll craft_list_bots until state=ready.`,
        )
      const blockAt = (entry.bot as BotLike & { blockAt?: BlockSourceFn }).blockAt
      if (typeof blockAt !== 'function')
        return err('this bot cannot read the world (no blockAt) — rejoin with craft_join_world')

      const centre = center ?? entry.bot.entity?.position
      if (!centre) return err('the bot has no position yet — poll craft_list_bots until state=ready')

      const r = radius ?? 12
      const scale = size ?? 6
      const wanted: View[] = views ?? ['north', 'east', 'south', 'west']
      say(entry.bot, `[devrig] ${reason}`)
      console.error(`craft_take_screenshot task=${task_id} world=${world_name} r=${r} views=${wanted.join(',')}`)

      const grid = collectGrid({ blockAt }, centre, r)
      const images = wanted.map((view) => {
        const raster = renderView(grid, view, scale)
        return {
          type: 'image' as const,
          data: encodePng(raster.width, raster.height, raster.rgb).toString('base64'),
          mimeType: 'image/png' as const,
        }
      })
      const at = `${Math.floor(centre.x)}, ${Math.floor(centre.y)}, ${Math.floor(centre.z)}`
      return {
        content: [
          { type: 'text' as const, text: `${wanted.join(', ')} — a ${r * 2 + 1} block cube centred on (${at}), ${scale}px per block` },
          ...images,
        ],
      }
    },
  )
```

Add the helper type next to the other local types near the top of the file:

```ts
type BlockSourceFn = (pos: { x: number; y: number; z: number }) => { name?: string } | null
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS. The `craft_take_screenshot` description changed, so if
`test/wire.test.ts` asserts on tool descriptions, update that assertion to
match the new text rather than weakening it.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/server.ts test/server.test.ts
git commit -m "Give craft_take_screenshot a success path that needs no GL

design.md 13 descoped the screenshot because headless-gl would not build
reliably. That reasoning still stands, so this path does not use GL at all:
it reads a bounded cube through bot.blockAt, projects it orthographically,
and encodes the PNG by hand.

Every bound is in the schema. A render box scales cubically and an agent
will eventually ask for the whole chunk."
```

---

### Task 7: Record the decision, and teach the agent to look

**Files:**
- Modify: `docs/design.md` — §6 and §13
- Modify: `resources/recipes/prompt/skill.md` — the closing step
- Modify: `TODO.md` — close the screenshot item
- Test: `test/recipes.test.ts`

**Interfaces:**
- Consumes: the tool from Task 6.
- Produces: nothing code depends on.

- [ ] **Step 1: Write the failing test**

Append inside the `describe('recipe corpus', …)` block in `test/recipes.test.ts`:

```ts
it('the index tells the agent to look at what it built', async () => {
  // Every defect found on 2026-08-29 was found by a human looking at the
  // world and saying so. A verdict of "done" that was never looked at is
  // exactly the failure this step exists to prevent.
  const index = await readFile(`${RECIPES}/prompt/skill.md`, 'utf8')
  expect(index).toContain('craft_take_screenshot')
  expect(index).toMatch(/look at (them|the)/i)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/recipes.test.ts`
Expected: FAIL — `skill.md` does not mention `craft_take_screenshot`.

- [ ] **Step 3: Make the three documentation edits**

In `resources/recipes/prompt/skill.md`, add a closing rule to the numbered
rules (keep the existing numbering; this becomes the last one):

```markdown
N. **Look at what you built before you call it done.** When the build stands,
   `craft_take_screenshot` it from all four sides and from above, and look at
   the pictures. Compare them against what you set out to build. Then say
   plainly whether it is right — and if it is not, name what is wrong and fix
   it. A verdict you did not look at is not a verdict. Correctness is still
   the `bot.blockAt` sweep's job; the pictures answer a different question,
   which is whether it looks like the thing you meant to build.
```

In `docs/design.md` §6, after the "verify via the API, not pixels" sentence,
add:

```markdown
Refined 2026-08-29: the API remains the only judge of **correctness** — no
placement is ever confirmed by looking at a picture. Pixels answer a question
the API cannot: whether the result looks like the building it was meant to be.
See `docs/superpowers/specs/2026-08-29-seeing-and-planning-design.md`.
```

In `docs/design.md` §13, next to the screenshot descope, add:

```markdown
Reversed 2026-08-29, without reversing the reasoning. headless-gl really was
unreliable, so the success path that shipped uses no GL: an orthographic
projection computed from `bot.blockAt` and encoded as PNG over `node:zlib`.
No native dependency, deterministic output, and it shows the whole building
rather than one wall.
```

In `TODO.md`, strike the open screenshot item and note what shipped.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/design.md resources/recipes/prompt/skill.md TODO.md test/recipes.test.ts
git commit -m "Tell the agent to look at what it built, and record why

Every defect found on 2026-08-29 was found by a human watching the world in
first person. The agent's own check answered 'does it match the predicate'
and never 'does it look right', so a broken house could pass.

Records the two spec decisions this changes: 13's descope is reversed but
its reasoning is not (the success path uses no GL), and 6's verify-via-API
rule is refined rather than dropped — the API still owns correctness, and
pixels now answer appearance."
```

---

## Verification

After Task 7, all of this must hold:

```bash
npx tsc --noEmit          # clean
npm test                  # every test green, including the new render suites
npm run build             # dist rebuilt
```

Then, against a live world, with a bot joined:

1. `craft_take_screenshot` with `radius: 12` on a house that exists — five
   images come back, and the elevations show a building rather than noise.
2. The same call on empty ground — flat sky, which is the correct answer and
   proves the renderer is not inventing structure.

## Notes for the implementer

- The MCP server that a running Claude Code session talks to was started from
  `dist/`. Changes to `src/` do not take effect until the server is restarted
  (`/mcp` → reconnect). Do not spend time debugging a change that is simply
  not loaded yet.
- `test/server.test.ts` drives the real MCP server over an in-memory
  transport. Its fake bot is the one that needs `blockAt`; the fakes in
  `test/botManager.test.ts` do not, because the field is optional.
