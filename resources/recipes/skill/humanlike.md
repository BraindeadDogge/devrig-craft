# Moving and building like a human

A human player is never frozen and never lost. They walk in straight lines
looking where they go, hop small ledges without breaking stride, take a step
when something is barely out of reach, sneak at edges so they do not fall,
nerd-pole up when they need height, and punch through a block that boxes them
in — all within a second or two, without stopping to think. This article is
that instinct, as code. The house recipe already embeds most of it; use these
fences when you move or build outside a prepared recipe.

The doctrine, in order of instinct:

1. **Keep moving.** If your position has not changed for ~1.5 s while you
   meant to move: jump. Still stuck a second later: break the block in your
   way (creative punches instantly). A human never pushes a wall for a
   minute.
2. **Walk to travel, fly to work at height.** Face where you go, sprint on
   open ground, let auto-jump take 1-block steps (the bot runtime does this for
   you). Do not fly to cross the ground — pathfinding is better at it and a
   hovering bot cannot be routed. But to reach a roof in **creative**, fly:
   that is what a player does, and it leaves nothing behind to clean up.
3. **A step beats a repath.** Barely out of reach (>4.3) → take one or two
   steps toward the target and place; do not re-plan a whole route.
4. **Height: fly in creative, pillar in survival.** Need to reach up? In
   creative, `startFlying()` and hover where the work is. In survival,
   nerd-pole — but ONCE, and then work outward block against block. Pillaring
   under every cell you want to place is how a bot fills its own living room
   with scaffolding it then cannot remove.
5. **Sneak at edges.** Working at a drop (roof line, bridge)? Hold sneak —
   you cannot walk off the edge while sneaking. Release it after.
6. **Fix mistakes immediately.** A wrong block gets broken and replaced the
   moment you notice, not at the end.
7. **Respect the human's space.** Never build within 2 blocks of them,
   never on top of them, and glance at them when you talk in chat.

## Striding: bounded, self-unsticking walking

```js
// Walk to a target like a human: face it, sprint, hop ledges (auto-jump is
// built in), and if pinned — jump, then punch through. Bounded, no hangs.
async function stride(target, timeoutMs = 10000) {
  try { bot.creative.stopFlying() } catch (e) { /* not flying */ }
  const deadline = Date.now() + timeoutMs
  let lastPos = bot.entity.position.clone()
  let lastMove = Date.now()
  bot.setControlState('sprint', true)
  bot.setControlState('forward', true)
  try {
    while (Date.now() < deadline) {
      if (bot.entity.position.distanceTo(target.offset(0.5, 0, 0.5)) < 1.6) return true
      await bot.lookAt(target.offset(0.5, 1.62, 0.5), true)
      await sleep(100)
      if (bot.entity.position.distanceTo(lastPos) > 0.15) {
        lastPos = bot.entity.position.clone()
        lastMove = Date.now()
      } else if (Date.now() - lastMove > 1500) {
        bot.setControlState('jump', true)
        await sleep(300)
        bot.setControlState('jump', false)
        if (Date.now() - lastMove > 3000) {
          // still pinned: break what is in the way, face level first
          const d = target.offset(0.5, 0, 0.5).minus(bot.entity.position)
          const step = new Vec3(Math.sign(Math.round(d.x)), 0, Math.sign(Math.round(d.z)))
          for (const dy of [1, 0]) {
            const b = bot.blockAt(bot.entity.position.floored().offset(step.x, dy, step.z))
            if (b && b.boundingBox === 'block')
              await Promise.race([bot.dig(b).catch((e) => print(`  dig refused: ${e.message}`)), sleep(3000)])
          }
          lastMove = Date.now()
        }
      }
    }
    return bot.entity.position.distanceTo(target.offset(0.5, 0, 0.5)) < 2.5
  } finally {
    bot.setControlState('forward', false)
    bot.setControlState('sprint', false)
  }
}

const goal = new Vec3(120, -60, -40) // ← where you want to stand
print((await stride(goal)) ? `arrived: ${bot.entity.position.floored()}` : `stopped short at ${bot.entity.position.floored()}`)
```

## Which face can I actually click?

You have no camera. What you "see" is a ray cast through the block map: the
runtime refuses any click whose eye-ray does not reach that face first, so cast
the same ray yourself and pick a face that works instead of trying all six and
collecting refusals.

A block is placed by clicking a FACE of an existing neighbour — the packet
carries the neighbour and the face, and the server puts the new block in
`neighbour + face`. So a placement needs a neighbour that is **solid**, within
**4.5**, and **visible**.

This function is **copied verbatim** from `mcp-craft://skill/house` and a test
pins the two together. Do not tidy it apart: the last time these drifted, this
copy stopped short at "the ray reached the right block" and every recipe written
from it inherited a sight test looser than the one the runtime enforces.

```js
// Cast the runtime's own ray: aim 0.45 INSIDE the face, never at its plane —
// a ray aimed at the plane grazes it and clips the neighbour sharing it.
const eyes = () => bot.entity.position.offset(0, 1.62, 0)
function seesFace(refPos, face) {
  const from = eyes()
  const aim = refPos.offset(0.5, 0.5, 0.5).plus(face.scaled(0.45))
  const dir = aim.minus(from)
  const dist = dir.norm()
  if (dist < 0.001) return true
  const hit = bot.world.raycast(from, dir.scaled(1 / dist), dist + 0.6)
  if (!hit) return false // nothing in the way at all (or the chunk is not loaded)
  // raycast hands back the BLOCK it hit; its typings only promise x/y/z.
  const at = hit['position'] ?? new Vec3(hit.x, hit.y, hit.z)
  if (!at.equals(refPos)) return false
  // Reaching the right BLOCK is not enough: the runtime also requires the ray
  // to ENTER through the face you are clicking. You cannot click the side of a
  // block you are standing on — the ray comes down through its top, however
  // close you are. Measured live in a real world: without this check the script
  // approved 12 of 80 faces the contract then refused, and one pick in five was
  // doomed before it was sent. Never the reverse — this test is the strict one.
  const ix = hit['intersect']
  if (!ix) return true
  const axis = face.x !== 0 ? 'x' : face.y !== 0 ? 'y' : 'z'
  const plane = refPos[axis] + (face[axis] > 0 ? 1 : 0)
  return Math.abs(ix[axis] - plane) < 0.05
}
const FACES = [
  new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
]
const target = new Vec3(105, -58, -42) // ← the cell you want to fill
const usable = FACES.filter((face) => {
  const refPos = target.minus(face)
  const ref = bot.blockAt(refPos)
  return ref && ref.boundingBox === 'block' &&
    eyes().distanceTo(refPos.offset(0.5, 0.5, 0.5)) <= 4.3 && seesFace(refPos, face)
})
print(usable.length
  ? `clickable now: ${usable.map((f) => `${f.x},${f.y},${f.z}`).join(' | ')}`
  : 'nothing clickable from here — step around the target, or get above it')
```

**You cannot click the side of a block you are standing on.** The ray leaves
your eye above it and enters through its top, so the side face is not clickable
however close it is — and the correct reference for a floor cell is the TOP of
the block beneath it, not the side of its neighbour. This is the single most
common wasted click.

**A ground block two cells away is not visible even on open ground.** The ray to
its centre dips below the surface within a third of a block and hits the soil
you are standing on. That is why floors are laid from the cell next to them,
never leaned across.

## A step beats a repath

```js
// Something is barely out of reach: step toward it, do not re-plan a route.
const target = new Vec3(105, -58, -42) // ← the block you want to touch
function inReach(t) {
  return bot.entity.position.offset(0, 1.62, 0).distanceTo(t.offset(0.5, 0.5, 0.5)) <= 4.3
}
for (let tries = 0; tries < 3 && !inReach(target); tries++) {
  const d = target.offset(0.5, 0, 0.5).minus(bot.entity.position)
  const stepTo = bot.entity.position.floored().offset(Math.sign(d.x), 0, Math.sign(d.z))
  bot.setControlState('forward', true)
  await bot.lookAt(stepTo.offset(0.5, 1.62, 0.5), true)
  await sleep(300)
  bot.setControlState('forward', false)
}
print(inReach(target) ? 'in reach now' : 'still out of reach — needs a real walk or a pillar')
```

## Where am I, and how do I get out of this hole?

You have no eyes and no map — you have coordinates. So say them: your own
position, the build's origin, and the difference between them. A bot that
reports `rel: {dx: 3, dy: -4, dz: 2}` has just told you it is four blocks below
its own floor, standing in a hole it dug, which is why every placement is being
refused for sight.

```js
// Locate yourself against whatever you are building, then climb out if you are
// under it. Below the build, nothing you place is visible: fix that first.
const BASE = new Vec3(100, -61, 100) // ← the build origin you are working from
const y0 = BASE.y + 1
const f = bot.entity.position.floored()
const rel = { dx: f.x - BASE.x, dy: f.y - y0, dz: f.z - BASE.z }
printJson({ at: [f.x, f.y, f.z], base: [BASE.x, BASE.y, BASE.z], rel, belowBuild: rel.dy < 0 })
const boxedIn = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([ox, oz]) => {
  const b = bot.blockAt(f.offset(ox, 1, oz)) // head height: what pins a person
  return b && b.boundingBox === 'block'
}).length
print(rel.dy < 0 || boxedIn >= 3
  ? `stuck: ${rel.dy} below the build, ${boxedIn} sides walled — pillar up or dig steps toward BASE`
  : 'standing free at build level')
```

Climbing out is the nerd-pole below, aimed at `y0`; digging out is the same dig
the striding watchdog does. Either is fine — a person does whichever is
shorter. What is not fine is placing block after block from the bottom of a
hole and reporting that the walls "did not land".

## Reaching something above you

The commonest way a build stalls: the next block is **above your eye**, and no
amount of stepping sideways will fix it. A block is placed by clicking a face
of an existing neighbour, and for a block above you the only neighbour is the
one underneath it — whose clickable face is its **top**. A top face cannot be
seen from below its own plane. So the ray fails, `chooseFace` returns nothing,
and a naive script reports "no face from anywhere I can stand" and moves on,
forever, for every block above the second course.

The bot has no picture of the world, only coordinates — so it will not *notice*
this. Test for it explicitly, and when it is true, change your height rather
than your aim:

```js
// Is the thing I want to click above my eye? Then no sideways step helps.
const target = bot.entity.position.floored().offset(2, 3, 0) // ← the cell you want
const aboveMyEye = target.y > bot.entity.position.y + 1.2
print(`target ${target} is ${aboveMyEye ? 'ABOVE my eye — get up there' : 'at my level'}`)
```

Two ways up, in order of preference:

1. **Stand on what you already built.** Lay a wall course, then climb onto it
   before laying the next one. Costs nothing and leaves nothing to clean up.
2. **Pillar up** (next section) onto a perch beside the target — and record
   every block you place so you can dig the scaffolding back out when you
   leave.

`mcp-craft://skill/house` wires both into one helper, `raiseTo(dx, dy, dz)`:
walk there if a floor already exists, otherwise walk to the spot *below* the
goal and nerd-pole the rest. Two rules make it work, and both are easy to get
wrong:

- **Never hand the pathfinder a goal in mid-air.** There is no floor under it
  yet, so it cannot plan, and it spends its entire timeout proving that. Walk
  to the column at your *own* height first, then gain the height yourself.
- **A stand-spot with no floor under it is not unusable** — beside a high wall
  or a roof slope, that is precisely the spot you pillar up to. Filtering those
  out is what makes a bot report "nowhere to stand" while standing next to its
  own half-built house.

## Flying to the work (creative only)

Reaching height by building a tower is a survival technique. In creative a
player presses jump twice and flies to where the work is — no scaffolding, no
cleanup, and no pathfinder fighting a ledge that has no walking route to it.

Measured in a live world, so you do not have to guess: **`forward` + look moves
a weightless bot at 2.97 blocks/s**, **holding `velocity.y` on each physics tick
climbs at 7 blocks/s**, and **`jump` and `sneak` both do exactly nothing** —
0.00 either way — because a jump is only applied while `onGround`, and a flying
bot never is.

```js
// FLY, do not teleport. bot.creative.flyTo walks the entity POSITION along a
// straight line with no collision check and waits on a `move` event that has
// no timeout — aimed through a wall it never returns. Move the ordinary way
// instead and the server simply accepts it.
const target = bot.entity.position.floored().offset(3, 4, 0) // ← the cell you want
const perch = target.offset(0, 0, -1).offset(0.5, 0, 0.5)    // beside it, not in it
if (bot.game.gameMode !== 'creative') {
  print('survival: no flight — pillar up instead (next section)')
} else {
  await bot.creative.startFlying()
  // Vertical is the one axis the controls cannot drive while weightless:
  // jump and sneak both move you 0.00, because a jump needs onGround and
  // flight never is. Hold the velocity yourself, proportionally.
  const hold = () => {
    const dy = perch.y - bot.entity.position.y
    bot.entity.velocity.y = Math.max(-0.4, Math.min(0.4, dy * 0.6))
  }
  bot.on('physicsTick', hold)
  const deadline = Date.now() + 6000
  try {
    while (Date.now() < deadline && bot.entity.position.distanceTo(perch) > 0.8) {
      const d = perch.minus(bot.entity.position)
      if (Math.hypot(d.x, d.z) > 0.6) {
        await bot.lookAt(new Vec3(perch.x, bot.entity.position.y + 1.62, perch.z), true)
        bot.setControlState('forward', true)
      } else bot.setControlState('forward', false)
      await sleep(80)
    }
  } finally {
    bot.removeListener('physicsTick', hold)
    bot.setControlState('forward', false)
    bot.entity.velocity.y = 0
  }
  print(`hovering at ${bot.entity.position.floored()}, ${bot.entity.position.distanceTo(perch).toFixed(2)} from the perch`)
  // ... place from here ...
  await bot.creative.stopFlying()      // ALWAYS pair this with startFlying
  for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(150)
  print(`back down at ${bot.entity.position.floored()}, onGround=${bot.entity.onGround}`)
}
```

**`startFlying()` and `stopFlying()` are a pair, and the order matters.**
mineflayer restores gravity from a value that only `startFlying()` ever saves,
so calling `stopFlying()` on a bot that never flew sets gravity to `null`. A bot
with null gravity never lands, `onGround` stays `false` forever, and since a
jump is only applied while on the ground, **every jump silently does nothing** —
no pillaring, no climbing, no roof. Measured live: gravity went null on the
first walk of a session and two consecutive build runs logged 208 failed pillar
attempts. The runtime now guards this, but never call `stopFlying()`
speculatively "to make sure we are not flying".

**Land before you walk.** The pathfinder cannot route a hovering bot. Call
`stopFlying()` and wait for `onGround` before any `goto`.

## Nerd-poling: height from under your feet

```js
// Pillar up like a human: look straight down, jump, place beneath yourself.
// Then ALWAYS come back down by digging the pillar out — no floating towers.
await bot.creative.setInventorySlot(36, new Item(mcData.itemsByName.oak_planks.id, 16))
bot.setQuickBarSlot(0)
const HEIGHT = 3
let rose = 0
for (let i = 0; i < HEIGHT; i++) {
  const feet = bot.entity.position.floored()
  await bot.lookAt(feet.offset(0.5, -0.5, 0.5), true)
  bot.setControlState('jump', true)
  await sleep(150)
  const ref = bot.blockAt(feet.offset(0, -1, 0))
  if (ref && ref.boundingBox === 'block') {
    await Promise.race([
      bot.placeBlock(ref, new Vec3(0, 1, 0)).catch((e) => print(`  pillar refused: ${e.message}`)),
      sleep(1200),
    ])
  }
  bot.setControlState('jump', false)
  await sleep(400)
  const now = bot.entity.position.floored()
  if (now.y > feet.y) rose++
}
print(`rose ${rose}/${HEIGHT}`)
// ... do the high work here ...
for (let i = 0; i < rose; i++) {
  const under = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0))
  if (!under || under.boundingBox !== 'block') break
  await Promise.race([bot.dig(under).catch((e) => print(`  dig refused: ${e.message}`)), sleep(3000)])
  await sleep(400) // fall onto the next one
}
print(`back down at ${bot.entity.position.floored()}`)
```

## Sneak-bridging over a gap

```js
// Crouch at the edge and place against the side face of the block underfoot —
// the classic human bridge. Sneak means you cannot fall off while doing it.
await bot.creative.setInventorySlot(36, new Item(mcData.itemsByName.oak_planks.id, 16))
bot.setQuickBarSlot(0)
const dir = new Vec3(1, 0, 0) // ← bridging direction
const SPAN = 4
bot.setControlState('sneak', true)
let laid = 0
for (let i = 0; i < SPAN; i++) {
  const under = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0))
  if (!under || under.boundingBox !== 'block') break
  await bot.lookAt(under.position.plus(dir).offset(0.5, 0.4, 0.5), true)
  await Promise.race([
    bot.placeBlock(under, dir).catch((e) => print(`  bridge refused: ${e.message}`)),
    sleep(1500),
  ])
  if (bot.blockAt(under.position.plus(dir))?.boundingBox === 'block') laid++
  bot.setControlState('forward', true)
  await sleep(350)
  bot.setControlState('forward', false)
}
bot.setControlState('sneak', false)
print(`bridged ${laid}/${SPAN}`)
```
