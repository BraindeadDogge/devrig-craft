import type { Vec3 } from 'vec3'

// The human placement contract refuses clicks a player could not make. A
// refusal is the only feedback a script gets, so it names the way out: which
// faces of that block ARE clickable from where the bot stands, and how far the
// target was against the reach. Pure functions — the wiring lives in
// mineflayerFactory, these are what the tests hold onto.

type FaceLike = { x: number; y: number; z: number }

const at = (p: FaceLike) => `(${p.x}, ${p.y}, ${p.z})`

export function faceLabel(face: FaceLike): string {
  if (face.y > 0) return 'top'
  if (face.y < 0) return 'bottom'
  if (face.x > 0) return '+x side'
  if (face.x < 0) return '-x side'
  if (face.z > 0) return '+z side'
  if (face.z < 0) return '-z side'
  return 'unknown face'
}

export function reachRefusal(
  action: 'placeBlock' | 'dig',
  target: FaceLike,
  distance: number,
  reach: number,
): string {
  return (
    `${action}: ${at(target)} is out of arm's reach — ${distance.toFixed(1)} away, ` +
    `the limit is ${reach} — walk closer first (one or two steps is usually enough).`
  )
}

export function sightRefusal(args: {
  refName: string
  refPos: FaceLike
  face: FaceLike
  visibleFaces: FaceLike[]
  distance: number
  reach: number
}): string {
  const { refName, refPos, face, visibleFaces, distance, reach } = args
  const head =
    `placeBlock: no line of sight to the ${faceLabel(face)} face of ${refName} at ${at(refPos)} — ` +
    `a person cannot click through blocks.`
  const where = ` You are ${distance.toFixed(1)} away (reach ${reach}).`
  return visibleFaces.length
    ? `${head}${where} Faces of that block clickable right now: ` +
      `${visibleFaces.map(faceLabel).join(', ')} — click one of those, or move so the face you want points at you.`
    : `${head}${where} no face of it is clickable from here: step around the block, or get above it.`
}

export function digSightRefusal(blockName: string, pos: FaceLike, distance: number, reach: number): string {
  return (
    `dig: no line of sight to ${blockName} at ${at(pos)} — a person cannot mine through walls. ` +
    `You are ${distance.toFixed(1)} away (reach ${reach}); the ray to its centre hits something else first, ` +
    `which is what happens when you lean across a floor instead of standing next to it.`
  )
}

export type { Vec3 }
