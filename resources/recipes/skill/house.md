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

Paste the printed `BASE` into the constant and run **with `timeout: 480`** —
the runtime paces every click to human speed (2–3 blocks/s), so the honest
build takes several minutes. Everything else is self-contained: materials,
walls, windows, furniture, ceiling, a roofer's walk over the top for the
gable (staircases built by climbing them, torn down afterwards), and the
front door — with chat narration at every phase.

```js
const BASE = new Vec3(100, -61, 100) // ← the BASE printed by Step 1 (y = ground layer)
const W = 7, D = 6
const y0 = BASE.y + 1 // first air layer: wall bottom
try { bot.creative.stopFlying() } catch (e) { /* not flying */ }

// --- materials: one hotbar slot per material, equip once per run ---
// --- mobility self-test FIRST: a rejoining bot spawns where it disconnected,
// possibly boxed inside a half-built leftover or with stale flight state —
// pathfinder then fails silently and every placement is 'out of reach'.
// Detect it in one second and recover instead of debugging on camera.
async function ensureMobile() {
  // 1) GROUND CHECK FIRST. A rejoining bot can be left hovering high in the
  // air by server-side flight state — it then passes a walk test (flight
  // drift moves it) while every ground cell sits 20 blocks out of reach.
  const feet = bot.entity.position.floored()
  let drop = 0
  while (drop < 40) {
    const below = bot.blockAt(feet.offset(0, -1 - drop, 0))
    if (below && below.boundingBox === 'block') break
    drop++
  }
  if (drop > 1) {
    bot.chat(`I rejoined floating ${drop} blocks up — coming down to earth.`)
    bot.chat(`/tp ${bot.username} ${BASE.x + 3} ${y0} ${BASE.z - 2}`)
    await sleep(1500)
  }
  try { bot.creative.stopFlying() } catch (e) { /* fine */ }
  // 2) walk test: detects being boxed in by leftovers.
  const start = bot.entity.position.clone()
  await bot.lookAt(start.offset(1, 1.62, 0), true)
  bot.setControlState('forward', true)
  await sleep(700)
  bot.setControlState('forward', false)
  if (bot.entity.position.distanceTo(start) >= 0.3) return true
  bot.chat('I spawned stuck — teleporting to the build site rather than digging myself out.')
  bot.chat(`/tp ${bot.username} ${BASE.x + 3} ${y0} ${BASE.z - 2}`)
  await sleep(1500)
  return bot.entity.position.distanceTo(start) >= 0.3
}
if (!(await ensureMobile()))
  print('WARNING: still immobile after /tp (cheats off?) — dig out per mcp-craft://skill/building-with-commands before re-running')

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

// --- movement: human striding (see mcp-craft://skill/humanlike). Face the
// target, sprint, hop ledges (auto-jump is built into the runtime); if pinned
// for 1.5s — jump; still pinned — punch through. Bounded, never hangs.
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
  // A step beats a repath: barely out of reach → sidle toward it like a human.
  for (let s = 0; s < 2 && !inReach(target); s++) {
    const d = target.offset(0.5, 0, 0.5).minus(bot.entity.position)
    await bot.lookAt(bot.entity.position.offset(Math.sign(d.x), 1.62, Math.sign(d.z)), true)
    bot.setControlState('forward', true)
    await sleep(300)
    bot.setControlState('forward', false)
  }
  if (!inReach(target)) return 'out of reach'
  await hold(mat)
  // The runtime enforces the human contract itself: it turns the head, paces
  // the clicks, and REFUSES faces without line of sight — so just try faces
  // and trust blockAt.
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
  // A person jumps to see over a near edge — one assisted retry.
  bot.setControlState('jump', true)
  await sleep(180)
  const landed = await tryFaces()
  bot.setControlState('jump', false)
  if (landed) { placed++; return 'placed' }
  return 'no visible face'
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

// --- phase 4: the roof, walked like a roofer ---
// The runtime refuses clicks without line of sight, so a roof CANNOT be
// placed from the ground "through" the house. Do it the human way: build a
// staircase step by step (climbing as it grows — you cannot place a step
// whose face you cannot see), walk onto the ceiling, and lay the slope rows
// from up there with sneak held. Row order matters: far row first, then the
// ridge, then the near row — otherwise your own fresh blocks block the view.
bot.chat('Roof time — building my way up like a roofer, scaffold first.')
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
await walkTo(3, 3, -1) // top of the staircase
await walkTo(3, 4, 0) // step onto the ceiling: the north walkway
bot.setControlState('sneak', true) // you cannot walk off an edge while sneaking
for (let x = 0; x < W; x++) {
  await walkTo(x, 4, 0)
  await put(x, 4, 2, 'oak_planks') // far row first — keep your own view clear
  await put(x, 5, 2, 'oak_planks') // ridge, north half
  await put(x, 4, 1, 'oak_planks') // near row last
}
bot.setControlState('sneak', false)
bot.chat('North slope done — heading around to the south side.')
await walkTo(3, 3, -1)
await walkTo(3, 0, -2)
await walkTo(1, 0, 7)
await buildStairs(BACK_STAIRS, 6)
await walkTo(3, 3, 6)
await walkTo(3, 4, 5) // the south walkway
bot.setControlState('sneak', true)
for (let x = 0; x < W; x++) {
  await walkTo(x, 4, 5)
  await put(x, 4, 3, 'oak_planks')
  await put(x, 5, 3, 'oak_planks')
  await put(x, 4, 4, 'oak_planks')
}
// Roof self-check WHILE the scaffolding still stands — patch from up here,
// not after coming down (holes found later cost a whole re-climb).
const roofHoles = []
for (const { dy, zs } of [{ dy: 4, zs: [1, 2, 3, 4] }, { dy: 5, zs: [2, 3] }])
  for (const z of zs)
    for (let x = 0; x < W; x++)
      if (bot.blockAt(BASE.offset(x, 1 + dy, z))?.boundingBox !== 'block') roofHoles.push({ x, dy, z })
for (const h of roofHoles) {
  await walkTo(h.x, 4, h.z <= 2 ? 0 : 5)
  await put(h.x, h.dy, h.z, 'oak_planks')
}
bot.setControlState('sneak', false)
bot.chat(roofHoles.length ? `Patched ${roofHoles.length} roof holes before coming down.` : 'Roof is tight — coming down.')

// --- phase 5: climb down, take the scaffolding with you, hang the door ---
bot.chat('Tearing my scaffolding down and hanging the door.')
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
