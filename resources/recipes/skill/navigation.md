# Navigation with pathfinder

`mineflayer-pathfinder` is already loaded on the bot; `goals` and `Movements`
are in scope. Every recipe here ends by printing where the bot actually is —
pathfinding can stop early, and only `bot.entity.position` tells the truth.

## Go to a point

```js
// Walk (or fly, in creative) to a target and prove you arrived.
bot.pathfinder.setMovements(new Movements(bot))
const target = new Vec3(120, 65, -40) // ← where you want to be
await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 1))
const d = bot.entity.position.distanceTo(target)
print(d <= 2.5 ? `arrived at ${bot.entity.position.floored()}` : `stopped ${d.toFixed(1)} blocks short`)
```

`GoalNear(x, y, z, range)` is the everyday goal. `range: 1` means "adjacent";
use 2–3 when you only need to be close enough to place blocks (reach is 4.5).

## Follow the human

```js
// Follow the nearest player for ten seconds, then stop cleanly.
const human = bot.nearestEntity((e) => e.type === 'player')
if (!human) {
  print('no player in range — nothing to follow')
} else {
  bot.pathfinder.setMovements(new Movements(bot))
  bot.pathfinder.setGoal(new goals.GoalFollow(human, 3), true) // dynamic goal
  await sleep(10000)
  bot.pathfinder.setGoal(null) // ALWAYS clear a dynamic goal when done
  print(`followed for 10s, now at ${bot.entity.position.floored()}`)
}
```

The second argument to `setGoal` makes the goal *dynamic* — pathfinder
re-plans as the target moves. A dynamic goal never completes on its own:
clear it with `setGoal(null)` or the bot follows forever.

## Stuck recovery

`goto` can hang on unreachable targets (a hole, a wall, water). Wrap it in a
watchdog, retry once with a relaxed range, then report honestly instead of
pretending.

```js
// goto with a watchdog: re-goal once, then report the truth.
bot.pathfinder.setMovements(new Movements(bot))
const target = new Vec3(200, 70, 35)

async function tryGoto(range, ms) {
  const goal = new goals.GoalNear(target.x, target.y, target.z, range)
  const watchdog = sleep(ms).then(() => 'timeout')
  const walk = bot.pathfinder.goto(goal).then(
    () => 'arrived',
    (e) => `path error: ${e.message}`,
  )
  return Promise.race([walk, watchdog])
}

let outcome = await tryGoto(1, 20000)
if (outcome !== 'arrived') {
  bot.pathfinder.setGoal(null) // drop the stuck goal before retrying
  outcome = await tryGoto(3, 20000) // relaxed range: "near" beats "never"
}
const d = bot.entity.position.distanceTo(target)
print(outcome === 'arrived' ? `arrived (${d.toFixed(1)} away)` : `could not reach target: ${outcome}, stopped ${d.toFixed(1)} away`)
```

If even the relaxed attempt fails, say so and pick a different spot — in
creative you can also fly over obstacles (`bot.creative.startFlying()` before
the goto often fixes "stuck in a ravine").
