# Why devrig-craft looks like this

devrig-craft is a deliberate port of the [MCP Steroid](https://github.com/jonnyzzz/mcp-steroid)
design philosophy from one host (a JetBrains IDE) to another (a running
Minecraft world). Same shape, different game — literally.

## The tenets, mapped

**1. Minimal MCP tool surface.** Popular Minecraft MCP servers expose dozens
of narrow tools: `move-to`, `dig-block`, `place-block`, `look-at`, `send-chat`.
Every extra tool is another way for an agent to mis-route, and tool
descriptions compete for attention in its context. devrig-craft has exactly
eight tools, and seven are plumbing. Building a 10×10 platform through narrow
tools is ~100 round-trips; here it is one script.

**2. Power lives in code execution plus recipes, not wrappers.** The one tool
that matters, `craft_execute_code`, hands you the *native* mineflayer API —
not an "agent-friendly" abstraction over it. The scope injects the libraries'
own entry points (`goals`, `Movements`, `Item`) and these articles teach the
canonical idioms directly. Learning `bot.placeBlock(ref, face)` here is a
transferable skill; learning a bespoke `craft_place_block` tool would not be.

**3. The CLI is stateless.** `devrig-craft` (like `devrig`) holds no state
across invocations: the discovery snapshot — LAN multicast on UDP 4445 plus
Server List Ping — is rebuilt on demand per call, bots die with the process,
and two devrig-crafts on one machine coexist without locking.

**4. Helpers are last-resort.** The script scope has exactly four helpers
(`print`, `printJson`, `sleep`, `waitFor`) plus the injected classes. Nothing
else earned a seat. When something new is needed, the answer is a recipe
article, not a scope extension — prompts compound, wrappers rot.

## The mirror, tool by tool

| devrig-craft | mirrors (MCP Steroid) |
|---|---|
| `craft_list_worlds` | `steroid_list_projects` |
| `craft_list_bots` | `steroid_list_windows` |
| `craft_join_world` | `steroid_open_project` |
| `craft_execute_code` | `steroid_execute_code` |
| `craft_fetch_resource` | `steroid_fetch_resource` |
| `craft_take_screenshot` | `steroid_take_screenshot` |
| `craft_chat` | `steroid_input` |
| `craft_execute_feedback` | `steroid_execute_feedback` |

Even the habits transfer: correctness is decided through the API (`bot.blockAt`
sweeps), never by counting pixels; screenshots answer the other question —
`craft_take_screenshot` renders the build from block data so the agent can
judge how it *looks* before calling it done (`docs/design.md` §13); and data
comes back by printing it, because the response is exactly what the script
printed.

## Where the real thing lives

The IDE original drives IntelliJ-platform IDEs the same way — one
code-execution tool against the full IntelliJ API, taught by a corpus of
`mcp-steroid://` articles:

- devrig: <https://devrig.dev> — strategy: *"Give AI the whole IDE, not just the files"*
- MCP Steroid repo: <https://github.com/jonnyzzz/mcp-steroid>
- This repo's spec: `docs/design.md`

If you are an agent reading this mid-session: you now know everything this
corpus wants you to know about *why*. Go read `mcp-craft://skill/building`
for the *how*, and remember rule 1 from the index — print or it did not
happen.
