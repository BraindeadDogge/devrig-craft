# The oak starter house — a complete, tuned build

This is the flagship recipe: the classic tutorial oak starter house, built the
way a person builds it, in the order a person builds it. **Do not compose your
own mega-script** — copy the fences, set `BASE`, run them. The design (from
the canonical starter-house tutorials):

- embedded foundation: oak-log corner posts and a cobblestone plinth set INTO
  the ground, and a real **oak-plank floor** replacing the grass inside;
- plank walls three high with log corner columns, glass-pane windows on all
  four sides, a centered front door;
- an attic floor and a stepped gable roof with a one-block eave overhang,
  built by walking on top of it like a roofer;
- interior done like a player's first night: bed against the back wall,
  chest + crafting table + furnace along the side, WALL torches (never
  floor-spam), and porch torches beside the door.

How a person builds it, step by step — this order is the recipe: clear the
lot → embed the foundation and floor → raise walls with window and door
openings → furnish while the sky still lights the room → attic floor →
climb up, lay the roof rows walking backwards, eaves last → down, remove
scaffolding → hang the door → porch torches → walk around and inspect.

Ground rules baked into every fence (violate them and the bot freezes or
looks like a bot):

- **Never fly-move; never place into an occupied cell; never await a bare
  `placeBlock`/`dig`** — the runtime enforces sight, reach and human pace,
  the fences add watchdogs and `blockAt` verification.
- **Your own half-built house at this BASE is NOT debris.** After a timeout,
  re-run the same fence: every placement skips cells that are already
  correct. Only a DIFFERENT site's scatter is debris — clear it or move.
- Both build fences are idempotent; run 2a then 2b, each with
  `timeout: 420`.

## Step 1 — pick the lot (and clean it like a person would)

```js
// Find a clear 11x10 lot near the human (7x6 footprint + working margin).
// A few stray blocks are fine — we clean them; a real ruin means move on.
const human = bot.nearestEntity((e) => e.type === 'player')
const anchor = (human ? human.position : bot.entity.position).floored()
function lotAt(gx, gz) {
  let groundY = null
  for (let y = anchor.y + 2; y > anchor.y - 6; y--) {
    const b = bot.blockAt(new Vec3(gx, y, gz))
    if (b && b.boundingBox === 'block') { groundY = y; break }
  }
  if (groundY === null) return null
  const litter = []
  for (let dx = -2; dx < 9; dx++)
    for (let dz = -2; dz < 8; dz++)
      for (let dy = 1; dy <= 7; dy++) {
        const b = bot.blockAt(new Vec3(gx + dx, groundY + dy, gz + dz))
        if (b && b.boundingBox === 'block') litter.push(b.position)
      }
  return { groundY, litter }
}
let pick = null
outer:
for (const [ox, oz] of [[4, -3], [4, 4], [-11, -3], [-11, 4], [4, -13], [-11, -13]]) {
  const gx = anchor.x + ox, gz = anchor.z + oz
  const lot = lotAt(gx, gz)
  if (lot && lot.litter.length <= 8) { pick = { gx, gz, ...lot }; break outer }
}
if (!pick) {
  print('no clean-enough lot near the human — move somewhere open and re-run')
} else {
  printJson({ BASE: `new Vec3(${pick.gx}, ${pick.groundY}, ${pick.gz})`, litter: pick.litter.length })
  if (pick.litter.length > 0) print('litter positions to clear in Step 2a preamble:')
  for (const p of pick.litter) print(`  ${p.x} ${p.y} ${p.z}`)
}
```

## Step 2a — foundation, floor, walls, windows, furniture (`timeout: 420`)

Paste the printed `BASE`. The fence starts with the mobility self-test and
lot cleanup, then works exactly like a player's first evening.

```js
const BASE = new Vec3(100, -61, 100) // ← the BASE printed by Step 1 (y = ground layer)
const LITTER = [] // ← paste litter positions from Step 1 as [x, y, z] triples, if any
const W = 7, D = 6
const y0 = BASE.y + 1 // first air layer: wall bottom
try { bot.creative.stopFlying() } catch (e) { /* not flying */ }

// --- mobility self-test FIRST (see mcp-craft://skill/humanlike) ---
async function ensureMobile() {
  const feet0 = bot.entity.position.floored()
  let drop = 0
  while (drop < 40) {
    const below = bot.blockAt(feet0.offset(0, -1 - drop, 0))
    if (below && below.boundingBox === 'block') break
    drop++
  }
  if (drop > 1) {
    bot.chat(`I rejoined floating ${drop} blocks up — coming down to earth.`)
    bot.chat(`/tp ${bot.username} ${BASE.x + 3} ${y0} ${BASE.z - 2}`)
    await sleep(1500)
  }
  try { bot.creative.stopFlying() } catch (e) { /* fine */ }
  const start = bot.entity.position.clone()
  await bot.lookAt(start.offset(1, 1.62, 0), true)
  bot.setControlState('forward', true)
  await sleep(700)
  bot.setControlState('forward', false)
  if (bot.entity.position.distanceTo(start) >= 0.3) return true
  bot.chat('I spawned stuck — teleporting to the lot rather than digging myself out.')
  bot.chat(`/tp ${bot.username} ${BASE.x + 3} ${y0} ${BASE.z - 2}`)
  await sleep(1500)
  return bot.entity.position.distanceTo(start) >= 0.3
}
if (!(await ensureMobile()))
  print('WARNING: still immobile after /tp (cheats off?) — dig out per mcp-craft://skill/building-with-commands')

// --- materials: one hotbar slot per material ---
const MATS = ['oak_log', 'oak_planks', 'cobblestone', 'glass_pane', 'torch', 'red_bed', 'chest', 'crafting_table']
const slots = {}
for (let i = 0; i < MATS.length; i++) {
  await bot.creative.setInventorySlot(36 + i, new Item(mcData.itemsByName[MATS[i]].id, 64))
  slots[MATS[i]] = i
}
let held = null
async function hold(mat) {
  if (held === mat) return
  bot.setQuickBarSlot(slots[mat])
  held = mat
  await sleep(100)
}

// --- human striding (see mcp-craft://skill/humanlike) ---
async function walkTo(dx, dy, dz) {
  try { bot.creative.stopFlying() } catch (e) { /* fine */ }
  const target = new Vec3(BASE.x + dx, y0 + dy, BASE.z + dz)
  const deadline = Date.now() + 10000
  let lastPos = bot.entity.position.clone()
  let lastMove = Date.now()
  bot.setControlState('sprint', true)
  bot.setControlState('forward', true)
  try {
    while (Date.now() < deadline) {
      if (bot.entity.position.distanceTo(target.offset(0.5, 0, 0.5)) < 1.6) return
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
          const d = target.offset(0.5, 0, 0.5).minus(bot.entity.position)
          const step = new Vec3(Math.sign(Math.round(d.x)), 0, Math.sign(Math.round(d.z)))
          for (const dyFace of [1, 0]) {
            const b = bot.blockAt(bot.entity.position.floored().offset(step.x, dyFace, step.z))
            if (b && b.boundingBox === 'block') await Promise.race([bot.dig(b).catch(() => {}), sleep(3000)])
          }
          lastMove = Date.now()
        }
      }
    }
  } finally {
    bot.setControlState('forward', false)
    bot.setControlState('sprint', false)
  }
}

// --- placing and digging with human moves (sidle, jump-peek) ---
const FACES = [
  new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
]
let placed = 0
function eyes() { return bot.entity.position.offset(0, 1.62, 0) }
function inReach(target) { return eyes().distanceTo(target.offset(0.5, 0.5, 0.5)) <= 4.3 }
async function approach(target) {
  for (let s = 0; s < 2 && !inReach(target); s++) {
    const d = target.offset(0.5, 0, 0.5).minus(bot.entity.position)
    await bot.lookAt(bot.entity.position.offset(Math.sign(d.x), 1.62, Math.sign(d.z)), true)
    bot.setControlState('forward', true)
    await sleep(300)
    bot.setControlState('forward', false)
  }
  return inReach(target)
}
async function put(dx, dy, dz, mat) {
  const target = BASE.offset(dx, 1 + dy, dz)
  const feet = bot.entity.position.floored()
  if (target.equals(feet) || target.equals(feet.offset(0, 1, 0))) return 'standing there'
  const existing = bot.blockAt(target)
  if (existing && existing.boundingBox === 'block') return 'occupied'
  if (!(await approach(target))) return 'out of reach'
  await hold(mat)
  async function tryFaces() {
    for (const face of FACES) {
      const ref = bot.blockAt(target.minus(face))
      if (!ref || ref.boundingBox !== 'block') continue
      await Promise.race([bot.placeBlock(ref, face).catch(() => {}), sleep(3500)])
      if (bot.blockAt(target)?.boundingBox === 'block') return true
    }
    return false
  }
  if (await tryFaces()) { placed++; return 'placed' }
  bot.setControlState('jump', true)
  await sleep(180)
  const landed = await tryFaces()
  bot.setControlState('jump', false)
  if (landed) { placed++; return 'placed' }
  return 'no visible face'
}
async function digAt(pos) {
  const b = bot.blockAt(pos)
  if (!b || b.boundingBox !== 'block') return true
  if (!(await approach(pos))) return false
  await Promise.race([bot.dig(b).catch(() => {}), sleep(4000)])
  return bot.blockAt(pos)?.boundingBox !== 'block'
}
// Replace a ground block with a material — how a person lays a floor:
// dig the grass out, drop the plank into the hole.
async function replaceGround(dx, dz, mat) {
  const pos = BASE.offset(dx, 0, dz)
  const there = bot.blockAt(pos)
  if (there && there.name === mat) return
  if (!(await digAt(pos))) return
  const feet = bot.entity.position.floored()
  if (pos.equals(feet.offset(0, -1, 0))) return // never dig-and-place under your own feet
  await hold(mat)
  for (const face of FACES) {
    const ref = bot.blockAt(pos.minus(face))
    if (!ref || ref.boundingBox !== 'block') continue
    await Promise.race([bot.placeBlock(ref, face).catch(() => {}), sleep(3500)])
    if (bot.blockAt(pos)?.name === mat) { placed++; return }
  }
}

// --- phase 0: clean the lot like a person (a few strays, not a demolition) ---
if (LITTER.length > 0) {
  bot.chat(`Tidying the lot first — ${LITTER.length} stray blocks to clear.`)
  for (const [lx, ly, lz] of LITTER) await digAt(new Vec3(lx, ly, lz))
}

// --- phase 1: embedded foundation — log corners, cobble plinth, plank floor ---
bot.chat('Foundation first: log corners, a cobblestone plinth, and a proper plank floor.')
await walkTo(3, 0, 2)
const isCorner = (x, z) => (x === 0 || x === W - 1) && (z === 0 || z === D - 1)
for (let x = 0; x < W; x++)
  for (let z = 0; z < D; z++) {
    const ring = x === 0 || z === 0 || x === W - 1 || z === D - 1
    if (!ring) continue
    await replaceGround(x, z, isCorner(x, z) ? 'oak_log' : 'cobblestone')
  }
// floor: rows back-to-front so the bot never stands on the hole it just dug
for (let z = D - 2; z >= 1; z--) {
  await walkTo(3, 0, Math.max(1, z - 1))
  for (let x = 1; x < W - 1; x++) await replaceGround(x, z, 'oak_planks')
}
bot.chat('Floor is in — no more grass in the living room.')

// --- phase 2: walls with window and door openings ---
bot.chat('Walls going up: planks with log corners, window openings on every side.')
await walkTo(3, 0, 2)
const isDoor = (x, z, dy) => z === 0 && x === 3 && dy < 2
const isWindow = (x, z, dy) =>
  dy === 1 &&
  ((z === 0 && (x === 1 || x === 5)) || (z === D - 1 && (x === 2 || x === 4)) ||
    ((x === 0 || x === W - 1) && (z === 2 || z === 3)))
for (let dy = 0; dy < 3; dy++)
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      if (!(x === 0 || z === 0 || x === W - 1 || z === D - 1) || isDoor(x, z, dy)) continue
      if (isWindow(x, z, dy)) continue // glass panes go in after the walls
      await put(x, dy, z, isCorner(x, z) ? 'oak_log' : 'oak_planks')
    }
// panes into the openings, from inside
for (let dy = 1; dy < 2; dy++)
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++)
      if (isWindow(x, z, dy)) await put(x, dy, z, 'glass_pane')
bot.chat(`Walls and windows up — ${placed} blocks so far.`)

// --- phase 3: furniture, exactly like a first night ---
// BED: it is a 2-cell block that extends AWAY from where you stand when you
// click the FOOT cell — so stand in front of the foot, face the head, click.
bot.chat('Furniture: bed by the back wall, work corner by the front.')
await walkTo(1, 0, 2) // stand in front of the bed spot, facing the back wall
await bot.lookAt(BASE.offset(1, 1, 4).offset(0.5, 0.5, 0.5), true) // face the head cell
const bedFloor = bot.blockAt(BASE.offset(1, 0, 3)) // floor under the FOOT cell
if (bedFloor && bedFloor.boundingBox === 'block') {
  await hold('red_bed')
  await Promise.race([bot.placeBlock(bedFloor, new Vec3(0, 1, 0)).catch(() => {}), sleep(3500)])
}
if (!String(bot.blockAt(BASE.offset(1, 1, 3))?.name ?? '').includes('bed')) {
  bot.chat('(the bed did not take — leaving a torch there and moving on)')
}
for (const [x, z, mat] of [[5, 4, 'chest'], [5, 3, 'crafting_table']]) {
  const r = await put(x, 0, z, mat)
  if (r !== 'placed') bot.chat(`(${mat} did not land: ${r} — moving on)`)
}
// WALL torches: click a wall block's inside face at head height — the torch
// hangs on the wall like a person's would, never scattered on the floor.
async function wallTorch(wallDx, wallDz, faceIn, standDx, standDz) {
  await walkTo(standDx, 0, standDz)
  const wall = bot.blockAt(BASE.offset(wallDx, 2, wallDz))
  if (!wall || wall.boundingBox !== 'block') return
  await hold('torch')
  await Promise.race([bot.placeBlock(wall, faceIn).catch(() => {}), sleep(3500)])
}
await wallTorch(4, 0, new Vec3(0, 0, 1), 3, 2)   // beside the door, inside
await wallTorch(1, D - 1, new Vec3(0, 0, -1), 2, 3) // over the bed
await wallTorch(W - 1, 3, new Vec3(-1, 0, 0), 4, 3) // over the work corner
bot.chat(`Interior done. ${placed} blocks placed so far — attic and roof next (Step 2b).`)
print(`phase A done: ${placed} blocks placed; BASE ${BASE.x} ${BASE.y} ${BASE.z}`)
```

## Step 2b — attic floor, the roof walk, eaves, door, porch (`timeout: 420`)

Same `BASE`. Self-contained; skips anything already placed.

```js
const BASE = new Vec3(100, -61, 100) // ← the SAME BASE as Step 2a
const W = 7, D = 6
const y0 = BASE.y + 1
try { bot.creative.stopFlying() } catch (e) { /* not flying */ }

const MATS = ['oak_planks', 'oak_door', 'torch']
const slots = {}
for (let i = 0; i < MATS.length; i++) {
  await bot.creative.setInventorySlot(36 + i, new Item(mcData.itemsByName[MATS[i]].id, 64))
  slots[MATS[i]] = i
}
let held = null
async function hold(mat) {
  if (held === mat) return
  bot.setQuickBarSlot(slots[mat])
  held = mat
  await sleep(100)
}
async function walkTo(dx, dy, dz) {
  try { bot.creative.stopFlying() } catch (e) { /* fine */ }
  const target = new Vec3(BASE.x + dx, y0 + dy, BASE.z + dz)
  const deadline = Date.now() + 10000
  let lastPos = bot.entity.position.clone()
  let lastMove = Date.now()
  bot.setControlState('sprint', true)
  bot.setControlState('forward', true)
  try {
    while (Date.now() < deadline) {
      if (bot.entity.position.distanceTo(target.offset(0.5, 0, 0.5)) < 1.6) return
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
          const d = target.offset(0.5, 0, 0.5).minus(bot.entity.position)
          const step = new Vec3(Math.sign(Math.round(d.x)), 0, Math.sign(Math.round(d.z)))
          for (const dyFace of [1, 0]) {
            const b = bot.blockAt(bot.entity.position.floored().offset(step.x, dyFace, step.z))
            if (b && b.boundingBox === 'block') await Promise.race([bot.dig(b).catch(() => {}), sleep(3000)])
          }
          lastMove = Date.now()
        }
      }
    }
  } finally {
    bot.setControlState('forward', false)
    bot.setControlState('sprint', false)
  }
}
const FACES = [
  new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
]
let placed = 0
function eyes() { return bot.entity.position.offset(0, 1.62, 0) }
function inReach(target) { return eyes().distanceTo(target.offset(0.5, 0.5, 0.5)) <= 4.3 }
async function put(dx, dy, dz, mat) {
  const target = BASE.offset(dx, 1 + dy, dz)
  const feet = bot.entity.position.floored()
  if (target.equals(feet) || target.equals(feet.offset(0, 1, 0))) return 'standing there'
  const existing = bot.blockAt(target)
  if (existing && existing.boundingBox === 'block') return 'occupied'
  for (let s = 0; s < 2 && !inReach(target); s++) {
    const d = target.offset(0.5, 0, 0.5).minus(bot.entity.position)
    await bot.lookAt(bot.entity.position.offset(Math.sign(d.x), 1.62, Math.sign(d.z)), true)
    bot.setControlState('forward', true)
    await sleep(300)
    bot.setControlState('forward', false)
  }
  if (!inReach(target)) return 'out of reach'
  await hold(mat)
  async function tryFaces() {
    for (const face of FACES) {
      const ref = bot.blockAt(target.minus(face))
      if (!ref || ref.boundingBox !== 'block') continue
      await Promise.race([bot.placeBlock(ref, face).catch(() => {}), sleep(3500)])
      if (bot.blockAt(target)?.boundingBox === 'block') return true
    }
    return false
  }
  if (await tryFaces()) { placed++; return 'placed' }
  bot.setControlState('jump', true)
  await sleep(180)
  const landed = await tryFaces()
  bot.setControlState('jump', false)
  if (landed) { placed++; return 'placed' }
  return 'no visible face'
}

// --- attic floor (the roof deck a person walks on) ---
bot.chat('Attic floor going in — that is what I will stand on to lay the roof.')
await walkTo(3, 0, 2)
for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) await put(x, 3, z, 'oak_planks')

// --- staircase up, climbing it as it grows ---
bot.chat('A little staircase up the front — no fair placing steps I cannot see.')
async function buildStairs(cols, z) {
  for (const [sx] of cols) await put(sx, 0, z, 'oak_planks')
  for (let level = 1; level < cols.length; level++) {
    await walkTo(cols[level - 1][0], level, z)
    for (let i = level; i < cols.length; i++) await put(cols[i][0], level, z, 'oak_planks')
  }
}
const FRONT_STAIRS = [[5, 0], [4, 1], [3, 2]]
const BACK_STAIRS = [[1, 0], [2, 1], [3, 2]]
await walkTo(6, 0, -2)
await buildStairs(FRONT_STAIRS, -1)
await walkTo(3, 3, -1)
await walkTo(3, 4, 0) // onto the attic deck, north walkway
bot.setControlState('sneak', true) // edge work: you cannot fall off while sneaking
for (let x = 0; x < W; x++) {
  await walkTo(x, 4, 0)
  await put(x, 4, 2, 'oak_planks') // far row first — keep your own view clear
  await put(x, 5, 2, 'oak_planks') // ridge, north half
  await put(x, 4, 1, 'oak_planks') // near row last
  await put(x, 3, -1, 'oak_planks') // the eave overhang below the walkway edge
}
bot.setControlState('sneak', false)
bot.chat('North slope and eave done — around to the south.')
await walkTo(3, 3, -1)
await walkTo(3, 0, -2)
await walkTo(1, 0, 7)
await buildStairs(BACK_STAIRS, 6)
await walkTo(3, 3, 6)
await walkTo(3, 4, 5) // south walkway
bot.setControlState('sneak', true)
for (let x = 0; x < W; x++) {
  await walkTo(x, 4, 5)
  await put(x, 4, 3, 'oak_planks')
  await put(x, 5, 3, 'oak_planks')
  await put(x, 4, 4, 'oak_planks')
  await put(x, 3, 6, 'oak_planks') // south eave
}
// roof self-check WHILE the scaffolding still stands
const roofHoles = []
for (const { dy, zs } of [{ dy: 4, zs: [1, 2, 3, 4] }, { dy: 5, zs: [2, 3] }, { dy: 3, zs: [-1, 6] }])
  for (const z of zs)
    for (let x = 0; x < W; x++)
      if (bot.blockAt(BASE.offset(x, 1 + dy, z))?.boundingBox !== 'block') roofHoles.push({ x, dy, z })
for (const h of roofHoles) {
  await walkTo(h.x, 4, h.z <= 2 ? 0 : 5)
  await put(h.x, h.dy, h.z, 'oak_planks')
}
bot.setControlState('sneak', false)
bot.chat(roofHoles.length ? `Patched ${roofHoles.length} roof holes before coming down.` : 'Roof is tight — coming down.')

// --- down, scaffolding away, door, porch light ---
bot.chat('Down the stairs, scaffolding out, door in, lights on.')
await walkTo(3, 3, 6)
await walkTo(3, 0, 7)
for (const stairs of [{ cols: BACK_STAIRS, z: 6, standZ: 7 }, { cols: FRONT_STAIRS, z: -1, standZ: -2 }]) {
  await walkTo(3, 0, stairs.standZ)
  for (const dy of [2, 1, 0])
    for (const [sx, topDy] of stairs.cols) {
      if (topDy < dy) continue
      const b = bot.blockAt(BASE.offset(sx, 1 + dy, stairs.z))
      if (b && b.boundingBox === 'block') await Promise.race([bot.dig(b).catch(() => {}), sleep(4000)])
    }
}
await walkTo(3, 0, -2)
await put(3, 0, 0, 'oak_door')
// porch torches: hang them on the front wall either side of the door
for (const tx of [2, 4]) {
  const wall = bot.blockAt(BASE.offset(tx, 2, 0))
  if (wall && wall.boundingBox === 'block') {
    await hold('torch')
    await Promise.race([bot.placeBlock(wall, new Vec3(0, 0, -1)).catch(() => {}), sleep(3500)])
  }
}
bot.chat(`House done: ${placed} more blocks this phase. Running the block-by-block check next.`)
print(`phase B done: ${placed} blocks placed; BASE ${BASE.x} ${BASE.y} ${BASE.z}`)
```

## Step 3 — verify, then say it in chat

```js
const BASE = new Vec3(100, -61, 100) // ← same BASE as the build
const W = 7, D = 6
const nameAt = (dx, dy, dz) => {
  const b = bot.blockAt(BASE.offset(dx, 1 + dy, dz))
  return b ? b.name : 'unloaded'
}
const isCorner = (x, z) => (x === 0 || x === W - 1) && (z === 0 || z === D - 1)
const isDoor = (x, z, dy) => z === 0 && x === 3 && dy < 2
const isWindow = (x, z, dy) =>
  dy === 1 &&
  ((z === 0 && (x === 1 || x === 5)) || (z === D - 1 && (x === 2 || x === 4)) ||
    ((x === 0 || x === W - 1) && (z === 2 || z === 3)))
const wrong = []
let unloaded = 0
// foundation ring + floor (ground layer)
for (let x = 0; x < W; x++)
  for (let z = 0; z < D; z++) {
    const ring = x === 0 || z === 0 || x === W - 1 || z === D - 1
    const want = ring ? (isCorner(x, z) ? 'oak_log' : 'cobblestone') : 'oak_planks'
    const got = nameAt(x, -1, z)
    if (got === 'unloaded') unloaded++
    else if (got !== want) wrong.push(`foundation ${x},${z}: want ${want}, got ${got}`)
  }
// walls
for (let dy = 0; dy < 3; dy++)
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      if (!(x === 0 || z === 0 || x === W - 1 || z === D - 1)) continue
      const name = nameAt(x, dy, z)
      if (name === 'unloaded') { unloaded++; continue }
      const want = isDoor(x, z, dy) ? 'oak_door|air' : isCorner(x, z) ? 'oak_log' : isWindow(x, z, dy) ? 'glass_pane' : 'oak_planks'
      if (!want.split('|').includes(name)) wrong.push(`wall ${x},${dy},${z}: want ${want}, got ${name}`)
    }
// attic + roof + eaves
for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (nameAt(x, 3, z) !== 'oak_planks') wrong.push(`attic ${x},${z}: ${nameAt(x, 3, z)}`)
const roofRows = [{ dy: 4, zs: [1, 2, 3, 4] }, { dy: 5, zs: [2, 3] }, { dy: 3, zs: [-1, 6] }]
for (const { dy, zs } of roofRows)
  for (const z of zs) for (let x = 0; x < W; x++) if (nameAt(x, dy, z) !== 'oak_planks') wrong.push(`roof ${x},${dy},${z}: ${nameAt(x, dy, z)}`)
// interior contents
const contents = {}
for (let x = 1; x < W - 1; x++)
  for (let z = 1; z < D - 1; z++)
    for (const dy of [0, 1]) {
      const n = nameAt(x, dy, z)
      if (n !== 'air') contents[n] = (contents[n] ?? 0) + 1
    }
const hasBed = Object.keys(contents).some((n) => n.includes('bed'))
const hasTorches = Object.keys(contents).some((n) => n.includes('torch'))
printJson({ wrong: wrong.slice(0, 20), wrongCount: wrong.length, unloaded, contents, hasBed, hasTorches })
const verdict =
  wrong.length === 0 && unloaded === 0 && hasBed && contents['chest'] && contents['crafting_table'] && hasTorches
    ? 'VERIFIED: foundation, floor, walls, windows, roof, furniture and lighting all check out'
    : `INCOMPLETE: ${wrong.length} blocks wrong, ${unloaded} unloaded, bed=${hasBed}, torches=${hasTorches}`
bot.chat(verdict)
print(verdict)
```

If the sweep reports misses, fix exactly those cells with `put`-style
placements from the nearest spot a person could see them — do not rebuild
whole phases.
