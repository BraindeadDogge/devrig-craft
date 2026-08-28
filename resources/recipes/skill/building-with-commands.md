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
  // Vanilla answers an unpermitted command with "Unknown or incomplete
  // command, see below for error" — match that exact phrase too.
  const denied = /unknown or incomplete command|unknown command|don't have permission|not allowed/i.test(text)
  print(denied ? 'commands are NOT available — use the placeBlock path' : 'commands are available')
} else {
  print('no chat reply in 2.5 s — assume commands are unavailable, use the placeBlock path')
}
```

`/gamemode creative` is a good probe because it is idempotent and useful: if it
works, you are also now in creative and can fly.

## Step 1b — stocking up in survival: /give

When the world is survival but cheats are on, you do not need creative to get
materials — `/give` fills the inventory for the physical placeBlock path.
Like every command, it fails silently, so count the inventory before and after:

```js
// Stock up via /give and prove it worked.
const count = () => bot.inventory.items().filter((i) => i.name === 'stone').reduce((n, i) => n + i.count, 0)
const before = count()
bot.chat(`/give ${bot.username} stone 64`)
await sleep(1000)
const got = count() - before
print(got > 0 ? `got ${got} stone` : '/give produced nothing — commands unavailable, gather blocks instead')
```

## Step 2 — build the shell

`/fill x1 y1 z1 x2 y2 z2 <block> [hollow|outline|replace]` is the workhorse.
Two rules: coordinates are absolute integers (derive them from `Vec3`, never
from a guess), and a single `/fill` is capped at 32768 blocks — split larger
regions into slabs and print progress between them.

```js
// A hollow 9x4x9 stone shell with a doorway, entirely via commands.
// NOTE the +6 x-offset: the region starts NEXT TO the bot — a /fill whose
// region contains the bot entombs it (or shoves it onto the roof).
const base = bot.entity.position.floored().offset(6, 0, -4)
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

// Light: a torch standing on the interior floor (dy=0 is the stone floor,
// so a torch at dy=1 has support — never /setblock a torch in mid-air).
say(`/setblock ${base.x + 2} ${base.y + 1} ${base.z + 4} torch`)
await sleep(400)
print(`shell base: ${base.x} ${base.y} ${base.z} — now verify, because a rejected command is silent`)
```

Note `sleep` between commands: the chat queue is asynchronous and the world
needs a moment to settle before a `blockAt` sweep tells the truth.

## Step 3 — verify, because failure is silent

A mistyped block name, a region outside the loaded world, or a command you were
not allowed to run all produce the same thing on your side: nothing. The only
way to know is to look at the blocks.

```js
// Verify the shell: walls solid, interior hollow, doorway open, torch lit.
// The build fence moved the world, maybe the bot too — never re-derive the
// base from bot.entity.position here; use the base the build fence printed.
const base = new Vec3(100, 64, 100) // ← replace with the "shell base" printed by Step 2
const nameAt = (v) => {
  const b = bot.blockAt(v)
  return b ? b.name : 'unloaded'
}

let wallWrong = 0
let hollowWrong = 0
let unloaded = 0
for (let dy = 0; dy < 4; dy++)
  for (let dx = 0; dx < 9; dx++)
    for (let dz = 0; dz < 9; dz++) {
      const edge = dx === 0 || dz === 0 || dx === 8 || dz === 8 || dy === 0 || dy === 3
      const doorway = dz === 0 && dx === 4 && dy < 2
      const torch = dx === 2 && dy === 1 && dz === 4
      const name = nameAt(base.offset(dx, dy, dz))
      if (name === 'unloaded') unloaded++
      else if (doorway) {
        if (name !== 'air') hollowWrong++
      } else if (torch) {
        if (name !== 'torch') hollowWrong++
      } else if (edge) {
        if (name !== 'stone') wallWrong++
      } else if (name !== 'air') {
        hollowWrong++
      }
    }

print(`walls wrong: ${wallWrong}, interior wrong: ${hollowWrong}, unloaded: ${unloaded}`)
if (unloaded > 0) print('unloaded is not missing — walk closer and re-sweep before judging')
else print(wallWrong === 0 && hollowWrong === 0 ? 'VERIFIED: shell matches the plan' : 'INCOMPLETE: re-check the /fill output above')
```

If the sweep reports every block `unloaded`, the region is outside the loaded
chunks — walk the bot closer with `bot.pathfinder.goto(new goals.GoalNear(x, y, z, 4))`
and sweep again. `unloaded` is not the same as missing, and reporting it as
missing to the human is worse than saying nothing.
