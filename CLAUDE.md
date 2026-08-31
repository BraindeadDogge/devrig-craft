# CLAUDE.md, AGENTS.md

Guidance for Claude Code when working with this repository. **Instructions here override default behavior.**

Ported from `mcp-steroid`'s root guide (2026-08-27) and adapted to this
stack. Rules that are Gradle/Kotlin/IntelliJ/TeamCity-specific were dropped;
their Node/TypeScript analogues are kept below. Where the source repo's rule
transfers verbatim (stdout discipline, no runtime skip-detection, commit
style), it is kept verbatim on purpose.

## Design philosophy

Three tenets govern every change here — to code, MCP tools, or recipes.
This repo *is* a demonstration of them, so violating one breaks the product,
not just the style.

Short version: the **MCP tool** surface (8 tools, mirroring `steroid_*`)
stays narrow on purpose; the **Minecraft capability** surface stays full,
exposed via `craft_execute_code` plus `mcp-craft://` recipe articles. New
tools and new context helpers are not the lever — recipes are.

Read `docs/design.md` §5–§7 before proposing any of:

- a new `craft_*` MCP tool (there are 8; the count is the pitch)
- a new name in the `craft_execute_code` scope (`design.md` §6 fixes it at
  ten: `bot`, `Vec3`, `mcData`, `goals`, `Movements`, `Item`, `print`,
  `printJson`, `sleep`, `waitFor` — the three library classes are native
  entry points, not a wrapper layer; `test/recipes.test.ts`'s prelude is the
  executable copy of that list)
- a "helper" that wraps a mineflayer API — `design.md:112` bans a wrapper
  layer outright; recipes teach native idioms instead

## Recursive context lookup (do this before sub-folder work)

Before acting on any task that touches files in a sub-folder, **walk the
directory tree from the changed file's folder up to the repo root and read
every `CLAUDE.md` and `AGENTS.md` you find on the way** (including this one).
Sub-folder guides take precedence over the root for their own scope.

```bash
file="<changed-file>"
dir=$(cd "$(dirname "$file")" && pwd)   # normalize FIRST — relative paths never match the root
root=$(git rev-parse --show-toplevel)
while [ "$dir" != "$root" ] && [ "$dir" != "/" ]; do
  for f in CLAUDE.md AGENTS.md; do [ -f "$dir/$f" ] && echo "$dir/$f"; done
  dir=$(dirname "$dir")
done
for f in CLAUDE.md AGENTS.md; do [ -f "$root/$f" ] && echo "$root/$f"; done
```

## Project overview

devrig-craft is a **promo product**: the MCP Steroid philosophy demonstrated
in a domain everyone understands. The user opens a singleplayer world, presses
*Open to LAN*, and says "build me a house"; the agent discovers the world,
joins it as a mineflayer bot, and builds — live, in the user's own client.

- Spec: `docs/design.md` — authoritative. Every change argues from it.
- Plan: `docs/plans/2026-08-27-devrig-craft-m1.md`
- Known defects in that plan: `docs/plan-defects.md` (with proposed fixes);
  full evidence and review history in `docs/plan-review.md`.
- Upstream sibling: `../mcp-steroid` — the thing being mirrored.

**Read `docs/plan-defects.md` before implementing any task from the plan.**
Several tasks ship code that is known-broken; the defect list says which and
why. Two architectural forks (recipe module scope, killable script execution)
are unresolved and belong to the plan's author — do not silently pick one.

## Technology stack

Node 22+ / TypeScript 5 (ESM, `NodeNext`) / `@modelcontextprotocol/sdk` /
`zod` / mineflayer + mineflayer-pathfinder / minecraft-protocol / vitest.
`prismarine-viewer` is an optional dependency (screenshots are best-effort).

## MUST DO

- Never ignore warnings or errors — fix them properly.
- Tests must show reality. **Never remove, disable, or weaken a failing
  test**; fix the underlying issue.
- Every dependency you `import` must be declared in `package.json`.
  Transitive resolution is not a declaration — it breaks on the next
  upstream bump.
- Type-check what you ship, including tests. `vitest` transpiles without
  checking; `tsc --noEmit` is the only gate that sees test types.
- Prefer real JSON handling over string surgery.
- Log new ideas/tasks in `TODO*` files (`TODO.md`, `TODO-*.md`).
- Atomic commits with descriptive messages (what and why). Test and build
  before committing.
- Never include AI as co-author or mention AI in commit messages.

## Banned patterns

- **Writing to stdout from the MCP server.** Stdout is the JSON-RPC channel —
  a single stray byte corrupts the protocol. All diagnostics go to stderr
  (`console.error`). This applies to every wrapper script too: emit only
  stderr before `exec`-ing the inner binary. Verbatim from the source repo,
  and the single most damaging mistake available here.
- **Empty `catch {}` or `catch { /* ignore */ }`.** Every catch rethrows,
  logs to stderr, or both. Silent failure hides root causes. A catch whose
  only job is a fallback must still log why the fallback fired.
- **Returning a `(value, errorFlag)` pair from a call that can fail.**
  Return the value (or `null`) and signal failure by throwing.
- **Detecting failures and skipping tests at runtime**
  (`try { … } catch { return }`, `it.skip` chosen by a probe,
  `if (!dockerAvailable) return`). The only acceptable gate is at the
  **task level** — a separate `npm run test:integration` script that a
  human or CI chooses to run. If Docker is missing, the integration test
  **fails**; it never self-skips.
- **Infrastructure workarounds in tests.** Missing Docker socket, missing
  binary, wrong Node version — fix the infrastructure, never add
  detection-and-skip code.
- **Hardcoded `mcp-craft://…` URI literals scattered through production
  code.** Derive them from the recipe file layout in one place, so a renamed
  article cannot leave a dangling URI behind.
- **Unbounded model-supplied input.** Script size, output size, and timeout
  all need explicit ceilings (`zod` `.max()` on the schema, a truncation cap
  in the sandbox). An agent will eventually pass `timeout: 999999`.
- **Fixed well-known ports in tests.** UDP 4445 is the LAN-announce port;
  binding it in two test files lets one steal the other's datagram (measured:
  the bind succeeds for both, but a unicast datagram reaches exactly one
  socket). Inject the port; tests take a free one.
- **Exact-emptiness assertions against a live network** (`expect(x).toEqual([])`
  on a discovery result). Any real Minecraft client on the LAN announces every
  1.5 s and reddens it. Assert "does not contain our marker" instead.
- **`claude mcp add` without `--scope user`.** The Claude CLI defaults to
  `--scope local`, which writes to `claude.json.projects.<cwd>.mcpServers`
  instead of the top-level user-scope `mcpServers` — registration is then
  invisible from any other project. Codex and Gemini default to user-wide and
  do not need the flag. Verbatim from the source repo.
- **Windows-hostile fixtures and assertions.** Normalize `\r\n` → `\n` before
  whole-string comparisons on captured output; build expected path fragments
  with `path.join(...)`, never as a literal `"some/relative/path"`.
- **Verifying a build by looking at pixels.** Verify via the API
  (`bot.blockAt` sweeps), per `design.md` §6. Screenshots are for humans and
  are best-effort; the core loop never depends on them.

## Test execution discipline

- **Never run the Docker integration suite in parallel with itself.** Each
  case starts a full Minecraft server container; two concurrent runs contend
  for RAM and the same host port. Wait for completion.
- **A cold integration run is slow by design** — the first one pulls the
  image and generates a world (minutes). That is not a hang. A run that has
  printed nothing *after* the server reports ready is.
- **Diagnose stuck tests before killing.** `docker ps` → `docker logs <id>`
  for the server side; for the Node side, `kill -QUIT` a stuck process or run
  the single test with `--testTimeout` lowered so it fails with a stack
  instead of hanging. Killing blind throws away the evidence and forces
  guess-and-retry.
- **Scope your runs.** `npx vitest run test/<file>.test.ts` while iterating;
  the full `npm test` before committing; `npm run test:integration` only when
  the change touches discovery, join, or the sandbox.
- **Recipe edits that touch no ```js fence need only the contract test.**
  Prose-only changes do not need the compile matrix.

## Workflow

1. Read requirements; ask if ambiguous.
2. Check `docs/plan-defects.md` for known problems in the task you are about
   to implement.
3. Add a failing test, then implement (test-first; never fake tests).
4. `npx vitest run <scoped>` while iterating.
5. Before declaring done: `tsc --noEmit`, full `npm test`, and — if discovery,
   join, or the sandbox changed — `npm run test:integration`.
6. Update `TODO*` and commit.

## CI

`.github/workflows/ci.yml`:

| Job | Runs | Trigger |
|---|---|---|
| `unit` | `npm ci`, `npm test` (which runs `npm run typecheck` first), `npm run test:pack` | every push to `main` / PR |
| `integration` | `npm run test:integration` (needs Docker) | weekly schedule + manual dispatch |

The integration job stays off per-PR runs on purpose: a cold Minecraft world
generation costs minutes and would dominate the signal.

**Green CI is not optional before a recipe commit.** `npm test` compiles every
```js fence against the exact sandbox scope, so an undeclared name in a recipe
is a build failure — but only if you run it. Two recipe commits (`f585a9f`,
`1deb432`) shipped a fence referencing a deleted `remaining` variable, which
that test catches; it was never run.

## Git remotes

| Remote | URL | Role |
|---|---|---|
| `origin` | `git@github.com:BraindeadDogge/devrig-craft` | Only remote; source of truth |

Unlike `mcp-steroid`, there is no JetBrains mirror and no TeamCity here, so
none of the `jb-merge` procedure applies. Branch from `main`, PR into `main`.

## Environment constraints

- Bot joins are **offline-mode only** (`auth: 'offline'`) — LAN worlds and
  local offline servers. No Microsoft account, no online-mode public servers
  (`design.md` §2).
- The CLI is **stateless**: no state files on disk, discovery snapshot rebuilt
  on demand per call, in-memory bot registry dies with the process
  (`design.md` §3, Tenet 3). Do not add a cache that outlives the process.
- No client or server mods, and no modification of the user's Minecraft
  installation or launcher instances (`design.md` §2).
