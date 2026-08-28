# devrig-craft M2 Implementation Plan (demo polish)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** the M1 gate in `docs/plans/2026-08-27-devrig-craft-m1.md` has passed on a clean machine. M2 reuses M1's global constraints verbatim (tool count, scope, limits, snake_case wire, no runtime skip-detection).

**Goal:** Harden the Prism/LAN demo path and finish the promo-facing surface: the remaining 4 recipes, the screenshot success path (MCP image payload), the README, and the manual demo validation that produces the promo numbers.

**Spec:** `docs/design.md` §7 (M2 articles), §5 (screenshot image payload), §9 (captured datagram, manual demo), §10–11.

---

### Task 1: Remaining recipe articles

**Files:**
- Create: `resources/recipes/skill/navigation.md`, `resources/recipes/skill/inventory.md`, `resources/recipes/skill/survival.md`, `resources/recipes/skill/design-philosophy.md`
- Modify: `resources/recipes/prompt/skill.md` (extend the index), `test/recipes.test.ts` (article list grows to 8)

**Interfaces:**
- Consumes: the Task 9 (M1) fence contract — every new ```js fence must type-check against the same prelude; `goals`/`Movements` come from scope, never imports.

Content requirements (full articles, 40–120 lines, ≥1 complete ```js block except design-philosophy):

- `skill/navigation.md` — `bot.pathfinder.setMovements(new Movements(bot))`, `bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1))`, following a player entity, stuck recovery (goto with timeout + re-goal), flying repositioning in creative.
- `skill/inventory.md` — creative `setInventorySlot` with `mcData.itemsByName` + `Item`, survival `bot.craft` basics, counting items, equipping.
- `skill/survival.md` — health/food monitoring via `bot.health`/`bot.food`, eating, night/mob awareness — enough to keep an unattended demo bot alive.
- `skill/design-philosophy.md` — prose: the tenets mapped to Minecraft, the `craft_*` ↔ `steroid_*` table, links to devrig.dev and github.com/jonnyzzz/mcp-steroid. The marketing payload.

- [ ] Step 1: extend `test/recipes.test.ts`: expected article list becomes 8 entries; index test covers all 7 skill URIs. Run — FAIL.
- [ ] Step 2: write the 4 articles + extend the index. Run `npx vitest run test/recipes.test.ts` — PASS (typecheck contract holds automatically).
- [ ] Step 3: `npm test`, then commit: `git commit -m "Ship the remaining recipe articles: navigation, inventory, survival, philosophy"`.

---

### Task 2: Screenshot success path (image payload)

**Files:**
- Modify: `src/server.ts` (`craft_take_screenshot`), `package.json` (add `prismarine-viewer` to optionalDependencies), `test/server.test.ts`
- Create: `src/runtime/screenshot.ts`

**Interfaces:**
- Produces: `renderScreenshot(bot: BotLike, opts: { width: number; height: number }): Promise<Buffer>` — a single PNG frame of the bot POV.
- Tool contract (spec §5): success returns MCP image content `{ type: 'image', data: <base64>, mimeType: 'image/png' }` plus a text block naming the world and position; ANY failure (missing package, headless-gl init, render error) returns the M1 guidance error unchanged. The tool stays HEAVY/debug-steered.

- [ ] Step 1: `npm install prismarine-viewer` locally; **pin the real single-frame API by reading the installed package** (its headless entry point changed across versions — this is why M1 shipped without it). Record the pinned call in `src/runtime/screenshot.ts` with the package version in a comment.
- [ ] Step 2: unit test: the failure branch (mock `screenshot.ts` to throw) returns the guidance error, and the success branch (mock returning a 1×1 PNG buffer) yields `type: 'image'` content with valid base64. Run — FAIL, implement, PASS.
- [ ] Step 3: acceptance against Docker: extend `test-integration/smoke.test.ts` with a screenshot call; assert EITHER an image payload OR the guidance error (headless-gl availability is host-dependent; both outcomes are contract-compliant — what is banned is a crash or an empty response). If even the pinned API cannot render headlessly on Linux CI, descope: keep the error branch as the only branch, delete the success-path code, and record the decision in `docs/design.md` §13.
- [ ] Step 4: `npm test && npm run test:integration`, commit.

---

### Task 3: README

**Files:**
- Create: `README.md`

Required sections (promo-quality prose, English):

1. Hero: "devrig plays Minecraft" — the philosophy (narrow tool surface, one code-execution tool, recipes) applied to Minecraft; the 30-narrow-tools vs 8-tools-one-script comparison with the 10×10-platform tool-call count.
2. Quickstart: open a world → Esc → *Open to LAN* (enable cheats) → `claude mcp add --scope user devrig-craft -- npx devrig-craft` → "build me a house". (Note `--scope user`: the Claude CLI defaults to project-local registration.)
3. The 8 tools table (`craft_*` ↔ `steroid_*`, one line each).
4. How discovery works (UDP 4445 + Server List Ping; no mods, no launcher integration — Prism "just works"); `--port` / `DEVRIG_CRAFT_PORTS` for dedicated servers.
5. Limits & honesty: supported version range (`SUPPORTED_RANGE`), LAN/offline-only, screenshot caveat, the synchronous-loop limitation (spec §6), not-a-sandbox note (spec §2).
6. Links: devrig.dev, github.com/jonnyzzz/mcp-steroid, `docs/design.md`.

- [ ] Step 1: write it.
- [ ] Step 2: honesty check — run every command the README shows, verbatim, including the `npx` line against the packed tarball (`npm run test:pack` covers the mechanics; run the `claude mcp add` line on this machine for real).
- [ ] Step 3: commit.

---

### Task 4: Manual Prism/LAN validation (the M2 gate)

**Files:**
- Create: `docs/manual-demo.md`
- Modify: `test/lanParser.test.ts` (add the captured-datagram fixture)

The exact demo script, each step with its expected observation:

1. Launch a supported-version instance from Prism Launcher, create/open a singleplayer creative world (English name) with cheats ON.
2. Esc → *Open to LAN* → note the port announced in chat.
3. `node dist/cli.js worlds` → expect a JSON entry: `source: "lan"`, the same port, `compatible: true`, the world's name as `display_name`.
4. While step 3 runs, capture one real announcement datagram (`tcpdump -A -c 5 udp port 4445` or a 10-line dgram script) and **add its exact payload as a fixture** to `test/lanParser.test.ts` (spec §9 — synthetic fixtures stop being the only coverage).
5. `claude mcp add --scope user devrig-craft -- npx devrig-craft`.
6. In Claude Code: "Find my running Minecraft world and build a small house with a door and torches next to me. Verify it block-by-block when done."
7. Expected tool sequence: `craft_list_worlds` → `craft_join_world` → poll `craft_list_bots` → `craft_fetch_resource(building)` → `craft_execute_code` (1–3 calls) → verification sweep output.
8. In-game observation: the `devrig` bot appears, flies to a flat spot, places the house.
9. Record: total tool calls, tokens, wall time — the numbers for the promo table (M3 input).

- [ ] Step 1: write `docs/manual-demo.md` with the checklist above.
- [ ] Step 2: execute it once on this machine; file and fix what breaks (building-recipe idioms against a real client world are the expected trouble spot).
- [ ] Step 3: add the captured datagram fixture; `npm test`; commit.

---

## M2 acceptance gate

- All 8 recipes ship and their fences type-check.
- Screenshot tool: image payload on capable hosts, guidance error otherwise (or an explicitly descoped error-only branch recorded in the spec).
- README commands verified verbatim.
- The manual demo checklist has been executed end-to-end against a real Prism instance, with the captured-datagram fixture merged.

M3 (comparison harness, side-by-side video, blog post) gets its own plan once the M2 numbers exist.
