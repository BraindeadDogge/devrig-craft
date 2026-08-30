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
