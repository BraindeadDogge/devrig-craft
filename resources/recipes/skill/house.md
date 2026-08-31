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
- **Read the `tally`, `errors` and `stalls` each build fence prints** — that is
  your debugging channel, not a formality. `out of reach`/`no visible face`
  means the bot placed from the wrong spot; a non-zero `stalls` means a walk
  timed out and everything after it happened from the wrong place; `errors`
  carries the runtime's own refusals verbatim. Fix what they name and re-run
  the same fence — do not re-send it unchanged.

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
  print('copy that BASE into Step 2a — it finds and clears the strays itself; nothing else to carry over')
}
```

## Step 2a — foundation, floor, walls, windows, furniture (`timeout: 420`)

Paste the printed `BASE` — the only thing you carry between calls. The fence
starts with the mobility self-test, finds the strays itself and clears them,
then works exactly like a player's first evening.

```js
const BASE = new Vec3(100, -61, 100) // ← the BASE printed by Step 1 (y = ground layer)
const W = 7, D = 6
const y0 = BASE.y + 1 // first air layer: wall bottom
// Do NOT call bot.creative.stopFlying() here "just in case". mineflayer
// restores gravity from a value only startFlying() ever saves, so calling it
// without having flown sets gravity to null — the bot then never lands,
// onGround stays false, and every jump does nothing. The runtime guards this
// now; do not reintroduce the call. (Measured live: 208 failed pillars.)

// --- the design as predicates: one source of truth for build, cleanup and check ---
const isRing = (x, z) => x === 0 || z === 0 || x === W - 1 || z === D - 1
const isCorner = (x, z) => (x === 0 || x === W - 1) && (z === 0 || z === D - 1)
const isDoor = (x, z, dy) => z === 0 && x === 3 && dy < 2
const isWindow = (x, z, dy) =>
  dy === 1 &&
  ((z === 0 && (x === 1 || x === 5)) || (z === D - 1 && (x === 2 || x === 4)) ||
    ((x === 0 || x === W - 1) && (z === 2 || z === 3)))
const wantAt = (x, dy, z) =>
  !isRing(x, z) || isDoor(x, z, dy)
    ? 'air'
    : isWindow(x, z, dy) ? 'glass_pane' : isCorner(x, z) ? 'oak_log' : 'oak_planks'
// WHERE TO STAND: one cell inside the wall you are working on. Everything in
// that column is then ~1.7 blocks from the eye. Reaching a far corner from the
// middle of the room is 4.4 — past the 4.3 the runtime allows, so a build that
// never walks silently skips most of its own wall.
const standFor = (x, z) => [Math.min(Math.max(x, 1), W - 2), Math.min(Math.max(z, 1), D - 2)]
// HOW HIGH TO STAND: at the floor you can comfortably click the course at your
// feet and the one at your chest; the third course is above your eye, and its
// only reference face — the top of the block below it — cannot be seen from
// underneath. So climb onto the course you already laid before laying the next
// one, exactly as a person does. Laying a whole wall from the floor is why a
// run places the bottom two courses and reports "no face" for the third.
const standDyFor = (dy) => Math.max(0, dy - 1)

// WHAT IS MINE. The stuck-walk watchdog below digs whatever pins the bot, and
// it cannot tell a hillside from the wall it just built. Measured live: three
// pathfinder timeouts during the roof phase cost 22 wall blocks — the bot
// tunnelled out through its own house. So the design has to say what is off
// limits, because the watchdog has no way to know.
const partOfTheHouse = (p) => {
  const dx = p.x - BASE.x, dz = p.z - BASE.z, dy = p.y - y0
  if (dx < 0 || dx >= W) return false
  if (dz < -1 || dz > D) return false
  if (dy < 0) return true // floor and plinth
  if (dz < 0 || dz >= D) return dy >= 3 // outside the footprint: only the eaves
  if (dy < 3) return wantAt(dx, dy, dz) !== 'air' // walls, windows, door hole
  return true // attic deck, slopes, ridge
}

// --- diagnostics: keep what the runtime tells you instead of discarding it ---
const tally = {} // per-cell outcome counts: placed / occupied / out of reach / …
const errors = {} // distinct refusals from the placement contract, with counts
let stalls = 0 // walks that ran out of time — the classic "builds standing still"
const bump = (r) => { tally[r] = (tally[r] ?? 0) + 1; return r }
const note = (e) => {
  const m = String(e?.message ?? e).slice(0, 140)
  errors[m] = (errors[m] ?? 0) + 1
}


// --- where am I, relative to the house? (mcp-craft://skill/humanlike) ---
// You have coordinates, not eyes: say them out loud. Every position below is
// reported BOTH absolute and in build coordinates, so a bad walk is obvious.
function whereAmI() {
  const f = bot.entity.position.floored()
  const rel = { dx: f.x - BASE.x, dy: f.y - y0, dz: f.z - BASE.z }
  return {
    at: [f.x, f.y, f.z],
    base: [BASE.x, BASE.y, BASE.z],
    rel,
    inside: rel.dx >= 0 && rel.dx < W && rel.dz >= 0 && rel.dz < D,
    belowBuild: rel.dy < 0,
  }
}

// --- height is not a jump: stand on something, or pillar and take it back ---
// HOW TO GET UP THERE. A creative player does not build a tower to reach a
// roof — they fly, work, and drop back down, leaving nothing behind. Only in
// survival is scaffolding the answer, and even then you pillar ONCE and then
// work outward, block against block: a run that pillars under every single
// cell fills the living room with planks (measured: thirteen of them, none of
// which the cleanup managed to remove).
const canFly = bot.game.gameMode === 'creative'
let flying = false
async function land() {
  if (!flying) return
  // stopFlying() restores gravity from the value startFlying() saved, so these
  // two must always be used as a pair — see mcp-craft://skill/humanlike.
  await bot.creative.stopFlying()
  flying = false
  for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(150)
}
// FLY, do not teleport. bot.creative.flyTo walks the ENTITY POSITION along a
// straight line in 0.5-block steps with no collision check — its own source
// says "straight line, so make sure there's a clear path" — and finishes on
// `once(bot, 'move', 0)`, which has no timeout. Aimed through a wall the server
// snaps the position back, the loop never converges and the call never
// returns: measured live, six seconds with the bot not having moved a block.
//
// Ordinary motion is accepted, so use it. Measured in the same world:
//   forward + look, weightless ... 2.97 blocks/s horizontally
//   velocity.y held per tick ..... 7 blocks/s vertically
//   jump / sneak, weightless ..... 0.00 — a jump needs onGround, and flight
//                                  never is, which is why "just press jump"
//                                  silently does nothing up here.
async function flyLeg(goal, ms) {
  if (!flying) { await bot.creative.startFlying(); flying = true }
  // Vertical is the one axis the control states cannot drive while weightless:
  // hold the velocity yourself, proportionally, so you slow into the target
  // instead of sailing past it.
  const hold = () => {
    const dy = goal.y - bot.entity.position.y
    bot.entity.velocity.y = Math.max(-0.4, Math.min(0.4, dy * 0.6))
  }
  bot.on('physicsTick', hold)
  const deadline = Date.now() + ms
  try {
    while (Date.now() < deadline) {
      const d = goal.minus(bot.entity.position)
      if (d.norm() < 0.8) break
      if (Math.hypot(d.x, d.z) > 0.6) {
        await bot.lookAt(new Vec3(goal.x, bot.entity.position.y + 1.62, goal.z), true)
        bot.setControlState('forward', true)
      } else {
        bot.setControlState('forward', false)
      }
      await sleep(80)
    }
  } finally {
    bot.removeListener('physicsTick', hold)
    bot.setControlState('forward', false)
    bot.entity.velocity.y = 0
  }
  return bot.entity.position.distanceTo(goal) < 1.8
}
// Real flight still collides with things, so take the route a player takes:
// up clear of the build, across above it, then straight down onto the perch.
async function flyClear(goal) {
  // Straight there first. Most hops on a build site are a couple of blocks with
  // nothing in between, and going up to cruise height and back down for every
  // one of them costs about twenty blocks of vertical travel per block placed —
  // measured, that is what ran Step 2b out of its budget with the roof half
  // laid. Give the direct line a short leash; if it does not make it, THEN take
  // the long way over the top.
  if (await flyLeg(goal, 2500)) return true
  const cruiseY = Math.max(bot.entity.position.y, goal.y, y0 + 8) + 2
  const here = bot.entity.position
  const legs = [
    new Vec3(here.x, cruiseY, here.z),
    new Vec3(goal.x, cruiseY, goal.z),
    goal,
  ]
  for (const leg of legs) {
    if (!(await flyLeg(leg, 6000))) { bump('flight leg did not arrive'); return false }
  }
  return true
}
const pillars = []
async function raiseTo(dx, dy, dz) {
  const goalY = y0 + dy
  const atHeight = () => bot.entity.position.y >= goalY - 0.1
  if (atHeight() && (await walkTo(dx, dy, dz))) return true
  if (canFly) {
    // Hover exactly where the work is. No tower, no cleanup, no holes punched
    // in your own house trying to path to a ledge that has no walking route.
    const goal = new Vec3(BASE.x + dx + 0.5, goalY, BASE.z + dz + 0.5)
    if (await flyClear(goal)) return true
    // Flight is an optimisation, not a dependency. mineflayer's flyTo moves the
    // bot's position directly and the server can simply refuse it — measured
    // live, a bot left in a bad hover state did not move a block in six
    // seconds. When that happens, put the feet down and pillar like survival.
    bump('flight refused — falling back to the pillar')
    await land()
  }
  // Get BELOW the goal first, at whatever height the ground here actually is.
  // Never hand the pathfinder a goal hanging in mid-air: there is no floor
  // under it yet, so it spends its entire timeout proving that and fails —
  // measured live as fifteen "walk to …: timeout" entries in one 170s run.
  if (!atHeight()) await walkTo(dx, Math.floor(bot.entity.position.y) - y0, dz) // below the goal
  await hold('oak_planks')
  for (let i = 0; i < 6 && !atHeight(); i++) {
    const feet = bot.entity.position.floored()
    const ref = bot.blockAt(feet.offset(0, -1, 0))
    if (!ref || ref.boundingBox !== 'block') { bump('nothing under me to pillar from'); break }
    await bot.lookAt(feet.offset(0.5, -0.5, 0.5), true)
    bot.setControlState('jump', true)
    // WAIT FOR THE RISE, do not guess it. A player jump measured in this world
    // reads 0.42 / 0.75 / 1.00 / 1.17 / 1.25 at 50ms intervals: a flat
    // sleep(150) lands exactly on 1.00, the moment the cell is barely clear,
    // and any lag puts the hitbox still inside it — the server then drops the
    // placement silently and mineflayer reports it as
    // "Event blockUpdate did not fire within 5000ms".
    const jumped = Date.now()
    while (bot.entity.position.y < feet.y + 1.0 && Date.now() - jumped < 700) await sleep(25)
    if (bot.entity.position.y >= feet.y + 1.0 && seesFace(ref.position, new Vec3(0, 1, 0)))
      await Promise.race([bot.placeBlock(ref, new Vec3(0, 1, 0)).catch(note), sleep(1500)])
    bot.setControlState('jump', false)
    await sleep(450)
    const now = bot.entity.position.floored()
    if (now.y <= feet.y) break // not rising — stop rather than spin in place
    pillars.push(now.offset(0, -1, 0))
  }
  if (!atHeight()) { bump('could not gain height'); return false }
  // Standing on the pillar, directly under the goal: a second pathfinder call
  // would be another mid-air goal. Only re-walk if there is really a floor.
  const landing = new Vec3(BASE.x + dx + 0.5, goalY, BASE.z + dz + 0.5)
  if (bot.entity.position.distanceTo(landing) < 1.8) return true
  return await walkTo(dx, dy, dz)
}

// Below the build means in a hole: from down there every placement is refused
// for sight, so climb out FIRST and say where you are while you do it.
async function climbOutOfPit() {
  const w = whereAmI()
  if (!w.belowBuild) return true
  bot.chat('I dropped into a hole — climbing back up to the build.')
  print(`in a hole: ${JSON.stringify(w)}`)
  const dx = Math.min(Math.max(w.rel.dx, -2), W + 1)
  const dz = Math.min(Math.max(w.rel.dz, -2), D + 1)
  const out = await raiseTo(dx, 0, dz)
  if (!out) {
    bump('still below the build')
    print('could not climb out — dig steps toward BASE or re-run Step 1 for another lot')
  }
  return out
}

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
// Returns TRUE only if it arrived. Never ignore the result: a failed walk
// leaves the bot where it was, and everything the next phase places from there
// is out of reach — that is how a run puts 9 blocks in 8 minutes and says nothing.
//
// PATHFINDER FIRST. It routes AROUND the wall you just built and UP the stairs
// you just laid; a straight-line shove cannot, and its stuck-watchdog ends up
// punching a hole through your own house instead (measured live: the bot could
// not reach the roof and demolished the walls). The shove stays as the fallback
// for the short hops pathfinder refuses to plan.
let movementsReady = false
async function walkTo(dx, dy, dz) {
  const target = new Vec3(BASE.x + dx, y0 + dy, BASE.z + dz)
  const near = () => bot.entity.position.distanceTo(target.offset(0.5, 0, 0.5)) < 1.8
  if (near()) return true
  // ALREADY AIRBORNE? Fly there. Landing and taking off again for every block
  // is what turns a two-minute roof into a timeout — measured live: flyTo
  // arrives in 0.1-0.4s, while land-then-pathfind costs 3-15s per cell. A phase
  // works either on the ground or in the air; it does not alternate per block.
  if (flying) {
    await flyClear(target.offset(0.5, 0, 0.5))
    if (near()) return true
  }
  await land() // the pathfinder cannot route a hovering bot — put its feet down
  if (!movementsReady) {
    bot.pathfinder.setMovements(new Movements(bot))
    movementsReady = true
  }
  const walk = bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 1))
  const routed = await Promise.race([
    walk.then(() => 'arrived', (e) => `path error: ${e.message}`),
    sleep(12000).then(() => 'timeout'),
  ])
  if (routed !== 'arrived') {
    bot.pathfinder.setGoal(null) // drop the stuck goal before shoving by hand
    note(`walk to ${dx},${dy},${dz}: ${routed}`)
  }
  if (near()) return true
  // fallback: shove in a straight line, jump the ledge, punch through what pins you
  const deadline = Date.now() + 6000
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
          const d = target.offset(0.5, 0, 0.5).minus(bot.entity.position)
          const step = new Vec3(Math.sign(Math.round(d.x)), 0, Math.sign(Math.round(d.z)))
          for (const dyFace of [1, 0]) {
            const b = bot.blockAt(bot.entity.position.floored().offset(step.x, dyFace, step.z))
            if (!b || b.boundingBox !== 'block') continue
            // Never tunnel out through your own build — walk around instead.
            if (partOfTheHouse(b.position)) { bump('pinned by my own house — not digging it'); continue }
            await Promise.race([bot.dig(b).catch(note), sleep(3000)])
          }
          lastMove = Date.now()
        }
      }
    }
    stalls++
    print(`stalled: walk to ${target.x} ${target.y} ${target.z} timed out at ${bot.entity.position.floored()}`)
    return false
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

// --- what can I actually click from here? (mcp-craft://skill/humanlike) ---
// The runtime refuses a click whose eye-ray does not reach that face FIRST, so
// work it out before clicking, with the same arithmetic it uses: aim 0.45
// INSIDE the face (a ray aimed at the plane itself grazes it and clips the
// neighbour sharing that plane).
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
// A block is placed by clicking a FACE of an existing neighbour: the packet
// carries that neighbour and the face, and the server puts the block in
// neighbour + face. So a placement needs a neighbour that is solid, within
// reach AND visible. Pick that face instead of trying all six blind.
// Return EVERY usable face, nearest first — not just the best one. The nearest
// face is only a guess: the server can still refuse it (a neighbour updated, a
// block fell, an entity is in the cell), and another face of the same target
// often works. Measured live: 2 of every 10 refused picks had a face that would
// have landed. Trying one and reporting "placement did not land" throws that
// away for the price of a single extra click.
function chooseFaces(target) {
  const out = []
  for (const face of FACES) {
    const refPos = target.minus(face)
    const ref = bot.blockAt(refPos)
    if (!ref || ref.boundingBox !== 'block') continue
    if (!inReach(refPos)) continue
    if (!seesFace(refPos, face)) continue
    out.push({ ref, face, d: eyes().distanceTo(refPos.offset(0.5, 0.5, 0.5).plus(face.scaled(0.45))) })
  }
  return out.sort((a, b) => a.d - b.d)
}
const chooseFace = (target) => chooseFaces(target)[0] ?? null
// Nothing clickable from here: step around the target and look again — what a
// person does instead of clicking harder. Tries the three nearest standable
// cells, so a hopeless block costs three walks, not twelve.
async function standWhereVisible(target) {
  const spots = []
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]])
    for (const oy of [0, 1, -1]) {
      const spot = target.offset(ox, oy, oz)
      const ground = bot.blockAt(spot.offset(0, -1, 0))
      const feetCell = bot.blockAt(spot)
      const headCell = bot.blockAt(spot.offset(0, 1, 0))
      if (feetCell && feetCell.boundingBox === 'block') continue
      if (headCell && headCell.boundingBox === 'block') continue
      // No floor under it does NOT mean unusable. Beside a third wall course
      // or a roof slope there IS no floor yet — that is exactly the spot a
      // person pillars up to. Keep it, marked airborne, and reach it with
      // raiseTo. Rejecting these is why a run reports "no face from anywhere I
      // can stand" for every block above its own eye and lays nothing.
      const airborne = !ground || ground.boundingBox !== 'block'
      if (airborne && spot.y <= bot.entity.position.y + 0.1) continue // a pit, not a perch
      spots.push({ spot, airborne })
    }
  // Floors before scaffolding, then nearest first: pillaring costs blocks and
  // a cleanup, so it is the second answer, never the first.
  spots.sort((a, b) =>
    Number(a.airborne) - Number(b.airborne) ||
    bot.entity.position.distanceTo(a.spot) - bot.entity.position.distanceTo(b.spot))
  for (const { spot, airborne } of spots.slice(0, 4)) {
    const up = airborne || spot.y > bot.entity.position.y + 0.1
    const got = up
      ? await raiseTo(spot.x - BASE.x, spot.y - y0, spot.z - BASE.z)
      : await walkTo(spot.x - BASE.x, spot.y - y0, spot.z - BASE.z)
    if (!got) continue
    if (chooseFace(target)) return true
  }
  return false
}
// Name WHICH failure it was: the two need opposite fixes. A face at your own
// level means step around it. A face above your eye means get your feet up
// there — leaning harder never works, and a tally that says only "no face"
// hides which of the two you actually hit.
const noFaceReason = (target) =>
  target.y > bot.entity.position.y + 1.2
    ? 'no face — target is above me and I could not get up to it'
    : 'no face from anywhere I can stand'
// You cannot put a block where your own body is. The server does not say so:
// it drops the packet, and mineflayer reports the silence as
// "Event blockUpdate did not fire within 5000ms" — which reads like a network
// fault and is almost always this instead. So step out and carry on, rather
// than counting it as a failure and leaving a hole in the wall.
async function stepAside(target) {
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const spot = bot.entity.position.floored().offset(ox, 0, oz)
    if (spot.equals(target) || spot.offset(0, 1, 0).equals(target)) continue
    const floor = bot.blockAt(spot.offset(0, -1, 0))
    if (!floor || floor.boundingBox !== 'block') continue
    if (bot.blockAt(spot)?.boundingBox === 'block') continue
    if (bot.blockAt(spot.offset(0, 1, 0))?.boundingBox === 'block') continue
    if (await walkTo(spot.x - BASE.x, spot.y - y0, spot.z - BASE.z)) return true
  }
  return false
}
async function put(dx, dy, dz, mat) {
  const target = BASE.offset(dx, 1 + dy, dz)
  let feet = bot.entity.position.floored()
  if (target.equals(feet) || target.equals(feet.offset(0, 1, 0))) {
    if (!(await stepAside(target))) return bump('standing there, nowhere to step')
    bump('stepped out of the cell I had to fill')
    feet = bot.entity.position.floored()
  }
  const existing = bot.blockAt(target)
  if (existing && existing.boundingBox === 'block') return bump('occupied')
  await approach(target)
  let picks = chooseFaces(target)
  if (!picks.length) {
    if (!(await standWhereVisible(target))) return bump(noFaceReason(target))
    picks = chooseFaces(target)
    if (!picks.length) return bump(noFaceReason(target))
  }
  await hold(mat)
  for (const pick of picks) {
    await Promise.race([bot.placeBlock(pick.ref, pick.face).catch(note), sleep(3500)])
    if (bot.blockAt(target)?.boundingBox === 'block') { placed++; return bump('placed') }
  }
  return bump('placement did not land')
}
// The runtime's DIG test is not its place test: it rays at the block's CENTRE,
// not at a face. For a cell in the floor that ray dips below the surface and
// hits the soil you are standing on, so a floor cell two cells away cannot be
// mined however comfortable the distance looks. Measured live: seven of twenty
// floor cells refused at 2.3-3.6 away, all well inside the 4.5 reach.
function seesBlockCentre(pos) {
  const from = eyes()
  const dir = pos.offset(0.5, 0.5, 0.5).minus(from)
  const dist = dir.norm()
  if (dist < 0.001) return true
  const hit = bot.world.raycast(from, dir.scaled(1 / dist), dist + 0.6)
  if (!hit) return false
  const at = hit['position'] ?? new Vec3(hit.x, hit.y, hit.z)
  return at.equals(pos)
}
// Stand on a cell orthogonally BESIDE pos — never on pos itself. That is the
// one spot a floor cell is both visible and reachable from, and it is also how
// you avoid digging the ground out from under your own feet: do that and you
// fall into the very cell you have to fill, which nothing can then fill.
async function standBeside(pos) {
  const feet0 = bot.entity.position.floored()
  const onIt = pos.equals(feet0) || pos.equals(feet0.offset(0, -1, 0))
  if (!onIt && inReach(pos) && seesBlockCentre(pos)) return true
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const spot = pos.offset(ox, 1, oz)
    const floor = bot.blockAt(spot.offset(0, -1, 0))
    if (!floor || floor.boundingBox !== 'block') continue
    if (bot.blockAt(spot)?.boundingBox === 'block') continue
    if (bot.blockAt(spot.offset(0, 1, 0))?.boundingBox === 'block') continue
    if (!(await walkTo(spot.x - BASE.x, spot.y - y0, spot.z - BASE.z))) continue
    let f = bot.entity.position.floored()
    if (pos.equals(f) || pos.equals(f.offset(0, -1, 0))) {
      // walkTo aims at GoalNear(…, 1), and that radius is enough to set you
      // down ON the cell you must dig. Take the last step exactly, or you will
      // reject a perfectly good spot four times and give up standing on it.
      await Promise.race([
        bot.pathfinder.goto(new goals.GoalBlock(spot.x, spot.y, spot.z)).catch(note),
        sleep(4000),
      ])
      f = bot.entity.position.floored()
      if (pos.equals(f) || pos.equals(f.offset(0, -1, 0))) continue
    }
    if (seesBlockCentre(pos)) return true
  }
  return false
}
async function digAt(pos) {
  const b = bot.blockAt(pos)
  if (!b || b.boundingBox !== 'block') return true
  if (!(await standBeside(pos))) { bump('nowhere to stand beside the cell I must dig'); return false }
  await Promise.race([bot.dig(bot.blockAt(pos)).catch(note), sleep(4000)])
  return bot.blockAt(pos)?.boundingBox !== 'block'
}
// Replace a ground block with a material — how a person lays a floor:
// step off it, dig the grass out, drop the plank into the hole.
async function replaceGround(dx, dz, mat) {
  const pos = BASE.offset(dx, 0, dz)
  const there = bot.blockAt(pos)
  if (there && there.name === mat) return bump('ground already right')
  // STEP OFF BEFORE THE DIG. Measured live: digging first drops you one block
  // into the very cell you must fill, and then nothing can fill it — that is a
  // floor of holes with four planks in it. A guard placed AFTER the dig cannot
  // save you either: once you have fallen, the hole is at your feet, not under
  // them, so `pos === feet - 1` is already false and the guard never fires.
  // digAt() stands BESIDE the cell first (see standBeside): the only place it
  // can be seen from, and the only way not to dig the floor out from under
  // your own feet.
  if (!(await digAt(pos))) return bump('ground dig failed')
  const feet = bot.entity.position.floored()
  if (pos.equals(feet) || pos.equals(feet.offset(0, -1, 0)))
    return bump('fell into the cell I dug') // stepped off, still ended up in it
  await hold(mat)
  const picks = chooseFaces(pos)
  if (!picks.length) return bump('ground no visible face')
  for (const pick of picks) {
    await Promise.race([bot.placeBlock(pick.ref, pick.face).catch(note), sleep(3500)])
    if (bot.blockAt(pos)?.name === mat) { placed++; return bump('ground placed') }
  }
  return bump('ground placement did not land')
}

print(`starting phase A: ${JSON.stringify(whereAmI())}`)
await climbOutOfPit()

// --- phase 0: find and clear the strays yourself (a few, not a demolition) ---
// Anything standing where the design wants air is a stray. Furniture and a
// door are never strays — that is your own half-built house, per the rules above.
const mine = (n) =>
  n.includes('bed') || n.includes('torch') || n === 'chest' ||
  n === 'crafting_table' || n === 'furnace' || n === 'oak_door'
const buildMat = (n) =>
  n === 'oak_planks' || n === 'oak_log' || n === 'cobblestone' || n === 'glass_pane'
const debris = []
for (let dx = -2; dx < W + 2; dx++)
  for (let dz = -2; dz < D + 2; dz++)
    for (let dy = 0; dy < 3; dy++) {
      const b = bot.blockAt(BASE.offset(dx, 1 + dy, dz))
      if (!b || b.boundingBox !== 'block' || mine(b.name)) continue
      const inside = dx >= 0 && dx < W && dz >= 0 && dz < D
      // inside the footprint: anything that is not what the design wants there.
      // in the working margin: only FOREIGN blocks — your own stairs and eaves
      // from a previous Step 2b are scaffolding, not litter.
      if (inside ? b.name !== wantAt(dx, dy, dz) : !buildMat(b.name)) debris.push(b.position)
    }
if (debris.length > 24) {
  print(`STOP: ${debris.length} blocks stand where the house goes — that is a ruin or a hillside, not litter. Re-run Step 1 for another BASE.`)
  bot.chat('This lot is not clear enough to build on — looking for another spot.')
} else {
  if (debris.length) bot.chat(`Tidying the lot first — ${debris.length} stray blocks in the way.`)
  for (const p of debris) {
    const [sx, sz] = standFor(p.x - BASE.x, p.z - BASE.z)
    await walkTo(sx, 0, sz)
    await digAt(p)
  }

  // --- phase 1: embedded foundation — log corners, cobble plinth, plank floor ---
  bot.chat('Foundation first: log corners, a cobblestone plinth, and a proper plank floor.')
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      if (!isRing(x, z)) continue
      const [sx, sz] = standFor(x, z) // stand next to it, do not lean across the room
      await walkTo(sx, 0, sz)
      await replaceGround(x, z, isCorner(x, z) ? 'oak_log' : 'cobblestone')
    }
  // floor: rows back-to-front so the bot never stands on the hole it just dug
  for (let z = D - 2; z >= 1; z--) {
    await walkTo(3, 0, Math.max(1, z - 1))
    for (let x = 1; x < W - 1; x++) await replaceGround(x, z, 'oak_planks')
  }
  bot.chat('Floor is in — no more grass in the living room.')

  // --- phase 2: walls, column by column, standing next to each one ---
  bot.chat('Walls going up: planks with log corners, window openings on every side.')
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      if (!isRing(x, z)) continue
      const [sx, sz] = standFor(x, z)
      for (let dy = 0; dy < 3; dy++) {
        const want = wantAt(x, dy, z)
        if (want === 'air' || want === 'glass_pane') continue // door hole; panes come after
        await raiseTo(sx, standDyFor(dy), sz) // stand level with the course
        await put(x, dy, z, want)
      }
    }
  // panes into the openings, from inside, standing at each one
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++)
      for (let dy = 0; dy < 3; dy++)
        if (wantAt(x, dy, z) === 'glass_pane') {
          const [sx, sz] = standFor(x, z)
          await raiseTo(sx, standDyFor(dy), sz)
          await put(x, dy, z, 'glass_pane')
        }
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
    await Promise.race([bot.placeBlock(bedFloor, new Vec3(0, 1, 0)).catch(note), sleep(3500)])
  }
  if (!String(bot.blockAt(BASE.offset(1, 1, 3))?.name ?? '').includes('bed')) {
    // bot.placeBlock cannot seat a two-cell block on 1.21.4: measured from four
    // different positions and facings, the server drops the packet every time
    // and mineflayer reports only the silence. Say so and set it directly
    // (mcp-craft://skill/building-with-commands) rather than leaving the house
    // without a bed and calling that "refused".
    bump('bed refused by placeBlock — set by command instead')
    bot.chat('(the bed would not seat by hand — placing it directly)')
    const foot = BASE.offset(1, 1, 3), head = BASE.offset(1, 1, 4)
    bot.chat(`/setblock ${foot.x} ${foot.y} ${foot.z} red_bed[facing=south,part=foot]`)
    await sleep(500)
    bot.chat(`/setblock ${head.x} ${head.y} ${head.z} red_bed[facing=south,part=head]`)
    await sleep(800)
    bump(String(bot.blockAt(foot)?.name ?? '').includes('bed')
      ? 'bed by command' : 'bed failed even by command (cheats off?)')
  }
  for (const [x, z, mat] of [[5, 4, 'chest'], [5, 3, 'crafting_table']]) {
    const r = await put(x, 0, z, mat)
    if (r !== 'placed') bot.chat(`(${mat} did not land: ${r} — moving on)`)
  }
  // WALL torches: click a wall block's inside face at head height — the torch
  // hangs on the wall like a person's would, never scattered on the floor.
  async function wallTorch(wallDx, wallDz, faceIn, standDx, standDz) {
    await raiseTo(standDx, standDyFor(2), standDz) // the torch hangs at head height
    const wall = bot.blockAt(BASE.offset(wallDx, 2, wallDz))
    if (!wall || wall.boundingBox !== 'block') return bump('torch wall missing')
    await hold('torch')
    await Promise.race([bot.placeBlock(wall, faceIn).catch(note), sleep(3500)])
    return bump('torch attempted')
  }
  await wallTorch(4, 0, new Vec3(0, 0, 1), 3, 2)   // beside the door, inside
  await wallTorch(1, D - 1, new Vec3(0, 0, -1), 2, 3) // over the bed
  await wallTorch(W - 1, 3, new Vec3(-1, 0, 0), 4, 3) // over the work corner
  bot.chat(`Interior done. ${placed} blocks placed so far — attic and roof next (Step 2b).`)
}
printJson({ phase: 'A', placed, tally, errors, stalls, where: whereAmI() })
```

## Step 2b — attic floor, the roof walk, eaves, door, porch (`timeout: 420`)

Same `BASE`. Self-contained; skips anything already placed.

```js
const BASE = new Vec3(100, -61, 100) // ← the SAME BASE as Step 2a
const W = 7, D = 6
const y0 = BASE.y + 1
// Do NOT call bot.creative.stopFlying() here "just in case". mineflayer
// restores gravity from a value only startFlying() ever saves, so calling it
// without having flown sets gravity to null — the bot then never lands,
// onGround stays false, and every jump does nothing. The runtime guards this
// now; do not reintroduce the call. (Measured live: 208 failed pillars.)

// stand one cell inside the column you are working on (see Step 2a)
const standFor = (x, z) => [Math.min(Math.max(x, 1), W - 2), Math.min(Math.max(z, 1), D - 2)]

// WHAT IS MINE. Same rule as Step 2a, stated without wantAt (this fence does
// not carry the wall predicates): by the time the roof goes on, everything
// standing in the footprint is either the house or scaffolding this fence is
// tracking itself in `pillars` — and the cleanup below removes those by name.
// Nothing here is ever a legitimate target for the stuck-walk watchdog.
const partOfTheHouse = (p) => {
  const dx = p.x - BASE.x, dz = p.z - BASE.z, dy = p.y - y0
  if (dx < 0 || dx >= W) return false
  if (dz < -1 || dz > D) return false
  if (dz < 0 || dz >= D) return dy >= 3 // outside the footprint: only the eaves
  return true
}

// --- diagnostics: keep what the runtime tells you instead of discarding it ---
const tally = {}
const errors = {}
let stalls = 0
const bump = (r) => { tally[r] = (tally[r] ?? 0) + 1; return r }
const note = (e) => {
  const m = String(e?.message ?? e).slice(0, 140)
  errors[m] = (errors[m] ?? 0) + 1
}

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
// Returns TRUE only if it arrived. Never ignore the result: a failed walk
// leaves the bot where it was, and everything the next phase places from there
// is out of reach — that is how a run puts 9 blocks in 8 minutes and says nothing.
//
// PATHFINDER FIRST. It routes AROUND the wall you just built and UP the stairs
// you just laid; a straight-line shove cannot, and its stuck-watchdog ends up
// punching a hole through your own house instead (measured live: the bot could
// not reach the roof and demolished the walls). The shove stays as the fallback
// for the short hops pathfinder refuses to plan.
let movementsReady = false
async function walkTo(dx, dy, dz) {
  const target = new Vec3(BASE.x + dx, y0 + dy, BASE.z + dz)
  const near = () => bot.entity.position.distanceTo(target.offset(0.5, 0, 0.5)) < 1.8
  if (near()) return true
  // ALREADY AIRBORNE? Fly there. Landing and taking off again for every block
  // is what turns a two-minute roof into a timeout — measured live: flyTo
  // arrives in 0.1-0.4s, while land-then-pathfind costs 3-15s per cell. A phase
  // works either on the ground or in the air; it does not alternate per block.
  if (flying) {
    await flyClear(target.offset(0.5, 0, 0.5))
    if (near()) return true
  }
  await land() // the pathfinder cannot route a hovering bot — put its feet down
  if (!movementsReady) {
    bot.pathfinder.setMovements(new Movements(bot))
    movementsReady = true
  }
  const walk = bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 1))
  const routed = await Promise.race([
    walk.then(() => 'arrived', (e) => `path error: ${e.message}`),
    sleep(12000).then(() => 'timeout'),
  ])
  if (routed !== 'arrived') {
    bot.pathfinder.setGoal(null) // drop the stuck goal before shoving by hand
    note(`walk to ${dx},${dy},${dz}: ${routed}`)
  }
  if (near()) return true
  // fallback: shove in a straight line, jump the ledge, punch through what pins you
  const deadline = Date.now() + 6000
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
          const d = target.offset(0.5, 0, 0.5).minus(bot.entity.position)
          const step = new Vec3(Math.sign(Math.round(d.x)), 0, Math.sign(Math.round(d.z)))
          for (const dyFace of [1, 0]) {
            const b = bot.blockAt(bot.entity.position.floored().offset(step.x, dyFace, step.z))
            if (!b || b.boundingBox !== 'block') continue
            // Never tunnel out through your own build — walk around instead.
            if (partOfTheHouse(b.position)) { bump('pinned by my own house — not digging it'); continue }
            await Promise.race([bot.dig(b).catch(note), sleep(3000)])
          }
          lastMove = Date.now()
        }
      }
    }
    stalls++
    print(`stalled: walk to ${target.x} ${target.y} ${target.z} timed out at ${bot.entity.position.floored()}`)
    return false
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
// --- sight: the same rays the runtime casts, cast before the click ---
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
// Return EVERY usable face, nearest first — not just the best one. The nearest
// face is only a guess: the server can still refuse it (a neighbour updated, a
// block fell, an entity is in the cell), and another face of the same target
// often works. Measured live: 2 of every 10 refused picks had a face that would
// have landed. Trying one and reporting "placement did not land" throws that
// away for the price of a single extra click.
function chooseFaces(target) {
  const out = []
  for (const face of FACES) {
    const refPos = target.minus(face)
    const ref = bot.blockAt(refPos)
    if (!ref || ref.boundingBox !== 'block') continue
    if (!inReach(refPos)) continue
    if (!seesFace(refPos, face)) continue
    out.push({ ref, face, d: eyes().distanceTo(refPos.offset(0.5, 0.5, 0.5).plus(face.scaled(0.45))) })
  }
  return out.sort((a, b) => a.d - b.d)
}
const chooseFace = (target) => chooseFaces(target)[0] ?? null
// The runtime's DIG test rays at the block's CENTRE, not at a face — and you
// can never see the centre of the block you are standing on. That is why the
// scaffolding cleanup below has to step off a pillar before mining it.
function seesBlockCentre(pos) {
  const from = eyes()
  const dir = pos.offset(0.5, 0.5, 0.5).minus(from)
  const dist = dir.norm()
  if (dist < 0.001) return true
  const hit = bot.world.raycast(from, dir.scaled(1 / dist), dist + 0.6)
  if (!hit) return false
  const at = hit['position'] ?? new Vec3(hit.x, hit.y, hit.z)
  return at.equals(pos)
}
// Stand on a cell BESIDE pos — at pos's own level, never on top of it.
async function standBeside(pos) {
  const onIt = () => {
    const f = bot.entity.position.floored()
    return pos.equals(f) || pos.equals(f.offset(0, -1, 0))
  }
  if (!onIt() && inReach(pos) && seesBlockCentre(pos)) return true
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const spot = pos.offset(ox, 0, oz)
    const floor = bot.blockAt(spot.offset(0, -1, 0))
    if (!floor || floor.boundingBox !== 'block') continue
    if (bot.blockAt(spot)?.boundingBox === 'block') continue
    if (bot.blockAt(spot.offset(0, 1, 0))?.boundingBox === 'block') continue
    if (!(await walkTo(spot.x - BASE.x, spot.y - y0, spot.z - BASE.z))) continue
    if (onIt() || !seesBlockCentre(pos)) continue
    return true
  }
  return false
}
async function standWhereVisible(target) {
  const spots = []
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]])
    for (const oy of [0, 1, -1]) {
      const spot = target.offset(ox, oy, oz)
      const ground = bot.blockAt(spot.offset(0, -1, 0))
      const feetCell = bot.blockAt(spot)
      const headCell = bot.blockAt(spot.offset(0, 1, 0))
      if (feetCell && feetCell.boundingBox === 'block') continue
      if (headCell && headCell.boundingBox === 'block') continue
      // No floor under it does NOT mean unusable. Beside a third wall course
      // or a roof slope there IS no floor yet — that is exactly the spot a
      // person pillars up to. Keep it, marked airborne, and reach it with
      // raiseTo. Rejecting these is why a run reports "no face from anywhere I
      // can stand" for every block above its own eye and lays nothing.
      const airborne = !ground || ground.boundingBox !== 'block'
      if (airborne && spot.y <= bot.entity.position.y + 0.1) continue // a pit, not a perch
      spots.push({ spot, airborne })
    }
  // Floors before scaffolding, then nearest first: pillaring costs blocks and
  // a cleanup, so it is the second answer, never the first.
  spots.sort((a, b) =>
    Number(a.airborne) - Number(b.airborne) ||
    bot.entity.position.distanceTo(a.spot) - bot.entity.position.distanceTo(b.spot))
  for (const { spot, airborne } of spots.slice(0, 4)) {
    const up = airborne || spot.y > bot.entity.position.y + 0.1
    const got = up
      ? await raiseTo(spot.x - BASE.x, spot.y - y0, spot.z - BASE.z)
      : await walkTo(spot.x - BASE.x, spot.y - y0, spot.z - BASE.z)
    if (!got) continue
    if (chooseFace(target)) return true
  }
  return false
}
// Name WHICH failure it was: the two need opposite fixes. A face at your own
// level means step around it. A face above your eye means get your feet up
// there — leaning harder never works, and a tally that says only "no face"
// hides which of the two you actually hit.
const noFaceReason = (target) =>
  target.y > bot.entity.position.y + 1.2
    ? 'no face — target is above me and I could not get up to it'
    : 'no face from anywhere I can stand'
// You cannot put a block where your own body is. The server does not say so:
// it drops the packet, and mineflayer reports the silence as
// "Event blockUpdate did not fire within 5000ms" — which reads like a network
// fault and is almost always this instead. So step out and carry on, rather
// than counting it as a failure and leaving a hole in the wall.
async function stepAside(target) {
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const spot = bot.entity.position.floored().offset(ox, 0, oz)
    if (spot.equals(target) || spot.offset(0, 1, 0).equals(target)) continue
    const floor = bot.blockAt(spot.offset(0, -1, 0))
    if (!floor || floor.boundingBox !== 'block') continue
    if (bot.blockAt(spot)?.boundingBox === 'block') continue
    if (bot.blockAt(spot.offset(0, 1, 0))?.boundingBox === 'block') continue
    if (await walkTo(spot.x - BASE.x, spot.y - y0, spot.z - BASE.z)) return true
  }
  return false
}
async function put(dx, dy, dz, mat) {
  const target = BASE.offset(dx, 1 + dy, dz)
  let feet = bot.entity.position.floored()
  if (target.equals(feet) || target.equals(feet.offset(0, 1, 0))) {
    if (!(await stepAside(target))) return bump('standing there, nowhere to step')
    bump('stepped out of the cell I had to fill')
    feet = bot.entity.position.floored()
  }
  const existing = bot.blockAt(target)
  if (existing && existing.boundingBox === 'block') return bump('occupied')
  for (let s = 0; s < 2 && !inReach(target); s++) {
    const d = target.offset(0.5, 0, 0.5).minus(bot.entity.position)
    await bot.lookAt(bot.entity.position.offset(Math.sign(d.x), 1.62, Math.sign(d.z)), true)
    bot.setControlState('forward', true)
    await sleep(300)
    bot.setControlState('forward', false)
  }
  let picks = chooseFaces(target)
  if (!picks.length) {
    if (!(await standWhereVisible(target))) return bump(noFaceReason(target))
    picks = chooseFaces(target)
    if (!picks.length) return bump(noFaceReason(target))
  }
  await hold(mat)
  for (const pick of picks) {
    await Promise.race([bot.placeBlock(pick.ref, pick.face).catch(note), sleep(3500)])
    if (bot.blockAt(target)?.boundingBox === 'block') { placed++; return bump('placed') }
  }
  return bump('placement did not land')
}


// --- where am I, relative to the house? (mcp-craft://skill/humanlike) ---
// You have coordinates, not eyes: say them out loud. Every position below is
// reported BOTH absolute and in build coordinates, so a bad walk is obvious.
function whereAmI() {
  const f = bot.entity.position.floored()
  const rel = { dx: f.x - BASE.x, dy: f.y - y0, dz: f.z - BASE.z }
  return {
    at: [f.x, f.y, f.z],
    base: [BASE.x, BASE.y, BASE.z],
    rel,
    inside: rel.dx >= 0 && rel.dx < W && rel.dz >= 0 && rel.dz < D,
    belowBuild: rel.dy < 0,
  }
}
// --- height is not a jump (mcp-craft://skill/humanlike) ---
// To work above your head you STAND on something: the deck and stairs we build
// here, reached by walking. Only if no route up exists do you pillar under your
// own feet — and then you take the pillar with you when you leave.
// HOW TO GET UP THERE. A creative player does not build a tower to reach a
// roof — they fly, work, and drop back down, leaving nothing behind. Only in
// survival is scaffolding the answer, and even then you pillar ONCE and then
// work outward, block against block: a run that pillars under every single
// cell fills the living room with planks (measured: thirteen of them, none of
// which the cleanup managed to remove).
const canFly = bot.game.gameMode === 'creative'
let flying = false
async function land() {
  if (!flying) return
  // stopFlying() restores gravity from the value startFlying() saved, so these
  // two must always be used as a pair — see mcp-craft://skill/humanlike.
  await bot.creative.stopFlying()
  flying = false
  for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(150)
}
// FLY, do not teleport. bot.creative.flyTo walks the ENTITY POSITION along a
// straight line in 0.5-block steps with no collision check — its own source
// says "straight line, so make sure there's a clear path" — and finishes on
// `once(bot, 'move', 0)`, which has no timeout. Aimed through a wall the server
// snaps the position back, the loop never converges and the call never
// returns: measured live, six seconds with the bot not having moved a block.
//
// Ordinary motion is accepted, so use it. Measured in the same world:
//   forward + look, weightless ... 2.97 blocks/s horizontally
//   velocity.y held per tick ..... 7 blocks/s vertically
//   jump / sneak, weightless ..... 0.00 — a jump needs onGround, and flight
//                                  never is, which is why "just press jump"
//                                  silently does nothing up here.
async function flyLeg(goal, ms) {
  if (!flying) { await bot.creative.startFlying(); flying = true }
  // Vertical is the one axis the control states cannot drive while weightless:
  // hold the velocity yourself, proportionally, so you slow into the target
  // instead of sailing past it.
  const hold = () => {
    const dy = goal.y - bot.entity.position.y
    bot.entity.velocity.y = Math.max(-0.4, Math.min(0.4, dy * 0.6))
  }
  bot.on('physicsTick', hold)
  const deadline = Date.now() + ms
  try {
    while (Date.now() < deadline) {
      const d = goal.minus(bot.entity.position)
      if (d.norm() < 0.8) break
      if (Math.hypot(d.x, d.z) > 0.6) {
        await bot.lookAt(new Vec3(goal.x, bot.entity.position.y + 1.62, goal.z), true)
        bot.setControlState('forward', true)
      } else {
        bot.setControlState('forward', false)
      }
      await sleep(80)
    }
  } finally {
    bot.removeListener('physicsTick', hold)
    bot.setControlState('forward', false)
    bot.entity.velocity.y = 0
  }
  return bot.entity.position.distanceTo(goal) < 1.8
}
// Real flight still collides with things, so take the route a player takes:
// up clear of the build, across above it, then straight down onto the perch.
async function flyClear(goal) {
  // Straight there first. Most hops on a build site are a couple of blocks with
  // nothing in between, and going up to cruise height and back down for every
  // one of them costs about twenty blocks of vertical travel per block placed —
  // measured, that is what ran Step 2b out of its budget with the roof half
  // laid. Give the direct line a short leash; if it does not make it, THEN take
  // the long way over the top.
  if (await flyLeg(goal, 2500)) return true
  const cruiseY = Math.max(bot.entity.position.y, goal.y, y0 + 8) + 2
  const here = bot.entity.position
  const legs = [
    new Vec3(here.x, cruiseY, here.z),
    new Vec3(goal.x, cruiseY, goal.z),
    goal,
  ]
  for (const leg of legs) {
    if (!(await flyLeg(leg, 6000))) { bump('flight leg did not arrive'); return false }
  }
  return true
}
const pillars = []
async function raiseTo(dx, dy, dz) {
  const goalY = y0 + dy
  const atHeight = () => bot.entity.position.y >= goalY - 0.1
  if (atHeight() && (await walkTo(dx, dy, dz))) return true
  if (canFly) {
    // Hover exactly where the work is. No tower, no cleanup, no holes punched
    // in your own house trying to path to a ledge that has no walking route.
    const goal = new Vec3(BASE.x + dx + 0.5, goalY, BASE.z + dz + 0.5)
    if (await flyClear(goal)) return true
    // Flight is an optimisation, not a dependency. mineflayer's flyTo moves the
    // bot's position directly and the server can simply refuse it — measured
    // live, a bot left in a bad hover state did not move a block in six
    // seconds. When that happens, put the feet down and pillar like survival.
    bump('flight refused — falling back to the pillar')
    await land()
  }
  // Get BELOW the goal first, at whatever height the ground here actually is.
  // Never hand the pathfinder a goal hanging in mid-air: there is no floor
  // under it yet, so it spends its entire timeout proving that and fails —
  // measured live as fifteen "walk to …: timeout" entries in one 170s run.
  if (!atHeight()) await walkTo(dx, Math.floor(bot.entity.position.y) - y0, dz) // below the goal
  await hold('oak_planks')
  for (let i = 0; i < 6 && !atHeight(); i++) {
    const feet = bot.entity.position.floored()
    const ref = bot.blockAt(feet.offset(0, -1, 0))
    if (!ref || ref.boundingBox !== 'block') { bump('nothing under me to pillar from'); break }
    await bot.lookAt(feet.offset(0.5, -0.5, 0.5), true)
    bot.setControlState('jump', true)
    // WAIT FOR THE RISE, do not guess it. A player jump measured in this world
    // reads 0.42 / 0.75 / 1.00 / 1.17 / 1.25 at 50ms intervals: a flat
    // sleep(150) lands exactly on 1.00, the moment the cell is barely clear,
    // and any lag puts the hitbox still inside it — the server then drops the
    // placement silently and mineflayer reports it as
    // "Event blockUpdate did not fire within 5000ms".
    const jumped = Date.now()
    while (bot.entity.position.y < feet.y + 1.0 && Date.now() - jumped < 700) await sleep(25)
    if (bot.entity.position.y >= feet.y + 1.0 && seesFace(ref.position, new Vec3(0, 1, 0)))
      await Promise.race([bot.placeBlock(ref, new Vec3(0, 1, 0)).catch(note), sleep(1500)])
    bot.setControlState('jump', false)
    await sleep(450)
    const now = bot.entity.position.floored()
    if (now.y <= feet.y) break // not rising — stop rather than spin in place
    pillars.push(now.offset(0, -1, 0))
  }
  if (!atHeight()) { bump('could not gain height'); return false }
  // Standing on the pillar, directly under the goal: a second pathfinder call
  // would be another mid-air goal. Only re-walk if there is really a floor.
  const landing = new Vec3(BASE.x + dx + 0.5, goalY, BASE.z + dz + 0.5)
  if (bot.entity.position.distanceTo(landing) < 1.8) return true
  return await walkTo(dx, dy, dz)
}

// Below the build means in a hole: from down there every placement is refused
// for sight, so climb out FIRST and say where you are while you do it.
async function climbOutOfPit() {
  const w = whereAmI()
  if (!w.belowBuild) return true
  bot.chat('I dropped into a hole — climbing back up to the build.')
  print(`in a hole: ${JSON.stringify(w)}`)
  const dx = Math.min(Math.max(w.rel.dx, -2), W + 1)
  const dz = Math.min(Math.max(w.rel.dz, -2), D + 1)
  const out = await raiseTo(dx, 0, dz)
  if (!out) {
    bump('still below the build')
    print('could not climb out — dig steps toward BASE or re-run Step 1 for another lot')
  }
  return out
}

print(`starting phase B: ${JSON.stringify(whereAmI())}`)
await climbOutOfPit()

// --- attic floor (the roof deck a person walks on) ---
bot.chat('Attic floor going in — that is what I will stand on to lay the roof.')
// The deck is 1.9 blocks above the eye: from the middle of the room the far
// corners are past the 4.3 reach, so walk under each column before placing.
for (let z = 0; z < D; z++)
  for (let x = 0; x < W; x++) {
    const [sx, sz] = standFor(x, z)
    await walkTo(sx, 0, sz)
    await put(x, 3, z, 'oak_planks')
  }

// --- staircase up, climbing it as it grows ---
bot.chat('A little staircase up the front — no fair placing steps I cannot see.')
async function buildStairs(cols, z) {
  for (const [sx] of cols) await put(sx, 0, z, 'oak_planks')
  for (let level = 1; level < cols.length; level++) {
    await raiseTo(cols[level - 1][0], level, z)
    for (let i = level; i < cols.length; i++) await put(cols[i][0], level, z, 'oak_planks')
  }
}
const FRONT_STAIRS = [[5, 0], [4, 1], [3, 2]]
const BACK_STAIRS = [[1, 0], [2, 1], [3, 2]]
await walkTo(6, 0, -2)
await buildStairs(FRONT_STAIRS, -1)
await raiseTo(3, 3, -1)
await raiseTo(3, 4, 0) // onto the attic deck, north walkway
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
await raiseTo(3, 3, 6)
await raiseTo(3, 4, 5) // south walkway
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
      if (b && b.boundingBox === 'block') await Promise.race([bot.dig(b).catch(note), sleep(4000)])
    }
}
// pillars are scaffolding too — a house with a plank tower in the living room
// is not done. Take them TOP DOWN and from BESIDE each block: walking onto the
// pillar to mine it (the obvious move, and what this fence used to do) puts you
// on top of the very block you are aiming at, and the contract refuses every
// one of them — "no line of sight ... 1.1 away". Measured live: the whole
// cleanup failed that way and left thirteen planks standing indoors.
if (pillars.length) bot.chat('Taking the scaffolding back out.')
for (const p of pillars.slice().sort((a, b) => b.y - a.y)) {
  const b = bot.blockAt(p)
  if (!b || b.boundingBox !== 'block') continue
  if (!(await standBeside(p))) { bump('nowhere to stand beside the scaffolding'); continue }
  await Promise.race([bot.dig(bot.blockAt(p)).catch(note), sleep(4000)])
  if (bot.blockAt(p)?.boundingBox === 'block') bump('scaffolding would not come out')
}
await walkTo(3, 0, -2)
const doorResult = await put(3, 0, 0, 'oak_door')
if (doorResult !== 'placed' && !String(bot.blockAt(BASE.offset(3, 1, 0))?.name ?? '').includes('door'))
  bot.chat(`(the door did not go in: ${doorResult} — the house is still open)`)
// porch torches: hang them on the front wall either side of the door
for (const tx of [2, 4]) {
  const wall = bot.blockAt(BASE.offset(tx, 2, 0))
  if (wall && wall.boundingBox === 'block') {
    await hold('torch')
    await Promise.race([bot.placeBlock(wall, new Vec3(0, 0, -1)).catch(note), sleep(3500)])
  }
}
// NOT "house done" — nothing here has checked the house. Step 3 owns that
// claim, and it is the only fence allowed to announce it in chat.
bot.chat(`${placed} more blocks this phase — checking the house block by block now.`)
printJson({ phase: 'B', placed, tally, errors, stalls, where: whereAmI() })
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
      // A door cell must hold a door: 'air' here would pass an open hole as a house.
      const want = isDoor(x, z, dy) ? 'oak_door' : isCorner(x, z) ? 'oak_log' : isWindow(x, z, dy) ? 'glass_pane' : 'oak_planks'
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
