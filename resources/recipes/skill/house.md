# The cozy house — a complete, tuned build

This is the flagship recipe: a 7×6 oak house with log corner posts, glass
windows, a stepped gable roof, a door, and furniture — built block-by-block
at human pace, in ONE `craft_execute_code` call. **Do not compose your own
mega-script**: every minute you spend writing code from scratch is a minute
the bot stands frozen in front of the human. Copy the build fence, set
`BASE`, run it. Adapt details only if the human asked for something this
recipe does not cover.

Hard-won rules baked into it (violate them and the bot freezes):

- **Never `bot.creative.flyTo`, never `goto` while flying** — both hang on
  LAN worlds. Walk everywhere; `stopFlying()` before any goto.
- **Never place into an occupied cell, never await a bare `placeBlock`** —
  watchdog + `blockAt` re-check, always.
- **The ground is the floor.** Walls start at the first air layer.
- Work from a few standing anchors and only place what is in reach (≤4.3
  from the eyes); missed cells get retried from the next anchor.

## Step 1 — pick the corner

```js
// Northwest ground corner of a clear 9x8 area (footprint + scaffolding room),
// a few blocks from the human, on flat ground.
const human = bot.nearestEntity((e) => e.type === 'player')
const anchor = (human ? human.position : bot.entity.position).floored()
const gx = anchor.x + 4 // build to the east; adjust if that side is cluttered
const gz = anchor.z - 3
// Ground layer y: the first solid block scanning down from the anchor.
let gy = null
for (let y = anchor.y + 2; y > anchor.y - 6; y--) {
  const b = bot.blockAt(new Vec3(gx, y, gz))
  if (b && b.boundingBox === 'block') { gy = y; break }
}
print(gy === null ? 'no ground found — move first' : `BASE: new Vec3(${gx}, ${gy}, ${gz})`)
```

## Step 2 — the one-call build

Paste the printed `BASE` into the constant and run. Everything else is
self-contained: materials, anchors, walls, windows, furniture, ceiling,
stepped gable roof via three 2-step staircases (torn down afterwards), and
the front door — with chat narration at every phase.

```js
const BASE = new Vec3(100, -61, 100) // ← the BASE printed by Step 1 (y = ground layer)
const W = 7, D = 6
const y0 = BASE.y + 1 // first air layer: wall bottom
bot.pathfinder.setMovements(new Movements(bot))
try { bot.creative.stopFlying() } catch (e) { /* not flying */ }

// --- materials: one hotbar slot per material, equip once per run ---
const MATS = ['oak_log', 'oak_planks', 'glass', 'torch', 'oak_door', 'red_bed', 'chest', 'crafting_table']
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

// --- movement: WALK, never fly; bounded; cancel leftover goals ---
async function walkTo(dx, dy, dz) {
  try { bot.creative.stopFlying() } catch (e) { /* fine */ }
  const goal = new goals.GoalBlock(BASE.x + dx, y0 + dy, BASE.z + dz)
  await Promise.race([bot.pathfinder.goto(goal).catch(() => {}), sleep(8000)])
  bot.pathfinder.setGoal(null)
}

// --- placement: occupied-cell refusal, per-place watchdog, blockAt truth ---
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
  if (!inReach(target)) return 'out of reach'
  await hold(mat)
  for (const face of FACES) {
    const ref = bot.blockAt(target.minus(face))
    if (!ref || ref.boundingBox !== 'block') continue
    await bot.lookAt(target.offset(0.5, 0.5, 0.5), true)
    await Promise.race([bot.placeBlock(ref, face).catch(() => {}), sleep(2500)])
    if (bot.blockAt(target)?.boundingBox === 'block') { placed++; return 'placed' }
  }
  return 'no face'
}

// --- phase 1: walls, from the inside center (everything is in reach) ---
bot.chat('Walls first: oak with log corners, leaving holes for windows and the door.')
await walkTo(3, 0, 2)
const isCorner = (x, z) => (x === 0 || x === W - 1) && (z === 0 || z === D - 1)
const isDoor = (x, z, dy) => z === 0 && x === 3 && dy < 2
const isWindow = (x, z, dy) =>
  dy === 1 &&
  ((z === 0 && (x === 1 || x === 5)) || (z === D - 1 && (x === 2 || x === 4)) ||
    ((x === 0 || x === W - 1) && (z === 2 || z === 3)))
for (let dy = 0; dy < 3; dy++)
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      if (!(x === 0 || z === 0 || x === W - 1 || z === D - 1) || isDoor(x, z, dy)) continue
      await put(x, dy, z, isCorner(x, z) ? 'oak_log' : isWindow(x, z, dy) ? 'glass' : 'oak_planks')
    }
bot.chat(`Walls and windows up — ${placed} blocks. Furniture before I close the roof.`)

// --- phase 2: furniture (still inside; beds/doors orient by my facing — good enough) ---
for (const [x, z, mat] of [[1, 3, 'red_bed'], [5, 4, 'chest'], [5, 1, 'crafting_table'], [1, 1, 'torch'], [4, 4, 'torch']]) {
  const r = await put(x, 0, z, mat)
  if (r !== 'placed') bot.chat(`(${mat} did not land: ${r} — moving on)`)
}

// --- phase 3: ceiling, edge rows first so every block has a neighbor to click ---
bot.chat('Ceiling on...')
for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) await put(x, 3, z, 'oak_planks')

// --- phase 4: scaffolding staircases (torn down later), then the stepped roof ---
bot.chat('Now the gable roof — putting up little staircases to reach the ridge, like scaffolding.')
const SCAFFOLD = [
  [5, 0, -1], [4, 0, -1], [4, 1, -1], // front, stand on (4,1,-1)
  [1, 0, 6], [2, 0, 6], [2, 1, 6],    // back, stand on (2,1,6)
  [-1, 0, 3], [-1, 0, 2], [-1, 1, 2], // west, stand on (-1,1,2)
]
await walkTo(3, 0, -2)
for (const [x, dy, z] of SCAFFOLD) await put(x, dy, z, 'oak_planks')

const roof = []
for (let x = 0; x < W; x++) {
  for (const z of [1, 2, 3, 4]) roof.push({ x, dy: 4, z })
  for (const z of [2, 3]) roof.push({ x, dy: 5, z })
}
const ANCHORS = [
  [1, 0, -2], [5, 0, -2], [1, 0, 7], [5, 0, 7], // ground, four sides
  [4, 2, -1], [2, 2, 6], [-1, 2, 2],            // staircase tops for the ridge
]
let remaining = roof
for (const [ax, ay, az] of ANCHORS) {
  if (remaining.length === 0) break
  await walkTo(ax, ay, az)
  const next = []
  for (const c of remaining) {
    const r = await put(c.x, c.dy, c.z, 'oak_planks')
    if (r !== 'placed' && r !== 'occupied') next.push(c)
  }
  remaining = next
}
if (remaining.length > 0) bot.chat(`Roof: ${remaining.length} blocks I could not reach — will report them in the verify sweep.`)

// --- phase 5: tear the scaffolding down, hang the door, done ---
bot.chat('Tearing my scaffolding down and hanging the door.')
for (const [x, dy, z] of [...SCAFFOLD].reverse()) {
  const b = bot.blockAt(BASE.offset(x, 1 + dy, z))
  if (!b || b.boundingBox !== 'block') continue
  if (!inReach(b.position)) await walkTo(x + (x < 0 ? 1 : x >= W ? -1 : 0), 0, z + (z < 0 ? 1 : z >= D ? -1 : 0))
  await Promise.race([bot.dig(b).catch(() => {}), sleep(5000)])
}
await walkTo(3, 0, -2)
await put(3, 0, 0, 'oak_door')
bot.chat(`House done: ${placed} blocks placed by hand. Running the block-by-block check next.`)
print(`placed ${placed}; roof unreached: ${remaining.length}; BASE ${BASE.x} ${BASE.y} ${BASE.z}`)
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
for (let dy = 0; dy < 3; dy++)
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      if (!(x === 0 || z === 0 || x === W - 1 || z === D - 1)) continue
      const name = nameAt(x, dy, z)
      if (name === 'unloaded') { unloaded++; continue }
      const want = isDoor(x, z, dy) ? 'oak_door|air' : isCorner(x, z) ? 'oak_log' : isWindow(x, z, dy) ? 'glass' : 'oak_planks'
      if (!want.split('|').includes(name)) wrong.push(`wall ${x},${dy},${z}: want ${want}, got ${name}`)
    }
for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (nameAt(x, 3, z) !== 'oak_planks') wrong.push(`ceiling ${x},${z}: ${nameAt(x, 3, z)}`)
const roofRows = [{ dy: 4, zs: [1, 2, 3, 4] }, { dy: 5, zs: [2, 3] }]
for (const { dy, zs } of roofRows)
  for (const z of zs) for (let x = 0; x < W; x++) if (nameAt(x, dy, z) !== 'oak_planks') wrong.push(`roof ${x},${dy},${z}: ${nameAt(x, dy, z)}`)
const furniture = {}
for (let x = 1; x < W - 1; x++) for (let z = 1; z < D - 1; z++) {
  const n = nameAt(x, 0, z)
  if (n !== 'air') furniture[n] = (furniture[n] ?? 0) + 1
}
printJson({ wrong: wrong.slice(0, 20), wrongCount: wrong.length, unloaded, furniture })
const verdict = wrong.length === 0 && unloaded === 0 ? 'VERIFIED: every wall, ceiling and roof block checks out' : `INCOMPLETE: ${wrong.length} blocks wrong, ${unloaded} unloaded`
bot.chat(verdict)
print(verdict)
```

If the sweep reports misses, fix exactly those cells with `put`-style
placements from the nearest anchor — do not rebuild whole phases.
