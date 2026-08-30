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
