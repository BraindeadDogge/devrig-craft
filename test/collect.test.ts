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
