# TODO

Follow-ups found while implementing the M1 discovery, recipe and CI tasks.

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
