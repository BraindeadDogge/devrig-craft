# Manual demo checklist (the M2 gate)

The exact script for validating the Prism/LAN happy path end-to-end on a real
machine, with the expected observation at every step. This is the one M2 item
that needs a human at the keyboard — everything else is automated.

Machine prep (already true on the dev machine): Node 22+
(`brew install node@22`), the repo built (`npm ci && npm run build`), and the
MCP server registered (`claude mcp add --scope user devrig-craft -- node
"$PWD/dist/cli.js"` — verify with `claude mcp list` → `devrig-craft … ✔
Connected`).

## The script

1. **Launch Minecraft** from Prism Launcher: any 1.18–1.21 instance
   (1.21.4 is what CI validates against). Create or open a singleplayer
   **creative** world with an **English name** and **cheats ON**.
2. **Esc → Open to LAN** → *Start LAN World*. Chat prints
   `Local game hosted on port NNNNN` — note the port.
3. **Discovery check** (repo root):
   `node dist/cli.js worlds`
   → expect a JSON entry: `source: "lan"`, the same port, the world's name
   as `displayName`, `compatible: true`.
4. **Capture one real announcement datagram** while the world is open
   (spec §9 — the parser fixtures are synthetic until this lands):
   `sudo tcpdump -A -c 3 udp port 4445`
   Copy one `[MOTD]…[/MOTD][AD]…[/AD]` payload verbatim into
   `test/lanParser.test.ts` as a `parses a real captured Prism announcement`
   case, and run `npm test`.
5. **The demo itself.** In Claude Code:
   *"Find my running Minecraft world and build a small house with a door and
   torches next to me. Verify it block-by-block when done."*
6. **Expected tool sequence:** `craft_list_worlds` → `craft_join_world` →
   `craft_list_bots` polling until `ready` → `craft_fetch_resource`
   (building) → `craft_execute_code` (1–3 calls) → a verification sweep in
   the final output (`VERIFIED` / expected-vs-actual).
7. **In-game observation:** the `devrig` bot appears, flies to a flat spot
   *near but not on* you, places walls → door gap → roof → torches. Nothing
   in chat except any `/`-commands it chose to use.
8. **Record the promo numbers** (M3 input): total tool calls, total tokens,
   wall time from prompt to VERIFIED. These are the side-by-side table
   against a narrow-tools Minecraft MCP.

## Expected trouble spots (fix, don't shrug)

- **World not discovered:** macOS firewall prompt for `node` (allow incoming
  UDP), or the Mac and the game are on different interfaces. `worlds`
  printing `[]` while the LAN chat line is visible means the multicast never
  arrived — check `tcpdump` from step 4 first.
- **Join times out after 60 s:** the world was closed to LAN (it resets on
  every world re-open) — press Open to LAN again and re-join.
- **placeBlock failures in the building step:** reach/facing edge cases the
  Docker smoke cannot fully cover on generated terrain. Fix the recipe in
  `resources/recipes/skill/building.md` (the fence typecheck keeps you
  honest) — never work around it in the prompt.
- **Bot builds but verification reports `unloaded`:** the bot wandered too
  far from the build; the world-queries recipe's walk-closer-and-resweep
  path should be what the agent does. If it doesn't, the recipe needs a
  louder hint, not the agent a scolding.

## Sign-off

M2 is done when steps 1–8 have run green on a real Prism instance, the
captured-datagram fixture from step 4 is merged, and the numbers from step 8
are filed in `TODO.md` for the M3 comparison work.
