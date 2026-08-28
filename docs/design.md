# devrig-craft — Minecraft mirror of MCP Steroid (promo product)

Status: approved · 2026-08-27, amended 2026-08-28 after plan review (PR #2)
Owner repo: this repository (`devrig-craft`)
Marketing: reuses the **devrig** brand ("devrig plays Minecraft — same
philosophy, different host").

## 1. Goal

A promo product that demonstrates the MCP Steroid design philosophy
(narrow MCP tool surface, power in one code-execution tool + recipe
corpus, stateless CLI with instance discovery) in a domain everyone
understands: Minecraft.

**End-to-end target scenario:** the user opens a singleplayer world in
any launcher (e.g. Prism Launcher), presses *Open to LAN*, starts
Claude Code, and says "build me a house". Claude discovers the running
world on its own, joins it as a bot, and builds the house — visible
live, first-person, in the user's own client.

**Promo punchline:** the popular Minecraft MCP servers expose dozens of
narrow tools (`move-to`, `dig-block`, `place-block`, ...). devrig-craft
exposes ~8 tools mirroring `steroid_*`, and one of them executes code
against the full bot API. A 10×10 platform is ~100 tool calls on the
narrow-tool server and 1 script here. Measured DPAIA-arena-style
(tool calls / tokens / wall time) for a credible side-by-side.

All demo content (world names, chat, recipes, README) is English.

## 2. Non-goals

- Not a general-purpose Minecraft automation product; it is a promo
  artifact with a working core.
- No client or server mods; no modification of the user's Minecraft
  installation or Prism instances. (A Kotlin in-host mod is the
  possible phase-2 "pure mirror" — out of scope here.)
- No support for online-mode (authenticated) public servers in v1.
  LAN worlds + offline-mode local servers only.
- No persistent state in the CLI (Tenet 3 transfers verbatim).
- **Not a security sandbox.** The code `craft_execute_code` runs is
  authored by the agent the operator launched against their own local
  world. The `vm` context is an execution convenience, not a trust
  boundary (`process` is reachable from it, by Node design). This is
  documented, not defended against.

## 3. Architecture

```
Claude Code ──stdio──> devrig-craft CLI (stateless; discovery + routing)
                          │ spawns/owns
                          ▼
                     bot runtime (Node process, mineflayer)
                          │ minecraft protocol
                          ▼
              running world: Prism/vanilla client "Open to LAN",
              or a local offline-mode server
```

Two components, mirroring devrig ↔ ij-plugin:

- **CLI (`devrig-craft`)** — Node/TypeScript stdio MCP server.
  Stateless across invocations; every MCP call selects its target from
  the current discovery snapshot. In-memory caches die with the
  process.
- **Bot runtime** — in-process (same Node process as the CLI for v1;
  one bot per joined world). Hosts the mineflayer bot instance and the
  `craft_execute_code` sandbox.

Stack: TypeScript / Node 22+, mineflayer + mineflayer-pathfinder,
minecraft-protocol (discovery/ping), prismarine-viewer (screenshots,
best-effort, M2), @modelcontextprotocol/sdk (stdio server). Distributed
via `npx devrig-craft` (zero-install for the demo); the packed-tarball
path is exercised by a `npm pack` smoke check.

## 4. Discovery (the devrig-scanner mirror)

Two sources, both rebuilt on demand per call (no background daemons in
v1 — mirrors the on-demand `rebuildSnapshot()` decision):

1. **LAN multicast**: listen on UDP `224.0.2.60:4445` for the
   `[MOTD]name[/MOTD][AD]port[/AD]` announcements a client emits after
   *Open to LAN*. Collect for ~1.8 s per list call (announcements
   repeat every 1.5 s).
2. **Local port ping**: Server List Ping against `localhost:25565`
   plus user-configured ports (repeatable `--port` flag and a
   `DEVRIG_CRAFT_PORTS` env fallback — MCP clients often control only
   the command line but can pass environment). Ping yields version,
   MOTD, and player count; pings run in parallel. For `source:
   'server'` entries the MOTD is the display name.

Each discovered world gets a stable slug (`world_name`) — the routing
key, exactly like `project_name` in devrig. **Stability rule:**
announcements are sorted deterministically (host, then port) before
slug allocation, so dedup suffixes do not depend on UDP arrival order;
join responses echo the resolved `host:port` so a swap between
snapshots is visible to the caller. Version compatibility is computed
against mineflayer's supported range and reported in the listing
(mirrors backend-compat reporting).

LAN worlds do not authenticate against Mojang session servers, so the
bot joins with a configurable username (default `devrig`) and no
Microsoft account.

## 5. MCP tool surface (8 tools, 1:1 mirror)

| devrig-craft | mirrors | contract |
|---|---|---|
| `craft_list_worlds` | `steroid_list_projects` | Discovered worlds: `world_name` (routing key), display name, host, port, source (lan/server), version, player count, compat flag |
| `craft_list_bots` | `steroid_list_windows` | Live bots: world, spawn state, position, health/food, readiness (mirrors modal/indexing readiness fields) |
| `craft_join_world` | `steroid_open_project` | Async: initiates join, returns quickly (echoing resolved host:port); caller polls `craft_list_bots` until ready. Joins time out after 60 s into an error state. Params: `world_name`, optional `username` |
| `craft_execute_code` | `steroid_execute_code` | THE tool. JS (async function body) with `bot` + scope in scope; response is `execution_id: <uuid>` on the first line, then only what the script prints. Params: `world_name`, `code` (≤100 KB), `task_id`, `reason`, `timeout` seconds (1–600, default 120) |
| `craft_fetch_resource` | `steroid_fetch_resource` | Serves `mcp-craft://` recipe articles by URI |
| `craft_take_screenshot` | `steroid_take_screenshot` | HEAVY ENDPOINT, debugging only. **Ships as the tested error branch only** ("unavailable — verify via bot.blockAt sweeps") — see the §13 descope decision; a future success path would return an MCP image payload (`type: 'image'`, base64), not a file path |
| `craft_chat` | `steroid_input` | HEAVY/debug: raw chat or slash-command. Description steers agents to `craft_execute_code` (`bot.chat(...)`) instead |
| `craft_execute_feedback` | `steroid_execute_feedback` | Same rating contract; requires an `execution_id` previously returned by `craft_execute_code` (unknown ids are rejected); appends JSONL to a local file and returns its path |

Tool descriptions copy the steroid house style: `task_id` + `reason`
audit params on heavy tools (logged with the execution), "prefer
execute_code" steering on `craft_chat` and `craft_take_screenshot`.

JSON responses use snake_case keys (`world_name`, `display_name`, …) —
the same convention as the tool parameters; camelCase stays internal to
the TypeScript code and is converted once at the MCP boundary.

Executions are serialized per world: a `craft_execute_code` or
`craft_chat` call against a world whose bot is already running a script
returns an explicit "bot busy" error (the model can act on a stated
reason; it cannot act on an unexplained queue delay).

## 6. `craft_execute_code` runtime

- Script = body of `async (ctx) => {}`; top-level `await` works.
- In scope, exactly: `bot` (full mineflayer API incl. pathfinder plugin
  loaded), `Vec3`, `mcData` (minecraft-data for the world's version),
  `goals` and `Movements` (mineflayer-pathfinder's own classes), `Item`
  (prismarine-item bound to the world's version), and the helpers
  `print(...)`, `printJson(...)`, `sleep(ms)`, `waitFor(event,
  timeoutMs)`. Nothing else — no `require`, no dynamic `import`, no
  Node globals. Injecting the libraries' own entry-point classes is not
  a wrapper layer (the ban is on agent-friendly abstractions, not on
  exposing native APIs — the same way steroid loads the full plugin
  classpath); recipes teach the native mineflayer idioms against them.
- Sandbox: Node `vm` context; per-call timeout (default 120 s, max
  600 s). `printJson(undefined)` prints the string `undefined` rather
  than silently emptying the response. Output is capped (~2000 lines /
  256 KB) with middle truncation that keeps the tail — verification
  output lives at the end.
- Errors return message + stack + the failing script line, with line
  numbers matching what the model wrote (the wrapper offset is
  compensated).
- **Runaway scripts:** a script that exceeds its timeout is reported as
  timed out and the bot is forcibly disconnected (`bot.end()`) so the
  world stops mutating; the agent rejoins with `craft_join_world`. A
  synchronous infinite loop (`while(true)`) cannot be interrupted
  in-process and hangs the server — documented limitation (restart
  devrig-craft); recipes never contain synchronous unbounded loops.
- Output is the only feedback channel: verification recipes teach
  `bot.blockAt(...)` sweeps ("assert the wall exists") — verify via
  API, not pixels; screenshots are for the human/final reveal.

## 7. Recipe corpus (`mcp-craft://`)

Markdown articles with copy-paste JS blocks, mirroring
`prompts/src/main/prompts/` structure. Every ```js fence must
type-check as a `craft_execute_code` body: a contract test compiles
each fence with `tsc --noEmit` against a prelude declaring exactly the
sandbox scope (so a `require`, an undeclared name, or a wrong API
fails in CI, not on stage).

M1 set (4 articles):

- `mcp-craft://prompt/skill` — index + philosophy note
- `.../skill/building` — placement loops, scaffolding, facing/reach
  constraints, door/torch idioms; house happy-path end-to-end
- `.../skill/building-with-commands` — `/fill`, `/setblock`, `/give`
  when cheats are available; how to detect op/creative
- `.../skill/world-queries` — blockAt sweeps, findBlocks, entity
  queries; the verification pattern

M2 adds:

- `.../skill/navigation` — pathfinder goals, following, stuck recovery
- `.../skill/inventory` — creative-mode item acquisition, survival
  crafting basics
- `.../skill/survival` — food/mobs/night basics (keeps demos alive)
- `.../skill/design-philosophy` — the tenets, mapped, linking back to
  devrig/mcp-steroid (the marketing payload)

## 8. Build modes

Two documented modes; the agent chooses via recipes, not via tools:

1. **Legit mode** (default for video): creative gamemode, bot flies and
   places real blocks one by one from a script loop. Photogenic.
2. **Fast mode**: cheats enabled → `/fill`-based construction. Instant;
   used when the user asks for something big.

Prereqs surfaced to the user in the join result (e.g. "world has
cheats off — legit survival mode only; give the bot blocks or enable
cheats").

## 9. Testing & CI

- Unit: discovery parsers (multicast payloads AND ping responses,
  including partial/malformed ones), slug rules, sandbox contract
  (timeout, print capture, output caps, error shape), bot lifecycle
  (join timeout, rejoin cleanup, busy lock).
- Integration: dockerized offline-mode vanilla server (itzg/minecraft-
  server image) → join → execute_code builds via `/setblock` AND
  places at least one block physically via `bot.placeBlock` →
  blockAt-verify both. The physical-placement path is the product's
  main risk and is exercised here, not first on camera.
- Packaging: `npm pack` smoke — the tarball carries `resources/` and
  its bin answers `--version` via `npx` (the quickstart path).
- CI (GitHub Actions): a `unit` job (typecheck + unit tests + pack
  smoke) on every push/PR; an `integration` job (Docker) on manual
  dispatch and a weekly schedule — integration is not paid per-PR.
- Manual/demo: Prism + Open to LAN happy path (documented script, not
  CI); a real captured LAN datagram joins the parser fixtures during
  this validation (M2).
- Arena-style comparison harness (promo phase): same task on
  narrow-tool MCP vs devrig-craft; capture tool calls/tokens/time.

## 10. Promo deliverables

1. Public repo `devrig-craft` with README that maps each tenet to
   Minecraft and links to devrig.dev / mcp-steroid.
2. Side-by-side video (2–3 min): narrow-tools MCP vs devrig-craft,
   split screen with live tool-call/token counters; end card →
   devrig.dev.
3. Blog post / website page with the measured table.

## 11. Milestones

- **M1 (core, ~1 week):** CLI + discovery + join + execute_code +
  4 recipes + CI + dockerized smoke. **Gate:** `npm test` green and
  the Docker smoke passing on a clean machine.
- **M2 (demo polish, ~1 week):** Prism/LAN path hardened (manual
  checklist executed, captured-datagram fixture added), remaining
  4 recipes, screenshot success path (image payload), README.
- **M3 (promo):** comparison harness + video + post.

## 12. Risks

- **Protocol version lag**: mineflayer trails new Minecraft releases.
  Mitigation: pin supported range, report compat in listings, demo on
  a pinned version.
- **headless screenshots flaky** (headless-gl): materialized — descoped
  entirely (§13); the core loop never depended on it.
- **Placement physics edge cases** (reach, facing, collisions): the
  building recipe encodes known-good idioms; verification sweeps catch
  silent failures; the Docker smoke exercises one physical placement.
- **LAN announce quirks across launchers/versions**: parser tested on
  synthetic payloads in M1, plus a captured real datagram in M2;
  port-ping path is the fallback.
- **Synchronous runaway scripts hang the process** — accepted,
  documented limitation (see §6); the operator restarts devrig-craft.

## 13. Decisions log

- Separate repo: yes (2026-08-27).
- Branding: devrig reused in marketing; repo/CLI `devrig-craft`;
  tools `craft_*` (2026-08-27).
- Plan review PR #2 (2026-08-28): 24 of 27 findings accepted (see
  `docs/m1-plan-review.md`); rejected/trimmed: worker-based script
  isolation (documented limitation instead — promo product, operator
  is the code author), M1 screenshot success path (moved to M2, error
  branch only in M1), mandatory decision tables in tool descriptions
  (no arena data to justify them yet). Non-Latin slug support stays
  dismissed: the demo is English-only.
- Screenshot success path descoped permanently (2026-08-28, M2 Task 2):
  `prismarine-viewer@1.33.0` has no single-frame API (its `headless()`
  streams JPEG to ffmpeg) and its render stack requires
  `node-canvas-webgl`/headless-gl, whose native build fails on the dev
  machine (arm64 node-gyp) and is the classic flake on Linux CI. The
  tool ships its tested guidance-error branch only; verification is
  `bot.blockAt` sweeps and the human watches first-person. Revisit only
  if a demo genuinely needs agent-side vision.
