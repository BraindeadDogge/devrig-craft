# Blueprint: the plan format, and showing it before you build

A plan is data, not a script. State the shape once, as `LEGEND` and `PLAN`,
and everything downstream — building, verifying, showing progress — reads
that same data. There is no second copy to drift out of sync with the first.

`LEGEND` is an object mapping a single character to a block name — the
character `L` might mean `oak_log`, `C` might mean `cobblestone`, and so on.

`PLAN` is an array of layers, each `{ y, rows }`, **listed bottom-up** (the
first entry is the lowest layer). `y` is a **height offset from BASE**, not
a world Y coordinate — layer 0 sits on BASE, layer 1 sits one block above it,
and so on. `rows` is an array of strings; `rows[z]` is the row at depth `z`,
and within that string, the character at index `x` is the cell at that `x`
offset from BASE. **Every row in every layer must be the same length, and
every layer must have the same number of rows** — a ragged plan cannot be
addressed by a single `(x, y, z)` triple.

Each character in a row means exactly one of three things:

- **A legend character means the block belongs here.** Look it up in
  `LEGEND` to get the block name, and place (or expect) that block at this
  cell.
- **`.` means this cell must be empty.** Nothing goes here — if the build
  finds a block occupying it, that is a defect to clear, not a cell to skip.
- **A space means not mine — leave whatever is there and do not report on
  it.** A blank cell is outside the plan's authority: do not place into it,
  do not dig it out, and do not flag it as wrong during verification. This
  is how a plan describes a partial shape (an L-shaped floor, a doorway gap
  cut into an otherwise full wall) without claiming the whole bounding box.

Because the whole grammar is three symbols, showing the plan back — before
touching a single block — should be enough for a human or the model itself to
catch a mistake by eye. `renderPlan` below does exactly that: it prints every
layer as an elevation, prints the legend it resolved, and warns about any
character it cannot resolve or about a ragged grid, before anything is built.

```js
// A plan is data: a legend from character to block name, and one string grid
// per layer. Everything downstream — building, verifying, showing — reads THIS,
// so the shape can never be stated twice and drift.
const LEGEND = { L: 'oak_log', P: 'oak_planks', o: 'glass_pane', C: 'cobblestone', D: 'oak_door' }
const PLAN = [
  { y: 0, rows: ['LCCCCCL', 'CPPPPPC', 'CPPPPPC', 'LCCCCCL'] },
  { y: 1, rows: ['LPPDPPL', 'o.....o', 'P.....P', 'LPPPPPL'] },
]

// Show the intent BEFORE placing anything. A plan you have looked at is a plan
// you can be wrong about out loud; a plan you only executed is one you discover
// was wrong afterwards, in blocks.
function renderPlan(plan, legend) {
  const unknown = new Set()
  for (const layer of plan)
    for (const row of layer.rows)
      for (const ch of row)
        if (ch !== '.' && ch !== ' ' && !legend[ch]) unknown.add(ch)
  for (const layer of plan) {
    print(`--- y+${layer.y} ---`)
    for (const [z, row] of layer.rows.entries()) print(`z=${String(z).padStart(2)} ${row}`)
  }
  const used = Array.from(new Set(plan.flatMap((l) => l.rows.join('').split(''))))
    .filter((c) => c !== '.' && c !== ' ')
    .sort()
  print(`legend: ${used.map((c) => `${c}=${legend[String(c)] ?? '???'}`).join('  ')}`)
  if (unknown.size) print(`WARNING: no legend entry for ${[...unknown].join(', ')} — those cells cannot be built`)
  const widths = new Set(plan.flatMap((l) => l.rows.map((r) => r.length)))
  const depths = new Set(plan.map((l) => l.rows.length))
  if (widths.size > 1 || depths.size > 1)
    print(`WARNING: ragged plan — row lengths ${[...widths].join('/')}, layer depths ${[...depths].join('/')}`)
}

renderPlan(PLAN, LEGEND)
```

## Building it

`buildPlan(BASE, plan, legend)` is the one driver. It walks every layer
bottom-up — so a new block always has a neighbour beneath it to click — and
for each cell asks the plan what belongs there. Nothing about the shape is
hardcoded, so the same driver builds any `LEGEND`/`PLAN` you hand it.

None of the movement and placement code below is new: it is `house.md`'s
Step 2a prelude, already proven against a live world and pinned
byte-identical between Step 2a and Step 2b. Only two pieces changed, because
they used to read the house's own fixed predicates:

- **`partOfTheBuild`** replaces `partOfTheHouse`. The stuck-walk watchdog
  digs whatever pins the bot, and it cannot tell a hillside from the wall it
  just built — it has to be told what is off limits. `partOfTheHouse` knew
  that from a hardcoded footprint; `partOfTheBuild` asks the plan instead:
  a cell is the build's own the moment the plan has a non-space character
  for it, so the watchdog is right for any shape without being told twice.
- **`put`** already took its material as a parameter — now the *driver*
  reads that material from the plan instead of from a hardcoded design.

Everything else — the sight and reach tests, standing beside a cell before
you dig it, flying then pillaring to gain height, routing around obstacles
before shoving through them — survives unchanged, because none of it was
ever house-specific. It was always "how a person places or clears a block
they can actually see and reach."

```js
const LEGEND = { L: 'oak_log', P: 'oak_planks', o: 'glass_pane', C: 'cobblestone', D: 'oak_door' }
const PLAN = [
  { y: 0, rows: ['LCCCCCL', 'CPPPPPC', 'CPPPPPC', 'LCCCCCL'] },
  { y: 1, rows: ['LPPDPPL', 'o.....o', 'P.....P', 'LPPPPPL'] },
]
const BASE = new Vec3(100, -61, 100) // ← your own site; keep LEGEND/PLAN above in sync with it
// Do NOT call bot.creative.stopFlying() here "just in case". mineflayer
// restores gravity from a value only startFlying() ever saves, so calling it
// without having flown sets gravity to null — the bot then never lands,
// onGround stays false, and every jump does nothing. The runtime guards this
// now; do not reintroduce the call. (Measured live: 208 failed pillars.)
const y0 = BASE.y // layer 0 of the plan sits ON base — no +1, unlike house.md
const W = PLAN[0].rows[0].length, D = PLAN[0].rows.length // for diagnostics only

// --- diagnostics: keep what the runtime tells you instead of discarding it ---
const tally = {} // per-cell outcome counts: placed / occupied / out of reach / …
const errors = {} // distinct refusals from the placement contract, with counts
let stalls = 0 // walks that ran out of time — the classic "builds standing still"
const bump = (r) => { tally[r] = (tally[r] ?? 0) + 1; return r }
const note = (e) => {
  const m = String(e?.message ?? e).slice(0, 140)
  errors[m] = (errors[m] ?? 0) + 1
}

// --- where am I, relative to the build? (mcp-craft://skill/humanlike) ---
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
  // measured, that is what ran a house's roof phase out of its budget. Give the
  // direct line a short leash; if it does not make it, THEN take the long way.
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
    // in your own build trying to path to a ledge that has no walking route.
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
  await hold('oak_planks') // scaffolding, regardless of what the plan itself uses
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
    print('could not climb out — dig steps toward BASE or re-run for another site')
  }
  return out
}

// --- materials: one hotbar slot per material, plus scaffolding planks (raiseTo
// pillars with them regardless of what the plan itself is built from) ---
const MATS = Array.from(new Set([...Object.values(LEGEND), 'oak_planks']))
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
// punching a hole through your own build instead (measured live: the bot could
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
            if (partOfTheBuild(BASE, PLAN, LEGEND, b.position)) { bump('pinned by my own build — not digging it'); continue }
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
// The material comes from the PLAN, not from a fixed design — that is the
// whole point of the engine. put() itself already only ever took `mat` as a
// parameter; nothing here changed except who is calling it.
async function put(dx, dy, dz, mat) {
  const target = BASE.offset(dx, dy, dz)
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

// --- the engine itself: read the plan, ask it what belongs at each cell ---
// A cell's material comes from the plan. Absent character, or a space, means
// the cell is not ours and we neither build nor judge it.
const planAt = (plan, legend, dx, dy, dz) => {
  const layer = plan.find((l) => l.y === dy)
  const ch = layer?.rows[dz]?.[dx]
  if (ch === undefined || ch === ' ') return undefined // not mine
  if (ch === '.') return 'air'
  return legend[ch]
}
// Anything the plan speaks for is the build's own — the stuck-walk watchdog
// must never tunnel out through it. This is what `partOfTheHouse` did with
// hardcoded predicates; now it reads the plan, so it is right for any shape.
const partOfTheBuild = (BASE, plan, legend, p) => {
  const want = planAt(plan, legend, p.x - BASE.x, p.y - BASE.y, p.z - BASE.z)
  return want !== undefined && want !== 'air'
}

// Build bottom-up: every block then has a neighbour beneath it to click.
async function buildPlan(BASE, plan, legend) {
  const layers = [...plan].sort((a, b) => a.y - b.y)
  for (const layer of layers) {
    for (const [dz, row] of layer.rows.entries()) {
      for (let dx = 0; dx < row.length; dx++) {
        const want = planAt(plan, legend, dx, layer.y, dz)
        if (want === undefined) continue
        const at = BASE.offset(dx, layer.y, dz)
        const there = bot.blockAt(at)
        if (want === 'air') {
          if (!there || there.boundingBox !== 'block') { bump('already clear'); continue }
          if (!(await digAt(at))) bump('could not clear a cell the plan wants empty')
          continue
        }
        if (there?.name === want) { bump('already right'); continue }
        await put(dx, layer.y, dz, want)
      }
    }
    print(`layer y+${layer.y} done — ${placed} placed so far`)
  }
  return { placed, tally, errors, stalls }
}

print(`starting: ${JSON.stringify(whereAmI())}`)
await climbOutOfPit()
const result = await buildPlan(BASE, PLAN, LEGEND)
printJson({ ...result, where: whereAmI() })
```
