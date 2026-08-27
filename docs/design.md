# devrig-craft — Minecraft mirror of MCP Steroid (promo product)

Status: draft for review · 2026-08-27
Owner repo: NEW separate public repository (working name: `devrig-craft`)
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

## 2. Non-goals

- Not a general-purpose Minecraft automation product; it is a promo
  artifact with a working core.
- No client or server mods; no modification of the user's Minecraft
  installation or Prism instances. (A Kotlin in-host mod is the
  possible phase-2 "pure mirror" — out of scope here.)
- No support for online-mode (authenticated) public servers in v1.
  LAN worlds + offline-mode local servers only.
- No persistent state in the CLI (Tenet 3 transfers verbatim).

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
best-effort), @modelcontextprotocol/sdk (stdio server). Distributed via
`npx devrig-craft` (zero-install for the demo).

## 4. Discovery (the devrig-scanner mirror)

Two sources, both rebuilt on demand per call (no background daemons in
v1 — mirrors the on-demand `rebuildSnapshot()` decision):

1. **LAN multicast**: listen on UDP `224.0.2.60:4445` for the
   `[MOTD]name[/MOTD][AD]port[/AD]` announcements a client emits after
   *Open to LAN*. Collect for ~1.5 s per list call (announcements
   repeat every 1.5 s).
2. **Local port ping**: Server List Ping against `localhost:25565`
   (+ optional user-configured ports) — yields version, MOTD, player
   count for dedicated/offline servers.

Each discovered world gets a stable slug (`world_name`) — the routing
key, exactly like `project_name` in devrig. Version compatibility is
computed against mineflayer's supported range and reported in the
listing (mirrors backend-compat reporting).

LAN worlds do not authenticate against Mojang session servers, so the
bot joins with a configurable username (default `devrig`) and no
Microsoft account.

## 5. MCP tool surface (8 tools, 1:1 mirror)

| devrig-craft | mirrors | contract |
|---|---|---|
| `craft_list_worlds` | `steroid_list_projects` | Discovered worlds: `world_name` (routing key), display name, version, port, source (lan/server), compat flag |
| `craft_list_bots` | `steroid_list_windows` | Live bots: world, spawn state, position, health/food, readiness (mirrors modal/indexing readiness fields) |
| `craft_join_world` | `steroid_open_project` | Async: initiates join, returns quickly; caller polls `craft_list_bots` until ready. Params: `world_name`, optional `username` |
| `craft_execute_code` | `steroid_execute_code` | THE tool. JS (async function body) with `bot` + helpers in scope; response contains only what the script prints. Params: `world_name`, `code`, `task_id`, `reason`, `timeout` |
| `craft_fetch_resource` | `steroid_fetch_resource` | Serves `mcp-craft://` recipe articles by URI |
| `craft_take_screenshot` | `steroid_take_screenshot` | HEAVY ENDPOINT, debugging only. Renders bot POV via prismarine-viewer headless; best-effort (degrades to a clear error if headless-gl unavailable) |
| `craft_chat` | `steroid_input` | HEAVY/debug: raw chat or slash-command. Description steers agents to `craft_execute_code` (`bot.chat(...)`) instead |
| `craft_execute_feedback` | `steroid_execute_feedback` | Same rating contract; logs locally |

Tool descriptions copy the steroid house style: decision tables,
"prefer execute_code" steering, `task_id`/`reason` audit params.

## 6. `craft_execute_code` runtime

- Script = body of `async (ctx) => {}`; top-level `await` works.
- In scope: `bot` (full mineflayer API incl. pathfinder plugin loaded),
  `Vec3`, `mcData` (minecraft-data for the world's version), and a
  deliberately minimal context (Tenet 4): `print(...)`, `printJson(...)`,
  `sleep(ms)`, `waitFor(event, timeoutMs)`. Nothing else — recipes
  teach the native mineflayer idioms, no wrapper layer.
- Sandbox: Node `vm` context; per-call timeout (default 120 s); errors
  return message + stack + the line of script; a print-less successful
  run returns a HINT line (same UX as steroid).
- Output is the only feedback channel: verification recipes teach
  `bot.blockAt(...)` sweeps ("assert the wall exists") — verify via
  API, not pixels; screenshots are for the human/final reveal.

## 7. Recipe corpus (`mcp-craft://`)

Markdown articles with copy-paste JS blocks, mirroring
`prompts/src/main/prompts/` structure. v1 set (~8 articles):

- `mcp-craft://prompt/skill` — index + philosophy note
- `.../skill/navigation` — pathfinder goals, following, stuck recovery
- `.../skill/building` — placement loops, scaffolding, facing/reach
  constraints, door/torch idioms; house happy-path end-to-end
- `.../skill/building-with-commands` — `/fill`, `/setblock`, `/give`
  when cheats are available; how to detect op/creative
- `.../skill/inventory` — creative-mode item acquisition, survival
  crafting basics
- `.../skill/world-queries` — blockAt sweeps, findBlocks, entity
  queries; the verification pattern
- `.../skill/survival` — food/mobs/night basics (keeps demos alive)
- `.../skill/design-philosophy` — the tenets, mapped, linking back to
  devrig/mcp-steroid (the marketing payload)

JS fences get a compile/lint contract test (tsc/eslint over extracted
fences) — the KtBlocks idea at Node cost.

## 8. Build modes

Two documented modes; the agent chooses via recipes, not via tools:

1. **Legit mode** (default for video): creative gamemode, bot flies and
   places real blocks one by one from a script loop. Photogenic.
2. **Fast mode**: cheats enabled → `/fill`-based construction. Instant;
   used when the user asks for something big.

Prereqs surfaced to the user in the join result (e.g. "world has
cheats off — legit survival mode only; give the bot blocks or enable
cheats").

## 9. Testing

- Unit: discovery parser (multicast payloads, ping responses), slug
  rules, sandbox contract (timeout, print capture, error shape).
- Integration: dockerized offline-mode vanilla server (itzg/minecraft-
  server image) → join → execute_code builds a 3×3 platform →
  blockAt-verify. This is the CI smoke test.
- Manual/demo: Prism + Open to LAN happy path (documented script, not
  CI).
- Arena-style comparison harness (phase 2 of promo): same task on
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
  4 recipes; house happy path against dockerized server.
- **M2 (demo polish, ~1 week):** Prism/LAN path hardened, remaining
  recipes, screenshots best-effort, README/tenet mapping.
- **M3 (promo):** comparison harness + video + post.

## 12. Risks

- **Protocol version lag**: mineflayer trails new Minecraft releases.
  Mitigation: pin supported range, report compat in listings, demo on
  a pinned version.
- **headless screenshots flaky** (headless-gl): declared best-effort;
  core loop never depends on it.
- **Placement physics edge cases** (reach, facing, collisions): the
  building recipe encodes known-good idioms; verification sweeps catch
  silent failures.
- **LAN announce quirks across launchers/versions**: parser tested on
  captured payloads; port-ping path is the fallback.

## 13. Open questions (resolved)

- Separate repo: **yes** (decided 2026-08-27).
- Branding: **devrig reused in marketing**; repo/CLI working name
  `devrig-craft`; tools `craft_*`.
