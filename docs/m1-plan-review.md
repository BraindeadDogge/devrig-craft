# M1 plan review — defects and proposed changes

Review of `docs/plans/2026-08-27-devrig-craft-m1.md` against `docs/design.md`.

Each item carries how it was established:

- **measured** — code was extracted and run; the output is quoted
- **read** — follows from the text of the plan
- **unverified** — needs packages that are not installed locally; stated as
  open rather than asserted

The three blockers get no proposed change: they are architectural, and two of
them need a spec decision first. Everything else has one.

---

## Blockers — decisions for the plan's author

### 1. A hung script cannot be interrupted, and the context is not isolated
`plan:696` compiles, `plan:713` invokes · measured

`runInContext`'s `timeout` applies only to the instantaneous compilation of
`(async () => { … })`; the returned function is then invoked *outside* the vm,
where no timeout exists. `Promise.race` rejects but does not stop execution.

A synchronous `while (true)` therefore hangs the entire MCP process:

```
HUNG: still alive after 4s, killed      # while(true) with timeout: 300
```

An async hang does "time out" from the caller's point of view, but the script
keeps running and keeps mutating the world. Separately, the context is not a
sandbox in any meaningful sense — `process` is reachable:

```
process_escape   function      # this.constructor.constructor("return process")()
```

Constraint on any fix: if the bot moves into a worker, killing the worker
drops the connection to the world, so interrupting a script costs a reconnect.
If the bot stays outside, a transparent RPC bridge for an arbitrary API is a
project of its own. There is no cheap option, which is why this is a decision
rather than a patch.

### 2. Recipes cannot execute in this context
`plan:1405` (navigation), `plan:1496` (building) · measured

A fresh vm context is empty:

```
require          undefined
setTimeout       undefined
dynamic import   THROWS: A dynamic import callback was not specified.
```

The flagship building recipe opens with
`new (require('prismarine-item')(bot.version))(…)`, and the recommended
navigation idiom with `await import('mineflayer-pathfinder')`. Both are dead.

This needs a spec decision, not an implementation choice: `design.md` §6 fixes
the scope at seven names, while `design.md:112` bans a wrapper layer outright —
so neither widening the scope nor hanging `goals`/`Item` off `bot` is free.

### 3. `world_name` is not stable, though it is the routing key
`design.md:80` ("stable slug") vs `plan:421` · read

Dedup suffixes (`-2`, `-3`) are assigned in iteration order, and that order
comes from a 1.8 s UDP collection window — it is not deterministic.
`craft_list_worlds` and `craft_join_world` each build their own snapshot, so a
key can denote a different world between the two calls.

---

## Serious

### 4. The recipe check is weaker than the spec requires
`design.md:139` vs `plan:1463` · read

The spec asks for a "compile/lint contract test (tsc/eslint over extracted
fences)". The plan only runs `new vm.Script(…)` — a parse check. Undefined
variables, the forbidden `require`, and wrong APIs all pass green. Combined
with #2, the corpus ships broken while CI stays green.

**Proposed change.** Emit each fence into a temporary `.ts` file prefixed with
declarations for the available scope (`declare const bot: Bot`, `Vec3`,
`mcData`, `print`, `printJson`, `sleep`, `waitFor`) and run `tsc --noEmit` over
the result. A `require` in a fence then fails in the test rather than on stage.

### 5. Audit parameters and feedback do not connect
`plan:1197`, `plan:1274` · read

`craft_execute_code` declares `task_id` and `reason` but destructures only
`{ world_name, code, timeout }`, so the audit log is empty.
`craft_execute_feedback` requires an `execution_id` that no tool ever returns.

**Proposed change.** Generate an `execution_id` (`randomUUID()`) in
`craft_execute_code` and return it as the first line of the response, the way
steroid returns it as a header. Log `task_id`, `reason`, `execution_id`,
`world_name` and duration to stderr. Have `craft_execute_feedback` reject an
id it has never seen instead of silently answering "recorded".

### 6. The smoke test avoids the product's main risk
`design.md:146`, `plan:1795` · read

Task 12 builds with nine `/setblock` commands — the deterministic path. The
actual promo path (`bot.placeBlock`: reach ≤ 4.5, face vectors, equipping via
a creative slot) is deferred to the manual Task 13. The most fragile part of
the product is first exercised while recording the video.

**Proposed change.** Add a second `it()` to Task 12: equip one block in
creative, call `bot.placeBlock` once, verify with `blockAt`. Roughly fifteen
lines, kept separate so a physical-placement failure is distinguishable from a
command-path failure.

### 7. `printJson` can return an empty response with no HINT and no error
`plan:690` · measured

`JSON.stringify` is typed as returning `string`, so strict TypeScript does not
catch this (verified: `tsc 5.6.3` exits 0). At runtime it returns `undefined`
for `undefined`, functions and symbols:

```
lines = [undefined]
lines.length = 1  -> HINT suppressed
join('\n')        -> ""
```

The model receives an empty string and cannot distinguish "returned nothing"
from "did not run" — a silent failure in the only feedback channel there is.

**Proposed change.** Handle the case explicitly:
`const s = JSON.stringify(v, null, 2); lines.push(s === undefined ? 'undefined' : s)`,
plus a test asserting `printJson(undefined)` yields `undefined`, not `""`.

### 8. The screenshot tool returns a path instead of an image
`plan:1261` · read

It returns the text `screenshot written: /tmp/…`, although MCP supports
`{ type: 'image', data, mimeType }` and the mirrored `steroid_take_screenshot`
returns an image payload. The client never sees the picture.

**Proposed change.** Return `{ type: 'image', data: <base64 PNG>, mimeType:
'image/png' }` and keep the path as a second text block for humans. Land it
together with #15, since the frame API is not pinned yet.

### 9. Executions on one bot are not serialized
Tasks 7–8 · read

Nothing serializes `craft_execute_code`. Two parallel calls against the same
`world_name` will drive the bot simultaneously: pathfinder receives two goals,
`placeBlock` competing equips. MCP clients are free to issue parallel tool
calls, and models do.

**Proposed change.** A per-world queue in `BotManager` (a `chain =
Promise.resolve()` field each execution appends to). Prefer returning
`err('bot busy: another script is running in this world')` over silently
queueing — the model can act on a stated reason but not on an unexplained
delay. The same lock should cover `craft_chat`.

### 10. No limits on code size, output, or timeout
`plan:1195` · read

No `.max()` on `code`, no bounds on `timeout`, no ceiling on `lines[]`.
`timeout: 999999` buys an effectively unbounded run that also cannot be
interrupted (#1); a printing loop grows the array until OOM; a large output
lands in the response and floods the model's context.

**Proposed change.** `code: z.string().max(100_000)`,
`timeout: z.number().int().min(1).max(600)`, and an output ceiling in
`executeScript` (say 256 KB or 2000 lines) with an explicit final line
`[output truncated: N more lines]`. Truncate from the middle and keep the
tail — verification output lives at the end.

### 11. Errors carry no script line, and line numbers are off by one
`design.md:114` vs `plan:671` · read

The spec promises "message + stack + the line of script". `ScriptError` carries
message and stack only. Worse, the code is wrapped as
`(async () => {\n${code}\n})`, so reported line numbers are shifted by one and
the filename is synthetic — the model fixes the wrong line.

**Proposed change.** Pass `lineOffset: -1` to `runInContext` so numbers match
what the model wrote (confirm against a real stack — the option affects
reporting only), and keep the source alongside `ScriptError` so the failing
line can be appended: `line 7: await bot.placeBlock(...)`.

---

## Requirements the spec states and the plan drops

A full sweep of `design.md` §1–§13 found eight of these. No further divergences
were found beyond those listed here.

### 12. Ping ports are not user-configurable
`design.md:76` vs `plan:1134`, `plan:1619` · read

The spec says "localhost:25565 (+ optional user-configured ports)".
`extraPorts` exists only as an internal DI parameter: the CLI hardcodes
`[25565]` and the server uses `deps.extraPorts ?? [25565]`. There is no flag
and no environment variable. Separately, ports are pinged sequentially at
1.5 s each.

**Proposed change.** A repeatable `--port` flag plus
`DEVRIG_CRAFT_PORTS=25565,25566` as a fallback (MCP clients often control only
the command line, but can pass environment). Replace the sequential loop with
`Promise.all`: three ports then cost 1.5 s per `craft_list_worlds` call
instead of 4.5 s.

### 13. Ping discards MOTD and player count
`design.md:76` vs `plan:398` · read

The spec says Server List Ping "yields version, MOTD, player count".
`PingSource` returns `{ version } | null`. The consequence is visible in the
output: for `source: 'server'`, `displayName` is assembled as
`localhost:25565` instead of the server's MOTD, which is in the same response.
Player count is not surfaced anywhere.

**Proposed change.** Widen `PingSource` to
`{ version, motd, players: { online, max } } | null`, use MOTD as
`displayName` for `source: 'server'` (falling back to `localhost:PORT` when
empty), and include `players` in the listing — which also makes the list more
useful, since occupied worlds become visible.

### 14. The spec names a CI smoke test; there is no CI
`design.md:161` vs the whole plan · read

`design.md` calls the dockerized integration test "the CI smoke test", but the
plan contains no `.github/workflows` and no other CI description. Task 12 runs
only when a human types `npm run test:integration`.

**Proposed change.** Add a task creating `.github/workflows/ci.yml`: a `unit`
job on push and PR (`npm ci`, `tsc --noEmit`, `npm test`), and a separate
`integration` job with Docker on a schedule and manual dispatch. Keeping
integration off per-PR runs avoids paying minutes of world generation for
every change.

### 15. Ping-response parsing is not unit-tested
`design.md:157` vs `plan:514` · read

The spec asks for unit coverage of the "discovery parser (multicast payloads,
**ping responses**)". Only the closed-port case is tested. Extraction of
`result.version.name` and behaviour on a partial response are untested; the
plan defers both to integration.

**Proposed change.** Mock `minecraft-protocol` and cover three cases: a normal
response yields `{ version }`, a response without `version.name` yields `null`,
and a thrown error yields `null`. This is exactly the class of breakage that
survives a `minecraft-protocol` upgrade.

### 16. The `npx` distribution path is never exercised
`design.md:65`, `plan:1670` · read

The whole quickstart rests on `npx devrig-craft`, but the honesty check in
Task 11 runs `node dist/cli.js --version` — a different path. Nothing verifies
`bin`, `files`, or that `resources/` reaches the published package.

**Proposed change.** Add `npm pack && npx ./devrig-craft-0.1.0.tgz --version`
plus one recipe fetch through the packed tarball. This also catches the
forgotten `files` entry (#21) and a wrong `resources/` path.

### 17. Screenshot: no API pinned, no acceptance test
`plan:1330` · unverified

Task 8 contains pseudocode naming two possible `prismarine-viewer` APIs and no
test for a successful frame.

**Proposed change.** Install the package, look at the real API, and pin it with
a single-frame test — or declare the success path out of M1 and keep only the
error branch, with a test for that. The current state, pseudocode with no
check, is the worst of the three.

### 18. Smaller spec divergences
· read

- `design.md:100` — feedback "logs locally", but the plan writes to stderr
  (`plan:1279`), i.e. into the client's log rather than locally.
- `design.md:104` — "steroid house style: decision tables" is promised; the
  tool descriptions contain no tables, and the plan delegates this with
  "write them in full steroid house style in code" without any acceptance.
- `design.md:195` — "parser tested on captured payloads", but the Task 2 tests
  use synthetic strings.

**Proposed change.** Write feedback as JSONL to
`os.tmpdir()/devrig-craft-feedback.jsonl` and return the path. Either drop
"decision tables" from the spec or put a table in the `craft_execute_code`
description and pin it with a substring test. Capture one real datagram during
Task 13 and add it to the Task 2 fixtures.

---

## Hygiene

### 19. Undeclared dependencies
`plan:1348` vs `plan:52` · read

`import minecraftData from 'minecraft-data'` exists; the package is not in
`package.json`. It will most likely resolve transitively through `mineflayer`,
which makes this a latent break — it fails when mineflayer changes its own
version — rather than an immediate one.

**Proposed change.** Declare `minecraft-data` in `dependencies` in Task 1, at
the range the installed mineflayer pulls (`npm ls minecraft-data`).

### 20. Test types are never checked
`plan:76` · read

`rootDir: "src"` and `include: ["src"]` leave `test/` outside compilation, and
vitest transpiles without type-checking. The TDD loop never runs
`tsc --noEmit`, so a typo in a test surfaces as an obscure runtime error.

**Proposed change.** A separate `tsconfig.test.json` with
`include: ["src","test","test-integration"]` and `noEmit`, and `npm test`
becoming `tsc -p tsconfig.test.json --noEmit && vitest run …`.

### 21. `worldName` in JSON versus `world_name` in parameters
`design.md:93` vs `plan:1041` · read

Declared intentional in the plan's self-review. The model will confuse the
response field with the parameter name, and the divergence buys nothing.

**Proposed change.** One mapper at the MCP boundary: camelCase stays inside
TypeScript, snake_case goes out (`world_name`, `display_name`, …). Add a test
asserting no camelCase key appears in the JSON output, or the divergence
returns with the next new field.

### 22. `LAN_PORT = 4445` is hardcoded, breaking test isolation
`plan:530` · measured

Two processes can both bind 4445 with `reuseAddr` — no `EADDRINUSE`:

```
A BOUND ok
B BOUND ok
```

But a unicast datagram reaches exactly one socket:

```
LISTENER-A GOT: [MOTD]loop world[/MOTD][AD]7777[/AD]
LISTENER-B window closed
```

So the listener started by `cli.test.ts` can swallow the datagram
`sources.test.ts` sends to itself, failing its `toContainEqual`. Independently,
the second test there asserts `toEqual([])` — an exact comparison that any real
Minecraft client on the network, announcing every 1.5 s, will redden.

**Proposed change.** Make the port a parameter:
`collectLanAnnouncements(windowMs, port = 4445)`; tests take a free port,
production keeps the default. Rewrite the empty-list assertion as "does not
contain our marker" — it should test filtering, not the absence of neighbours.

### 23. Small errors that will stall an implementer

- `plan:464` promises "Expected: 6 PASS"; Task 4 has five tests (4 + 1).
- `plan:1405` still contains an editing draft inside the requirements for
  `navigation.md` — "`require(...)` — **NO**. Use the loaded plugin idiom" —
  which an implementer will read as article content.
- `"files": ["dist","resources"]` is mentioned in a note in Task 10, but
  `package.json` is written in Task 1.

**Proposed change.** Correct the count to 5; delete the draft, leaving whichever
idiom survives the decision on #2; move `files` into Task 1 and let #16's
`npm pack` verify it.

### 24. There is no M1 acceptance gate
`design.md:176` vs `plan:1877` · read

The spec defines M1 as "CLI + discovery + join + execute_code + 4 recipes".
The plan delivers eight recipes plus screenshots, README and a manual Prism
run — M1 and M2 together, as its own self-review states. There is no point in
the document at which M1 is done, and the one-week estimate no longer matches
the executable scope.

**Proposed change.** Split along the spec: Tasks 1–8, 10, 12 plus four recipes
(`skill`, `building`, `world-queries`, `building-with-commands`) form M1, with
an explicit gate — "`npm test` green and Task 12 passing on a clean machine".
The remaining recipes, screenshots, README and Task 13 move to a separate M2
document.

---

## Bot lifecycle

### 25. No join timeout
`plan:886` · read

If a bot neither spawns nor fails, its entry stays `joining` forever. Task 12
masks this with a 60-iteration poll loop.

**Proposed change.** A 60 s timer in `join()`: if the state is still `joining`
when it fires, move to `error` with
`join timed out after 60s — is the world still open to LAN?`. Clear the timer
on `spawn`.

### 26. The previous bot is not ended on re-join
`plan:886` · read

After an `error`, `join()` creates a new bot without calling
`existing.bot.end()` — a leaked socket and possibly a second player in the
world.

**Proposed change.** End the old bot before creating a new one, and — more
importantly — detach its listeners, so a late `end` from the old emitter
cannot push the *new* entry into `error`.

### 27. `endAll()` is not wired to shutdown
`plan:930` defines it, `plan:842` calls it only from a test · read

Bots are not disconnected cleanly when the MCP server exits.

**Proposed change.** Expose `endAll` from `createCraftServer` (or hand out the
`BotManager`) and call it from `cli.ts` on `SIGINT` and `SIGTERM`.

---

## Raised and dismissed by the repo owner

- A hardcoded `SUPPORTED_RANGE = ['1.18','1.21']` that is never checked against
  the installed stack.
- The `design.md` §8 requirement to report in the join result that the world
  has cheats disabled.
- The slug dropping non-Latin world names (`"Мой мир"` → `world`).

## Open decisions

- **Recipe scope** — widen the public scope by amending the spec, or attach
  `goals`/`Item` to `bot` (which `design.md:112` calls a wrapper layer).
  Tasks 6 and 9 depend on the answer.
- **Killable execution** — see the constraint under #1. Task 6 depends on it.
- **Unverified locally** — the `prismarine-viewer` single-frame API, and `vm`
  behaviour on Node 22 (measurements were taken on 26.3.0).
