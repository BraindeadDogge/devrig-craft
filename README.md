# devrig plays Minecraft

**devrig-craft** is the [devrig](https://devrig.dev) philosophy pointed at a
different host. devrig gives AI agents a JetBrains IDE the honest way: a
handful of MCP tools, one of which executes real code against the IDE's full
API, taught by a corpus of recipe articles. devrig-craft does the same to a
running Minecraft world — and exists to make that design argument in a domain
everyone can *watch*.

The popular Minecraft MCP servers hand the agent dozens of narrow tools:
`move-to`, `dig-block`, `place-block`, `look-at`, `send-chat`. Building a
10×10 platform that way is ~100 tool round-trips, each one a chance to
mis-route. devrig-craft exposes **eight** tools mirroring `steroid_*`, and the
only one that matters — `craft_execute_code` — runs JavaScript against the
full [mineflayer](https://github.com/PrismarineJS/mineflayer) API. The same
platform is one script, and the agent verifies it block-by-block before
claiming success.

## Quickstart

1. Open a singleplayer world (any launcher — Prism Launcher included, no mods
   needed), press **Esc → Open to LAN**, enable cheats.
2. Build and register the MCP server with Claude Code — note `--scope user`;
   the Claude CLI defaults to project-local registration:

   ```
   git clone https://github.com/BraindeadDogge/devrig-craft
   cd devrig-craft && npm ci && npm run build
   claude mcp add --scope user devrig-craft -- node "$PWD/dist/cli.js"
   ```

   (Once the package is published to npm, this collapses to
   `claude mcp add --scope user devrig-craft -- npx devrig-craft`.)

3. In Claude Code, say: *"Find my running Minecraft world and build a small
   house with a door and torches next to me. Verify it block-by-block when
   done."*

You will see a bot named `devrig` join your world, fly to a flat spot near
you, and put the house up while you watch.

## The eight tools

| devrig-craft | mirrors (MCP Steroid) | one line |
|---|---|---|
| `craft_list_worlds` | `steroid_list_projects` | Discover joinable worlds; returns the `world_name` routing key |
| `craft_list_bots` | `steroid_list_windows` | Bot readiness, position, health — poll after joining |
| `craft_join_world` | `steroid_open_project` | Async join; times out into an error state after 60 s |
| `craft_execute_code` | `steroid_execute_code` | **The tool.** JS with `bot`, pathfinder, `Vec3`, `mcData`, `goals`, `Movements`, `Item` in scope; the response is only what the script prints |
| `craft_fetch_resource` | `steroid_fetch_resource` | `mcp-craft://` recipe articles — start at `mcp-craft://prompt/skill` |
| `craft_take_screenshot` | `steroid_take_screenshot` | Ships as a guidance error: verify via `bot.blockAt`, the human watches first-person |
| `craft_chat` | `steroid_input` | Debug-only raw chat; prefer `bot.chat(...)` inside a script |
| `craft_execute_feedback` | `steroid_execute_feedback` | Rate an execution by its returned `execution_id` |

## How discovery works

No launcher integration, no mods. A client that pressed *Open to LAN*
multicasts `[MOTD]name[/MOTD][AD]port[/AD]` datagrams on UDP `224.0.2.60:4445`
every 1.5 s; devrig-craft listens for a moment and pings what it finds
(Server List Ping also covers local offline-mode servers on `localhost:25565`).
The snapshot is rebuilt on demand for every call — the CLI holds no state,
exactly like devrig.

Dedicated-server ports are configurable: repeat `--port 25566` on the command
line, or set `DEVRIG_CRAFT_PORTS=25565,25566` when your MCP client only lets
you pass environment.

`node dist/cli.js worlds` (or `npx devrig-craft worlds` once published) prints
the current snapshot as JSON if you want to check discovery without an agent
attached.

## Limits, honestly

- **Supported Minecraft versions: 1.18–1.21** (pinned to mineflayer's
  comfort zone; the listing marks incompatible worlds).
- **LAN worlds and offline-mode local servers only.** No Microsoft-account
  auth against online-mode servers.
- **Screenshots are a guidance error, not an image.** The headless GL stack
  is not worth its flakiness here: agents verify through `bot.blockAt`
  sweeps, and you are literally watching the world first-person.
- **Not a security sandbox.** The script `craft_execute_code` runs is
  authored by the agent *you* launched against *your* world; the vm context
  is an execution convenience, not a trust boundary. A synchronous
  `while (true)` will hang the server process (restart it); a timed-out
  async script gets its bot disconnected so the world stops changing.

## Reading further

- Design spec: [`docs/design.md`](docs/design.md) — the tenets, the tool
  contracts, and the decisions log.
- Why it looks like this, for agents: `mcp-craft://skill/design-philosophy`
  (also at [`resources/recipes/skill/design-philosophy.md`](resources/recipes/skill/design-philosophy.md)).
- The original: [MCP Steroid](https://github.com/jonnyzzz/mcp-steroid) and
  [devrig.dev](https://devrig.dev) — *"Give AI the whole IDE, not just the
  files."*
