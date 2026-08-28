# Survival basics: stay alive through the demo

A dead bot respawns at world spawn with an empty hand and an embarrassed
human. Check vitals between build steps; none of this matters in creative
(no hunger, no damage), so gate on the game mode first.

## Vitals and eating

```js
// Check vitals; eat if hungry and food is available.
if (bot.game.gameMode === 'creative') {
  print('creative mode — no hunger, no damage, nothing to manage')
} else {
  print(`health ${bot.health}/20, food ${bot.food}/20`)
  if (bot.food >= 16) {
    print('not hungry enough to eat (eating works below 20/20 only when food < 20, sprint needs > 6)')
  } else {
    const EDIBLE = ['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'apple', 'baked_potato', 'carrot']
    const food = bot.inventory.items().find((i) => EDIBLE.includes(i.name))
    if (!food) {
      print('hungry with no food in the inventory — craft, /give, or ask the human')
    } else {
      await bot.equip(food, 'hand')
      await bot.consume()
      print(`ate ${food.name} — food now ${bot.food}/20`)
    }
  }
}
```

`bot.consume()` rejects if the held item is not edible or the food bar is
full — that is why the recipe checks first instead of trying blindly.

## Night and hostile mobs

```js
// Situational awareness: time of day and nearby hostiles.
const time = bot.time.timeOfDay // 0..24000; night is roughly 13000..23000
const night = time > 13000 && time < 23000
const me = bot.entity.position
const hostiles = Object.values(bot.entities).filter(
  (e) => String(e.kind ?? '').includes('Hostile') && e.position.distanceTo(me) < 16,
)
print(`time ${time} (${night ? 'NIGHT' : 'day'}), hostiles within 16 blocks: ${hostiles.length}`)
if (hostiles.length > 0) printJson(hostiles.slice(0, 5).map((e) => ({ name: e.name, dist: +e.position.distanceTo(me).toFixed(1) })))
```

Practical responses, cheapest first:

1. **Light the area** — hostiles do not spawn near torches; the building
   recipes place them for exactly this reason.
2. **Wall yourself in** — two blocks of anything between the bot and a
   creeper is a complete defense while you finish the build.
3. **Skip the night** — if the bot is opped, `bot.chat('/time set day')`
   (verify with `bot.time.timeOfDay` after; commands fail silently).

## Do not drown, do not burn

Before long pathfinding trips, remember pathfinder happily routes through
water and across lava-adjacent terrain. In survival, prefer daylight trips,
keep `maxDistance` on `findBlocks` modest, and re-check `bot.health` after
every `goto` — a silent 3-heart loss on arrival means the route is bad and
the way back needs a different plan.
