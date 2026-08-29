# Building by placing blocks

The promo happy path: the human says "build me a house", and thirty seconds
later there is a house next to them that they watched go up block by block.

This is the *physical* path — the bot really walks, looks and places. It works
on any world, cheats or not. If cheats are on and the build is large, read
`mcp-craft://skill/building-with-commands` instead; `/fill` is a thousand times
faster and the human sees the result appear at once.

## Step 1 — pick a spot, do not build on the human

Never build at the bot's feet without looking: you will trap yourself, cover
the player, or hang blocks in mid-air. Find a flat patch first.

```js
// Find a flat 5x5 patch of ground near the human and print its corner.
const human = bot.nearestEntity((e) => e.type === 'player')
const anchor = (human ? human.position : bot.entity.position).floored()

// The first solid block with air above it, scanning down: that is the ground.
function groundY(x, z) {
  for (let y = anchor.y + 8; y > anchor.y - 12; y--) {
    const here = bot.blockAt(new Vec3(x, y, z))
    const above = bot.blockAt(new Vec3(x, y + 1, z))
    if (!here || !above) continue
    if (here.boundingBox === 'block' && above.boundingBox === 'empty') return y
  }
  return null
}

let best = null
for (let dx = -12; dx <= 12; dx += 1) {
  for (let dz = -12; dz <= 12; dz += 1) {
    // The PATCH spans [dx, dx+4] x [dz, dz+4]; reject any patch whose area
    // (plus a 1-block margin) contains the human's column at (0, 0) — testing
    // only the corner would happily pick a patch with the human inside it.
    if (dx - 1 <= 0 && 0 <= dx + 5 && dz - 1 <= 0 && 0 <= dz + 5) continue
    const corner = anchor.offset(dx, 0, dz)
    const heights = []
    for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) heights.push(groundY(corner.x + x, corner.z + z))
    if (heights.some((y) => y === null)) continue
    if (Math.max(...heights) !== Math.min(...heights)) continue // not flat
    const dist = Math.abs(dx) + Math.abs(dz)
    if (best === null || dist < best.dist) best = { x: corner.x, y: heights[0] + 1, z: corner.z, dist }
  }
}
print(best ? `build here: ${best.x} ${best.y} ${best.z}` : 'no flat 5x5 nearby — level the ground or use /fill')
```

`best.y` is the *first air layer*, which is where the walls start. **Do not
"lay a floor" at ground level** — that cell is the ground block itself and
placing into it hangs (see Step 3). The ground is your floor; if the human
wants planks underfoot, dig each ground block first, then place into the
hole.

## Step 2 — creative flight and a stocked hotbar

In creative you can fill your own hotbar. Slot 36 is hotbar slot 0 (the
inventory is indexed 9..44; 36..44 is the hotbar), and `Item` is in scope
precisely so you never reach for `require`.

```js
// Stock the hotbar and take off. Creative only.
if (bot.game.gameMode !== 'creative') {
  print(`game mode is ${bot.game.gameMode} — ask the human for creative, or gather blocks first`)
} else {
  await bot.creative.setInventorySlot(36, new Item(mcData.itemsByName.stone.id, 64))
  bot.creative.startFlying()
  print('hotbar slot 0 = 64 stone, flying')
}
```

## Step 3 — the place loop, with reach handled

`bot.placeBlock(referenceBlock, faceVector)` clicks an **existing** block's
face; the new block appears at `reference.position.plus(faceVector)`. Three
constraints bite constantly:

- the reference block must be solid — you cannot place against air;
- the target must be within ~4.5 blocks, and the bot must be looking at it;
- **the target cell must be empty.** If it already holds a solid block (the
  ground itself, a leftover from a previous attempt), the server silently
  rejects the click and `bot.placeBlock` **hangs forever** waiting for a
  block update that never comes. On flat ground this bites immediately:
  the "floor" at ground level IS the grass layer — use the existing ground
  as the floor (start walls at the first air layer), or dig the cell first.

So: derive the reference from the target, walk closer when out of reach, and
NEVER await a bare `placeBlock` — race it with a timeout and re-check
`blockAt`, as the loop below does.

```js
// Place a 5x5x3 stone box with a door gap, repositioning when out of reach.
// The bot has flown since Step 1 — NEVER anchor at bot.entity.position here.
const base = new Vec3(100, 65, 100) // ← replace with the "build here" x y z printed by Step 1
const FACES = [
  new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
]
bot.pathfinder.setMovements(new Movements(bot))

async function place(target) {
  const existing = bot.blockAt(target)
  // Occupied cell: placing into it makes placeBlock hang forever. Say so.
  if (existing && existing.boundingBox === 'block') return `occupied by ${existing.name}`
  for (const face of FACES) {
    const ref = bot.blockAt(target.minus(face))
    if (!ref || ref.boundingBox !== 'block') continue
    if (bot.entity.position.distanceTo(target) > 4) {
      await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2))
    }
    await bot.lookAt(target.offset(0.5, 0.5, 0.5), true)
    // NEVER await placeBlock bare — it hangs when the server rejects the
    // click. Race a 4s watchdog and trust blockAt, not the promise. Print the
    // refusal: "out of arm's reach" and "no line of sight" come from the
    // runtime's placement contract and tell you exactly what to fix.
    await Promise.race([
      bot.placeBlock(ref, face).catch((e) => print(`  refused: ${e.message}`)),
      sleep(4000),
    ])
    if (bot.blockAt(target)?.boundingBox === 'block') return 'placed'
    // Placement did not land — try the next face.
  }
  return 'no landed placement from any face'
}

const isWall = (dx, dz) => dx === 0 || dz === 0 || dx === 4 || dz === 4
const isDoor = (dx, dz, dy) => dz === 0 && dx === 2 && dy < 2
let placed = 0
const failures = []
for (let dy = 0; dy < 3; dy++) {
  for (let dx = 0; dx < 5; dx++) {
    for (let dz = 0; dz < 5; dz++) {
      if (!isWall(dx, dz) || isDoor(dx, dz, dy)) continue
      const target = base.offset(dx, dy, dz)
      const outcome = await place(target)
      if (outcome === 'placed') placed++
      else if (outcome !== 'already there') failures.push({ dx, dy, dz, outcome })
    }
  }
}
print(`placed ${placed} blocks, ${failures.length} failures, base: ${base.x} ${base.y} ${base.z}`)
if (failures.length) printJson(failures.slice(0, 10))
```

Add the roof the same way with `dy === 3` and no `isWall` filter. Torches are
their own small pass — swap the hotbar and stand them on the ground inside:

```js
// Torches on the interior floor, against opposite walls.
const base = new Vec3(100, 65, 100) // ← the same base the place loop printed
await bot.creative.setInventorySlot(36, new Item(mcData.itemsByName.torch.id, 4))
bot.pathfinder.setMovements(new Movements(bot))
for (const [dx, dz] of [[1, 1], [3, 3]]) {
  const target = base.offset(dx, 0, dz)
  const floor = bot.blockAt(target.offset(0, -1, 0))
  if (!floor || floor.boundingBox !== 'block') {
    print(`no solid floor under ${target.x} ${target.z} — skip`)
    continue
  }
  if (bot.entity.position.distanceTo(target) > 4) {
    await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2))
  }
  await bot.placeBlock(floor, new Vec3(0, 1, 0))
}
print('torches placed — the sweep should now see "torch" at (1,0,1) and (3,0,3)')
```

## Step 4 — verify, then say it is done

Never trust the loop. The loop can succeed while the server silently refuses a
placement, and the human is looking at the truth.

```js
// Expected-vs-actual sweep over the box we just built. Anchor on the base
// the place loop PRINTED — the bot has moved since, its position is noise.
const base = new Vec3(100, 65, 100) // ← replace with the base printed by the place loop
const isWall = (dx, dz) => dx === 0 || dz === 0 || dx === 4 || dz === 4
const isDoor = (dx, dz, dy) => dz === 0 && dx === 2 && dy < 2

const wrong = []
for (let dy = 0; dy < 3; dy++)
  for (let dx = 0; dx < 5; dx++)
    for (let dz = 0; dz < 5; dz++) {
      if (!isWall(dx, dz) || isDoor(dx, dz, dy)) continue
      const at = base.offset(dx, dy, dz)
      const got = bot.blockAt(at)
      const name = got ? got.name : 'unloaded'
      if (name !== 'stone') wrong.push({ x: at.x, y: at.y, z: at.z, want: 'stone', got: name })
    }

print(wrong.length === 0 ? 'VERIFIED: all wall blocks are stone' : `INCOMPLETE: ${wrong.length} blocks wrong`)
if (wrong.length) printJson(wrong.slice(0, 20))
```

Report to the human what the sweep said, not what the place loop said. The
general form of this pattern is in `mcp-craft://skill/world-queries`.
