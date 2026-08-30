# TODO

Follow-ups found while implementing the M1 discovery, recipe and CI tasks.

## Screenshot success path — shipped 2026-08-30

~~`craft_take_screenshot` ships error-branch only (M2 Task 2 descope, see
`docs/design.md` §13)~~ — a success path landed instead: a bounded
`bot.blockAt` cube, projected orthographically and encoded to PNG over
`node:zlib`, no GL and no native dependency. `docs/design.md` §13 and §6
record the reversal and the refinement; `resources/recipes/prompt/skill.md`
rule 11 now tells the agent to look at the pictures before calling a build
done.

## M3 input: manual demo numbers (2026-08-28, M2 sign-off)

Live run against a vanilla 1.21.4 Prism world (Open to LAN, cheats on),
headless Claude Code with devrig-craft as the only MCP server. Prompt:
"build a small house with a door and torches next to me, verify
block-by-block", steered to the command path and chat narration.

- **Tool calls: 8** (1 list_worlds, 1 join_world, 1 list_bots,
  2 fetch_resource, 3 execute_code)
- **Wall time: 52 s** prompt→VERIFIED (model: sonnet)
- **Output tokens: 3193**; cost $0.27
- Result: 6×5×6 stone-brick house, oak door, interior + entrance
  torches, blockAt sweep VERIFIED, full narration in game chat.
- Lessons folded back already: `bot.creative.flyTo` hangs on LAN hosts
  (navigation recipe warns), a slow/reasoning-heavy model makes the
  in-game pauses painful — use a fast model for live demos, and steer
  the prompt to /fill//setblock for bulk.
- Still open for M3: run the same task against a narrow-tools Minecraft
  MCP for the side-by-side table (expect ~100 calls for the platform
  alone).

## Blocked on other tracks

- ~~CI: add `npm run test:pack` to the `unit` job~~ — restored with Task 10.
- ~~Recipe fetch happy-path test~~ — landed with PR #14.
- **Validate the recipe placement idioms against a live server** during Task 12
  (issue #11). The fence contract proves they type-check against mineflayer's
  declarations, not that creative slot 36, `new Item(id, count)` and the reach
  handling behave as written.

## Plan and doc defects found

- `docs/plans/2026-08-27-devrig-craft-m1.md` Task 9 claims `"types": []` keeps
  Node globals out of the fence typecheck, so `require`/`setTimeout` "fail to
  compile". They do not: `mineflayer/index.d.ts` starts with
  `/// <reference types="node" />`, and an explicit reference beats the `types`
  option. `test/recipes.test.ts` enforces that half of the contract with an
  out-of-scope token test instead.
- Same task's PRELUDE omits `mineflayer-pathfinder`, whose `index.d.ts`
  augments `Bot` with `pathfinder`. Without that type import, every fence using
  `bot.pathfinder` — which the task's own content requirements demand — fails
  to compile.
- Task 5's `pingWorld` snippet does not type-check: `mc.ping`'s callback is
  typed `(error: Error, result: OldPingResult | NewPingResult) => void`, so the
  `RawPing` callback parameter is rejected. Implemented by resolving the
  library's own union and narrowing after.
- Task 4 redefines `PingResult`/`DiscoveredWorld`/`LanSource`/`PingSource` in
  `src/discovery/snapshot.ts`, but they already ship frozen in
  `src/discovery/types.ts` (shared with the server track). `snapshot.ts`
  imports and re-exports them instead of duplicating the shapes.
- The merged PR #2 description mentions `docs/plan-defects.md` and
  `docs/plan-review.md`; only `docs/m1-plan-review.md` shipped. Harmless (PR
  text is immutable history), noted so nobody hunts for the other two files.
- The M2 README task (M2 plan Task 3) has no GitHub issue yet — file one when
  M1 gates.

## Known gaps in what shipped

- `pingWorld` only maps the modern (`NewPingResult`) ping shape; a legacy
  pre-1.7 server answering with `OldPingResult` yields `null`, i.e. an
  unreachable world. Out of the supported range (1.18–1.21) anyway, but the
  reason is the mapping, not the range check.
- `resources/recipes/skill/building.md` is 153 lines against the plan's 40–120
  guidance; the extra length is the reach-handling loop and the verification
  sweep, both required by the task's content list.

## Open after the 2026-08-29 recipe repair

- **The whole house recipe has never run end to end.** Step 1 → 2a → 2b → 3
  against a live LAN world is the only thing that can confirm the repair
  (per-column stand spots, self-clearing lot, tally/errors/stalls reporting).
  run12 was the only run after the roof rewrite and it was cut off in Step 2a.
- **Phase timing is still a guess.** `timeout: 420` per build fence was picked
  after run10/run11 timed out at 480 s; nobody has measured ms/block. The first
  full run should be used to size the phases from data — and to decide whether
  the "one call builds a house" pitch survives a 2a+2b split.
- **`craft_execute_feedback` is blocked by the permission layer** in the demo
  configuration (observed in run11), so the agent's self-rating channel is dark.
  Allow it in the demo profile.
- **`ensureMobile()` teleports on camera.** Two `/tp` chat commands in the first
  seconds of a promo about moving like a human, and they silently do nothing
  when cheats are off (only a `print` WARNING). Decide: dig out instead, or
  state the teleport as a one-off recovery in chat.
- **`bot._client` is reachable from the sandbox** (run1 wrote raw position
  packets to escape birch leaves, bypassing mineflayer physics). If raw packets
  are out of bounds, the enforcement point is the runtime, the way the placement
  contract does it — not a sentence in a recipe.

## 2026-08-29 — first end-to-end run of the repaired recipe

Fresh bot, clean natural lot at `(-49, -61, 4)`, Step 1 → 2a → 2b.

**Step 2a: completed in 220s, 104 blocks.** Against the same phase before
today's work (334s, 83 blocks, dozens of refusals):

- foundation + floor **42/42 in 40s**, plinth 22/22, floor 20/20
- walls 60/64, bed / chest / crafting table all placed
- `stalls: 0`, **one** error in the whole run, **zero scaffolding indoors**
- no `could not gain height` at all — the failure that dominated every earlier
  run is gone

**Step 2b: still times out at 420s.** It reached attic deck 35/42, three
columns of the north slope, 0/14 eaves, and — because the kill came before the
cleanup phase — left 9 scaffolding blocks indoors.

Cause, from the shape of the run rather than a log (the output was lost with
the timeout, again): `flyClear` climbs to `cruiseY = y0 + 10` and back down for
**every single hop**, three legs each. That is ~20 blocks of vertical travel
per block placed, at ~7 blocks/s. The up-and-over route is only needed when the
direct line is actually blocked — try the straight hop first, and reserve the
climb for when it fails. That one change should cut the phase severalfold.

Also still true, and now the main obstacle to diagnosing any of this:

- **A timed-out script loses every line it printed.** Third occurrence today.
  Until fences carry an internal deadline (or the runtime flushes captured
  output on kill), a run that fails teaches nothing and has to be re-derived
  from the world state instead.


## 2026-08-29 late — flight now works, and the copies can no longer drift

**Flight is flown, not teleported.** `bot.creative.flyTo` was never flight: it
walks the entity POSITION along a straight line in 0.5-block steps with no
collision check (its own source: "straight line, so make sure there's a clear
path") and ends on `once(bot, 'move', 0)`, which has no timeout. Aimed through
a wall the server snaps the position back and the call never returns —
measured, six seconds with the bot not having moved one block.

Replaced with ordinary motion, which the server accepts. Measured live:
`forward` + look moves a weightless bot at 2.97 blocks/s; holding `velocity.y`
on each physics tick climbs at 7 blocks/s; `jump` and `sneak` do exactly
nothing (0.00) because a jump needs `onGround` and a flying bot never is.
`flyLeg()` steers with the controls and climbs by holding velocity;
`flyClear()` routes up-over-down so real collisions are avoided. Verified on
the hop the teleport could not make: **arrived in 2755ms, 0.75 from the goal,
top course laid from the air, zero scaffolding built, landed in 453ms with
gravity intact, no errors.** The nerd-pole stays as the survival path, and
flight falls back to it.

**Divergence between the helper copies is now impossible.** design.md:112 bans
a wrapper layer, so both build fences necessarily carry the same helpers; a
test now pins ten of them byte-identical across Step 2a and Step 2b, and pins
`humanlike.md`'s `seesFace` to the house copy modulo comments. Divergence is
the defect that actually hurt — one placement in five was doomed — not the
duplication itself.

Still open:

- **A timed-out script loses everything it printed.** Two 420s timeouts
  returned no output at all. Fences need an internal deadline shorter than the
  tool timeout; better, the runtime should flush captured output on kill.
- **A freshly joined bot was once already hovering** (`gravity=0`,
  `onGround=false` straight after join); the pathfinder cannot route a floating
  bot — 21 cancelled goals, 0 blocks in 160s. Root cause not established.
  `land()` repairs gravity defensively, but the spawn state is unexplained.
- **The repaired recipe has not been run end to end.** Every fix is covered by
  tests and each changed mechanism was verified live, but no single run has
  taken Step 1 → 2a → 2b → 3 on a clean lot since.


The user's call, and it is the right shape: in creative a player flies to the
work instead of towering up, and even in survival you pillar ONCE and then
chain block against block. Pillaring under every cell is what filled the living
room with thirteen planks the cleanup could not remove.

Implemented (all test-covered, 106 passing) but **not verified in the world**:
`canFly` from `bot.game.gameMode`, `flyClear()` routing up-across-down, flight
reused for movement while airborne, the nerd-pole kept as the survival path,
and — after live failures — flight demoted to an optimisation that falls back
to the pillar when it does not arrive.

**Why flight does not work yet, measured:**

- `bot.creative.flyTo` is not flight. It walks `bot.entity.position` along a
  straight line in 0.5-block steps **with no collision check** (its own source
  says "straight line, so make sure there's a clear path") and finishes on
  `once(bot, 'move', 0)` — **no timeout**. Aimed through a wall the server
  snaps the position back, the loop never converges: measured, six seconds
  elapsed with the bot not having moved one block. Routing up-and-over fixed
  the geometry but not the underlying fragility.
- **A freshly joined bot was already hovering**: `gravity=0`, `onGround=false`,
  straight after `craft_join_world`. The pathfinder cannot route a floating
  bot — 21 cancelled goals and 0 blocks placed in 160s. Whether this is state
  leaking between bots in the shared server process (`Physics(bot.registry,
  world)` is constructed per bot, but prismarine may memoise on the registry)
  or the server granting flight abilities in creative is **not yet
  established**. This is the next thing to find out; everything else about
  flight is downstream of it.
- The proper fix is probably not `flyTo` at all but real flight: keep gravity 0
  and move with control states the way a player does, so the server is never
  fighting a teleported position.

**Also found and not yet fixed:**

- **A timed-out script loses everything it printed.** Two 420s timeouts
  returned no output at all — not one `print`. A run that fails teaches
  nothing, which is why three separate attempts here had to be re-derived from
  scratch. Fences should carry an internal deadline shorter than the tool
  timeout and print their tally before the harness kills them; better still,
  the runtime should flush captured output on timeout.
- The two build fences still duplicate their whole helper prelude, and
  `humanlike.md` carries a third copy of the sight test. Every fix in this
  file had to be applied two or three times, and the `seesFace` divergence was
  exactly what a drifting copy does.


## 2026-08-29 evening — the gravity defect, and what the roof phase exposed

**Root cause of every "cannot gain height" failure, found in the live world:**
mineflayer's creative plugin restores gravity from a value only `startFlying()`
ever saves, so `stopFlying()` on a bot that never flew assigns `null`. Gravity
null is permanent: the bot stops falling, `entity.onGround` never becomes true
again, and prismarine-physics only applies a jump while on ground — so every
jump silently does nothing. The recipe called `stopFlying()` defensively at the
top of each fence AND inside every `walkTo`, so the first walk of a session
disabled climbing for the rest of it. Measured: `physicsTick` firing at 21/s,
the jump control held `111111111` across ticks, rise `0.00` for twelve ticks;
after restoring gravity, a textbook arc `0.42 / 0.75 / 1.00 / 1.17 / 1.25`.

Fixed: `src/runtime/gravityGuard.ts` (+5 tests, the first of which reproduces
the upstream defect), wired into `mineflayerFactory` on `spawn`; all five
unconditional `stopFlying()` calls removed from `house.md`. The nerd-pole now
waits for the measured rise instead of a flat `sleep(150)`, which landed
exactly on the 1.00 threshold.

**Still open, all observed while finishing the house by hand:**

- **`walkTo`'s straight-line fallback demolishes the house.** When the
  pathfinder times out, the shove's stuck-watchdog digs whatever is in front of
  it — which, inside a finished shell, is the wall. One roof run with three
  `walk to …: timeout` entries left **22 wall blocks destroyed**. The watchdog
  must never dig a block that the design wants, and probably should not dig at
  all above the ground course.
- **The scaffolding cleanup digs each pillar while standing on it.** Step 2b
  does `walkTo(p.x, p.y - y0 + 1, p.z)` — i.e. onto the pillar's top — then
  `bot.dig(p)`. The contract refuses every one of them ("no line of sight …
  1.1 away"), so the pillars stay standing in the living room. Same defect
  class as the floor: you cannot act on the block you are standing on. Reuse
  `standBeside`.
- **Placing into your own cell is still not guarded everywhere.** `put()` has
  the check; the roof/deck loops reach cells via `GoalNear(…, 1)`, whose radius
  is enough to set the bot down in the target cell. The server then drops the
  placement in silence and mineflayer reports
  `Event blockUpdate did not fire within 5000ms`. That message means "you were
  standing in it" far more often than it means anything else.
- **`bot.placeBlock` cannot seat a bed on 1.21.4.** Refused from four different
  positions and facings, always as a silent no-op. Two-cell blocks need either
  a different packet path or `/setblock`; the recipe currently pretends
  `placeBlock` works and reports `bed refused`.
- **13 cells of a finished house were unreachable on foot** (deck edges, eaves,
  ridge cells above the bot's own roof). Finishing them needed `/setblock`.
  Either the roof phase needs a real walkway plan, or the recipe should say
  plainly which cells it expects to command-place.
- **Phase 2b took 409 s** and still left the roof ragged; 2a took 334 s. Both
  are at the edge of `timeout: 420`.


## 2026-08-29 — repaired against the live world, not the logs

Everything below was found by joining the world and measuring, after two rounds
of log-reading produced the wrong diagnosis. **Read this before trusting a
theory built from a transcript.**

Confirmed by measurement, fixed, and re-verified live:

1. **`replaceGround` dug the floor out from under its own feet.** `digAt` ran
   first; the bot fell one block into the very cell it had to fill, and a block
   cannot be placed into the cell you occupy. The guard was written but sat
   AFTER the dig and compared `pos` against `feet - 1`, which is already false
   once you have fallen — so it never fired in the case it was written for.
   This is why a run laid four planks and moved on. Fixed by `standBeside()`,
   called from inside `digAt` before the block is broken.
2. **Reach is not sight, and the DIG test differs from the PLACE test.** The
   runtime rays at the block's CENTRE for a dig; for a floor cell that ray dips
   under the surface and hits the soil you stand on. Seven of twenty floor
   cells were refused at 2.3-3.6 away, well inside the 4.5 reach. `standBeside`
   now requires `seesBlockCentre` too.
3. **The recipe's `seesFace` was strictly looser than the runtime's
   `canSeeFace`.** The runtime additionally requires the ray to ENTER through
   the clicked face; the recipe stopped at "the ray reached the right block".
   Measured live: 12 of 80 face tests disagreed, never in the other direction,
   and 1 in 5 of everything `chooseFace` picked was doomed before it was sent.
   The classic case is clicking the side of the block you are standing on.
   Both copies (house.md, humanlike.md) now carry the entry-face check.
4. **`put`/`replaceGround` gave up after one face.** `chooseFaces` now returns
   every usable face nearest-first and the caller tries them in order; 2 of
   every 10 refused picks had a face that would have landed.
5. **`GoalNear(…, 1)` can set the bot down ON the cell it must dig.**
   `standBeside` takes the last step with an exact `GoalBlock`.

Measured result on a fresh lot, full 7x6 house footprint:
`42/42 planks placed, 41.1s, 0.98s per block, zero refusals` — against 4 planks
in the demo run of the same day.

**Timing data for the phase-timeout question:** ~1.0 s per placed block, walking
included. The full house is ~170 blocks, so a single build fence needs ~3 min of
pure placement; `timeout: 420` is about right for 2a but leaves little headroom
if walking degrades.

Still open:

- **The height repair is unverified.** Items 1-5 fixed the foundation, which is
  where every run died, so `raiseTo`/`standWhereVisible`/`standDyFor` have still
  never been exercised against a real wall. First full run must check them.
- **`note()` truncates the contract's refusal at 140 chars**, cutting off the
  "Faces of that block clickable right now: …" hint that `sightRefusal` exists
  to provide. Raise the cap.
- **`stalls` misses pathfinder timeouts** — incremented only in the fallback.
- **`house.md` contradicts itself about re-running** (lines 31-33 vs 39-40).
- **Step 2a is a 431-line fence the agent must retype**: ~80 s of emission per
  call, and one attempt died with `API Error: The response stopped arriving`.
- **The two fences keep duplicating their helper prelude.** Item 3 is exactly
  what a copy does when it drifts. The duplication is now three-way
  (house.md x2 + humanlike.md); a fourth divergence is a matter of time.
- **Test debris in the user's world**: partial floors at (-24,-61,-36) and
  (-30,-61,-30), a complete one at (-36,-61,-24), plus the wrecked demo lot
  around (-19..-13, -61, -33..-29).

## Open after the 2026-08-29 height repair

Fixed today (run of 14:52 UTC, `8337da06`, placed 8 blocks in 2m50s):
`raiseTo` is now reached from the placement path — `standWhereVisible` keeps
airborne perches and pillars up to them, the wall/pane/torch loops stand level
with the course they lay (`standDyFor`), `raiseTo` walks to the column *below*
an above-head goal instead of handing the pathfinder a mid-air goal, and a
height failure now says "target is above me" instead of the generic "no face".

Still open, all observed in the same run:

- **`seesFace` in the recipe and `canSeeFace` in the runtime have diverged.**
  The runtime additionally requires the ray to enter through the clicked face
  (`hit.intersect` vs the face plane, `mineflayerFactory.ts:110-115`); the
  recipe copy stops at "the ray hit the right block". So `chooseFace` hands
  `placeBlock` a face the contract then refuses — measured: it picked the `-x`
  side face of a ground block while standing above it, and the contract
  rejected it. `put()` gives up after that one pick, where the pre-`chooseFace`
  version tried all six faces and one landed. **This is a net regression and is
  the largest remaining cause of "placement did not land" (33 in one run).**
  Fix by making the two impossible to diverge, not by re-copying the code.
- **`note()` truncates the contract's refusal at 140 chars**, which cuts off
  exactly the part `sightRefusal` exists to provide: "Faces of that block
  clickable right now: top". Full message is 215 chars. Raise the cap.
- **`stalls` misses pathfinder timeouts.** It is incremented only in the
  straight-line fallback, so a run with 15 `walk to …: timeout` entries still
  reports `stalls: 0`.
- **`house.md` contradicts itself about re-running.** Line 31-33 says the
  fences are idempotent and to re-run them; line 39-40 says never re-send one
  unchanged. The 14:59 run re-sent Step 2a byte-for-byte after a failure whose
  cause was deterministic geometry.
- **Step 2a is a 431-line fence the agent must retype verbatim.** Measured cost:
  ~80 s of emission per call, and one 3.5-minute attempt that died with
  `API Error: The response stopped arriving`. The "one call builds a house"
  pitch and the model's output budget are in direct conflict; splitting the
  fence is the obvious lever and needs the plan author's call.
