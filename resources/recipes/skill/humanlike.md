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
2. **Walk, look, sprint.** Face where you go, sprint on open ground, let
   auto-jump take 1-block steps (the bot runtime does this for you). Never
   fly to move — flight is for nothing in this corpus; it desyncs and hangs.
3. **A step beats a repath.** Barely out of reach (>4.3) → take one or two
   steps toward the target and place; do not re-plan a whole route.
4. **Height comes from under your feet.** Need to reach up? Nerd-pole:
   look down, jump, place beneath yourself. Come down by digging the pillar
   out from under you — and take your scaffolding with you.
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
            if (b && b.boundingBox === 'block') await Promise.race([bot.dig(b).catch(() => {}), sleep(3000)])
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
    await Promise.race([bot.placeBlock(ref, new Vec3(0, 1, 0)).catch(() => {}), sleep(1200)])
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
  await Promise.race([bot.dig(under).catch(() => {}), sleep(3000)])
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
  await Promise.race([bot.placeBlock(under, dir).catch(() => {}), sleep(1500)])
  if (bot.blockAt(under.position.plus(dir))?.boundingBox === 'block') laid++
  bot.setControlState('forward', true)
  await sleep(350)
  bot.setControlState('forward', false)
}
bot.setControlState('sneak', false)
print(`bridged ${laid}/${SPAN}`)
```
