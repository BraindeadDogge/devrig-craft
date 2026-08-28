# World queries and the verification pattern

Everything the bot knows about the world comes through three calls. Learn these
and you never have to guess what is out there — or whether your build worked.

## `bot.blockAt(vec)` — one block, right now

Returns a `Block` (with `.name`, `.type`, `.boundingBox`, `.position`) or
`null` when the chunk is not loaded. `null` means *unknown*, not *air* — that
distinction is the single most common source of wrong conclusions.

```js
// What is around the bot: the block underfoot, at eye level, and overhead.
const feet = bot.entity.position.floored()
const probes = [
  { label: 'under', at: feet.offset(0, -1, 0) },
  { label: 'feet', at: feet },
  { label: 'head', at: feet.offset(0, 1, 0) },
  { label: 'sky', at: feet.offset(0, 4, 0) },
]
for (const p of probes) {
  const b = bot.blockAt(p.at)
  print(`${p.label} (${p.at.x} ${p.at.y} ${p.at.z}): ${b ? b.name : 'UNLOADED — not air, unknown'}`)
}
```

## `bot.findBlocks(options)` — search the loaded world

`{ matching, maxDistance, count, point }`, where `matching` is a block id, an
array of ids, or a predicate. It returns positions, closest first — feed each
back through `blockAt` when you need the block itself.

```js
// The ten nearest logs, wherever they are, with their exact kind.
const logIds = Object.keys(mcData.blocksByName)
  .filter((name) => name.endsWith('_log'))
  .map((name) => mcData.blocksByName[name].id)

const positions = bot.findBlocks({ matching: logIds, maxDistance: 48, count: 10 })
const here = bot.entity.position
printJson(
  positions.map((p) => {
    const b = bot.blockAt(p)
    return { name: b ? b.name : 'unloaded', x: p.x, y: p.y, z: p.z, dist: Number(here.distanceTo(p).toFixed(1)) }
  }),
)
print(`${positions.length} logs found within 48 blocks`)
```

A predicate is worth it when the criterion is not just identity:

```js
// Exposed ore: any ore block with air on at least one side.
const isOre = (block) => block.name.endsWith('_ore')
const candidates = bot.findBlocks({ matching: isOre, maxDistance: 32, count: 64 })
const exposed = candidates.filter((p) => {
  const sides = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  return sides.some((s) => {
    const n = bot.blockAt(p.offset(s[0], s[1], s[2]))
    return n && n.name === 'air'
  })
})
print(`${exposed.length} of ${candidates.length} ore blocks are exposed`)
printJson(exposed.slice(0, 10).map((p) => ({ x: p.x, y: p.y, z: p.z })))
```

## `bot.entities` — players, mobs, items

A map of entity id to `Entity` (`.type`, `.name`, `.position`, `.username` for
players). There is no radius parameter; filter by distance yourself.

```js
// Everything alive within 24 blocks, nearest first.
const me = bot.entity.position
const nearby = Object.values(bot.entities)
  .filter((e) => e !== bot.entity && e.position.distanceTo(me) <= 24)
  .map((e) => ({
    type: e.type,
    name: e.username ? e.username : e.name,
    dist: Number(e.position.distanceTo(me).toFixed(1)),
  }))
  .sort((a, b) => a.dist - b.dist)
printJson(nearby)
print(`${nearby.length} entities within 24 blocks`)
```

## The verification pattern

This is the centerpiece of the whole product: **a build is finished when a
sweep says so.** Not when the place loop finished, not when a screenshot looks
right. Build the list of what you expect, compare it against `blockAt`, print
the mismatches, and report *that* to the human.

```js
// assertBuild: expected-vs-actual over an explicit list. Copy this shape.
const base = bot.entity.position.floored().offset(-2, 0, -2)

// 1. Say what you expect, block by block.
const expected = []
for (let dx = 0; dx < 5; dx++)
  for (let dz = 0; dz < 5; dz++)
    expected.push({ at: base.offset(dx, 0, dz), want: 'stone' })

// 2. Compare. Keep "unloaded" separate from "wrong block" — they need
//    different fixes: walk closer vs. place again.
const wrong = []
const unloaded = []
for (const e of expected) {
  const block = bot.blockAt(e.at)
  if (!block) unloaded.push(e)
  else if (block.name !== e.want) wrong.push({ x: e.at.x, y: e.at.y, z: e.at.z, want: e.want, got: block.name })
}

// 3. Print the verdict, with evidence.
print(`checked ${expected.length} blocks: ${wrong.length} wrong, ${unloaded.length} unloaded`)
if (wrong.length) printJson(wrong.slice(0, 20))
if (unloaded.length) print('some blocks are in unloaded chunks — move closer and sweep again before concluding')
print(wrong.length === 0 && unloaded.length === 0 ? 'VERIFIED: build matches the plan' : 'NOT VERIFIED')
```

Screenshots are for the human's benefit and are best-effort (in M1 there are
none at all). Pixels never decide whether a build succeeded — the sweep does.
