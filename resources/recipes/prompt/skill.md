# devrig-craft recipes — start here

You are driving a real Minecraft bot that a human is watching in first person.
There are only eight `craft_*` tools, and seven of them are plumbing: list
worlds, join, leave, fetch a recipe, take a screenshot, send feedback. The one
that does the work is **`craft_execute_code`** — you write JavaScript, it runs
inside the live bot process with the mineflayer API in scope.

That is the whole design. A narrow tool surface, a full capability surface
behind one execute-code tool, and these articles instead of a wrapper library.
When you want to do something new, you do not need a new tool: you need the
right few lines of mineflayer, and that is what the articles below teach.

## Articles

| URI | What it covers |
|---|---|
| `mcp-craft://skill/building` | The happy path: pick a flat spot, stock the hotbar in creative, `placeBlock` a house, handle reach, verify the result. |
| `mcp-craft://skill/building-with-commands` | `/fill` and `/setblock` via chat when cheats are on — the fast path for large builds, and how to detect that it is available. |
| `mcp-craft://skill/world-queries` | `blockAt`, `findBlocks`, entity queries, and **the verification pattern** — how to prove what you built is actually there. |

Fetch one with `craft_fetch_resource` before you write a script for that kind
of task. Every ```js block in them is a complete `craft_execute_code` body,
type-checked against the exact scope below by this repo's test suite.

## The scope your script runs in

Exactly these names exist, injected fresh per script:

| Name | What it is |
|---|---|
| `bot` | The live mineflayer `Bot`, with `mineflayer-pathfinder` already loaded (`bot.pathfinder`). |
| `Vec3` | Position constructor: `new Vec3(x, y, z)`. |
| `mcData` | `minecraft-data` for the server's version — `mcData.itemsByName.stone.id`, `mcData.blocksByName`. |
| `goals` | Pathfinder goals — `new goals.GoalNear(x, y, z, range)`. |
| `Movements` | Pathfinder movement config — `bot.pathfinder.setMovements(new Movements(bot))`. |
| `Item` | `prismarine-item` class bound to the server version — `new Item(id, count)`. |
| `print(...)` | Your only output channel. The tool returns **only what you print**. |
| `printJson(v)` | Pretty-prints JSON — use it for structured findings. |
| `sleep(ms)` | Awaitable delay. |
| `waitFor(event, timeoutMs?)` | Resolves with the event's arguments — `await waitFor('messagestr', 3000)`. |

And nothing else. Specifically: **no `require`**, no `import`, no `fs`, no
`setTimeout` (use `sleep`), no `console.log` (use `print`). Your code is the
body of an async function, so top-level `await` is expected.

## Rules that keep you out of trouble

1. **Print or it did not happen.** A script that returns without printing gets
   you a "printed nothing" hint and no data. End every script with a `print`.
2. **Verify through the API, never through pixels.** After any build, sweep the
   region with `bot.blockAt` and print expected-vs-actual. Screenshots are for
   the human, are best-effort, and are not available in M1 at all. A build is
   done when a sweep says so — see `mcp-craft://skill/world-queries`.
3. **One script, one job.** Scripts are killed at their timeout; a 4000-block
   `/fill` belongs in one call, a whole village does not. Chunk the work and
   print progress as you go.
4. **Reach is 4.5 blocks.** `bot.placeBlock` fails outside it and needs a solid
   neighbour block to click. Reposition with `bot.pathfinder.goto` — the
   building article has the loop that does this correctly.
5. **The human is standing right there.** Do not build on top of them, do not
   dig out the floor under them, and prefer a spot a few blocks away.
