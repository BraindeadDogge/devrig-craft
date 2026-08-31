import { describe, it, expect } from 'vitest'
import { Vec3 } from 'vec3'
import { faceLabel, reachRefusal, sightRefusal } from '../src/runtime/placementContract.js'

describe('placement contract refusals', () => {
  it('names every face the way a player would read it', () => {
    expect(faceLabel(new Vec3(0, 1, 0))).toBe('top')
    expect(faceLabel(new Vec3(0, -1, 0))).toBe('bottom')
    expect(faceLabel(new Vec3(1, 0, 0))).toBe('+x side')
    expect(faceLabel(new Vec3(0, 0, -1))).toBe('-z side')
  })

  it('says how far past the reach the target was', () => {
    const msg = reachRefusal('placeBlock', new Vec3(10, -60, 3), 5.81, 4.5)
    expect(msg).toContain('(10, -60, 3)')
    expect(msg).toContain('5.8')
    expect(msg).toContain('4.5')
    expect(msg).toContain('walk closer')
  })

  it('lists the faces of that block that ARE clickable from here', () => {
    const msg = sightRefusal({
      refName: 'oak_planks',
      refPos: new Vec3(-20, -59, 31),
      face: new Vec3(0, 0, 1),
      visibleFaces: [new Vec3(0, 1, 0), new Vec3(-1, 0, 0)],
      distance: 2.14,
      reach: 4.5,
    })
    expect(msg).toContain('+z side face of oak_planks at (-20, -59, 31)')
    expect(msg).toContain('clickable right now: top, -x side')
    expect(msg).toContain('2.1')
  })

  it('says so plainly when no face of that block is clickable', () => {
    const msg = sightRefusal({
      refName: 'dirt',
      refPos: new Vec3(0, 0, 0),
      face: new Vec3(1, 0, 0),
      visibleFaces: [],
      distance: 1.2,
      reach: 4.5,
    })
    expect(msg).toContain('no face of it is clickable from here')
    expect(msg).not.toContain('clickable right now:')
  })
})
