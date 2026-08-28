# Building with commands (/fill, /setblock)

When the world has cheats on, `bot.chat('/fill …')` builds in one server tick
what `placeBlock` needs minutes to do. Use this path for anything large — a
20x20 floor, a hollow shell, clearing a hillside — and the physical path in
`mcp-craft://skill/building` for small work, survival worlds, or when the human
explicitly wants to watch the bot lay bricks.

## Step 1 — find out whether you may

There is no clean API for "are cheats on". Ask the server and read its answer:
send a harmless command and wait for the chat reply. No reply within a couple
of seconds means the command went nowhere.

```js
// Probe for command permission before planning a command-based build.
print(`game mode: ${bot.game.gameMode}`)
bot.chat('/gamemode creative')
const reply = await waitFor('messagestr', 2500).catch(() => null)
if (reply) {
  const text = String(reply[0])
  print(`server said: ${text}`)
  const denied = /unknown command|don't have permission|not allowed/i.test(text)
  print(denied ? 'commands are NOT available — use the placeBlock path' : 'commands are available')
} else {
  print('no chat reply in 2.5 s — assume commands are unavailable, use the placeBlock path')
}
```

`/gamemode creative` is a good probe because it is idempotent and useful: if it
works, you are also now in creative and can fly.

## Step 2 — build the shell

`/fill x1 y1 z1 x2 y2 z2 <block> [hollow|outline|replace]` is the workhorse.
Two rules: coordinates are absolute integers (derive them from `Vec3`, never
from a guess), and a single `/fill` is capped at 32768 blocks — split larger
regions into slabs and print progress between them.

```js
// A hollow 9x4x9 stone shell with a doorway, entirely via commands.
const base = bot.entity.position.floored().offset(-4, 0, -4)
const far = base.offset(8, 3, 8)
const say = (cmd) => {
  bot.chat(cmd)
  print(`> ${cmd}`)
}

say(`/fill ${base.x} ${base.y} ${base.z} ${far.x} ${far.y} ${far.z} stone hollow`)
await sleep(400)

// Doorway: two air blocks in the middle of the -Z wall.
say(`/fill ${base.x + 4} ${base.y} ${base.z} ${base.x + 4} ${base.y + 1} ${base.z} air`)
await sleep(400)

// Light it up so the human can see inside.
say(`/setblock ${base.x + 4} ${base.y + 2} ${base.z + 4} torch`)
await sleep(400)
print('commands sent — now verify, because a rejected command is silent')
```

Note `sleep` between commands: the chat queue is asynchronous and the world
needs a moment to settle before a `blockAt` sweep tells the truth.

## Step 3 — verify, because failure is silent

A mistyped block name, a region outside the loaded world, or a command you were
not allowed to run all produce the same thing on your side: nothing. The only
way to know is to look at the blocks.

```js
// Verify the shell: walls solid, interior hollow, doorway open.
const base = bot.entity.position.floored().offset(-4, 0, -4)
const nameAt = (v) => {
  const b = bot.blockAt(v)
  return b ? b.name : 'unloaded'
}

let wallWrong = 0
let hollowWrong = 0
for (let dy = 0; dy < 4; dy++)
  for (let dx = 0; dx < 9; dx++)
    for (let dz = 0; dz < 9; dz++) {
      const edge = dx === 0 || dz === 0 || dx === 8 || dz === 8 || dy === 0 || dy === 3
      const doorway = dz === 0 && dx === 4 && dy < 2
      const name = nameAt(base.offset(dx, dy, dz))
      if (doorway) {
        if (name !== 'air') hollowWrong++
      } else if (edge) {
        if (name !== 'stone') wallWrong++
      } else if (name !== 'air') {
        hollowWrong++
      }
    }

print(`walls wrong: ${wallWrong}, interior/doorway wrong: ${hollowWrong}`)
print(wallWrong === 0 && hollowWrong === 0 ? 'VERIFIED: shell matches the plan' : 'INCOMPLETE: re-check the /fill output above')
```

If the sweep reports every block `unloaded`, the region is outside the loaded
chunks — walk the bot closer with `bot.pathfinder.goto(new goals.GoalNear(x, y, z, 4))`
and sweep again. `unloaded` is not the same as missing, and reporting it as
missing to the human is worse than saying nothing.
