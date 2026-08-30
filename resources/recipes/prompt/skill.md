# devrig-craft recipes — start here

You are driving a real Minecraft bot that a human is watching in first person.
There are only eight `craft_*` tools, and seven of them are plumbing: list
worlds, list bots, join, fetch a recipe, chat, take a screenshot, send
feedback. The one that does the work is **`craft_execute_code`** — you write
JavaScript, it runs inside the live bot process with the mineflayer API in
scope.

That is the whole design. A narrow tool surface, a full capability surface
behind one execute-code tool, and these articles instead of a wrapper library.
When you want to do something new, you do not need a new tool: you need the
right few lines of mineflayer, and that is what the articles below teach.

## Articles

| URI | What it covers |
|---|---|
| `mcp-craft://skill/house` | **Building a house? Start HERE.** A complete, tuned one-call build: walls, windows, gable roof, furniture, door — copy, set BASE, run. |
| `mcp-craft://skill/building` | Placement fundamentals: the place loop, reach, occupied cells, verification. Read when the house recipe does not fit the request. |
| `mcp-craft://skill/building-with-commands` | `/fill`, `/setblock` and `/give` via chat when cheats are on — the fast path for large builds, and how to detect that it is available. |
| `mcp-craft://skill/world-queries` | `blockAt`, `findBlocks`, entity queries, and **the verification pattern** — how to prove what you built is actually there. |
| `mcp-craft://skill/humanlike` | The movement & placement doctrine: striding with self-unstick, step-beats-repath, nerd-poling, sneak-bridging. |
| `mcp-craft://skill/navigation` | Pathfinder: goto, following the human, dynamic goals, stuck recovery with a watchdog. |
| `mcp-craft://skill/inventory` | Creative hotbar self-service, counting, survival crafting, equipping the right item before placing. |
| `mcp-craft://skill/survival` | Health/food monitoring, eating, night and hostile-mob awareness — keeping an unattended demo alive. |
| `mcp-craft://skill/design-philosophy` | Why this MCP looks like this: the MCP Steroid tenets mapped to Minecraft, tool-by-tool mirror table. |

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
6. **Narrate in the game chat — you are being watched.** Your `reason` is
   automatically spoken into the chat when a script starts; inside long
   scripts, add your own `bot.chat('...')` one-liners at every phase change:
   the plan, each milestone, the verification verdict. Think out loud, keep
   each line under ~200 chars, and never go silent for more than a phase —
   the running commentary is half the show.
7. **Do not compose long scripts from scratch — thinking time is frozen-bot
   time.** The articles carry complete, tuned fences (the house build is one
   call, `mcp-craft://skill/house`): copy, set the parameters, run. Send the
   first script within seconds of joining; adapt afterwards.
8. **Movement that hangs:** never `bot.creative.flyTo`, never a `goto` while
   flying — both freeze forever on LAN worlds. Walk (`stopFlying()` first),
   and race every `goto` with a `sleep` watchdog, then `setGoal(null)`.
9. **The runtime enforces human placement.** `bot.placeBlock` and `bot.dig`
   turn the head smoothly toward the target, REFUSE anything beyond arm's
   reach (4.5), REFUSE faces without line of sight (no clicking through
   walls, no top faces from under their plane — get above or beside things
   like a person), and pace every click to 2–3 per second with human
   jitter. Plan builds top-down accordingly: roofs are walked, not sniped
   from the ground. The movement doctrine is `mcp-craft://skill/humanlike`.
10. **Check you can move before you plan.** A rejoining bot spawns where it
   disconnected — possibly boxed inside leftovers, or left HOVERING mid-air
   by server-side flight state (a walk test passes while flying, so check
   altitude first: solid ground more than 1 block below feet → `/tp` down).
   The house recipe's `ensureMobile` does both checks in ~2 seconds. Never
   spend minutes diagnosing movement while the human watches a statue.
11. **Look at what you built before you call it done.** When the build stands,
   `craft_take_screenshot` it from all four sides and from above, and look at
   them. Compare what you see against what you set out to build. Then say
   plainly whether it is right — and if it is not, name what is wrong and fix
   it. A verdict you did not look at is not a verdict. Correctness is still
   the `bot.blockAt` sweep's job; the pictures answer a different question,
   which is whether it looks like the thing you meant to build.
