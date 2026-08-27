# devrig-craft M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stdio MCP server (`devrig-craft`) that discovers running Minecraft worlds (LAN-opened clients such as Prism Launcher instances, or local offline-mode servers), joins them as a mineflayer bot, and drives the game through one code-execution tool plus a recipe corpus — mirroring the MCP Steroid tool surface 1:1.

**Architecture:** One Node/TypeScript process: a stateless stdio MCP server whose discovery snapshot is rebuilt on demand per call (UDP 4445 multicast + Server List Ping), an in-process bot manager (one mineflayer bot per joined world, dies with the process), and a `vm`-sandboxed `craft_execute_code` runtime where the script's printed output is the entire tool response.

**Tech Stack:** Node 22+, TypeScript 5 (ESM), `@modelcontextprotocol/sdk`, `zod`, `mineflayer`, `mineflayer-pathfinder`, `minecraft-protocol` (ping), `vec3`, `prismarine-viewer` (best-effort screenshots), `vitest`.

**Spec:** `docs/design.md` (this repo) — read it before starting; every contract below argues from it.

## Global Constraints

- Exactly 8 MCP tools, named: `craft_list_worlds`, `craft_list_bots`, `craft_join_world`, `craft_execute_code`, `craft_fetch_resource`, `craft_take_screenshot`, `craft_chat`, `craft_execute_feedback`. No additional tools — power goes into `craft_execute_code` + recipes (spec §5, Tenet 1).
- The CLI is stateless: no state files on disk; discovery snapshot rebuilt on demand per call; in-memory bot registry dies with the process (spec §3, Tenet 3).
- `craft_execute_code` scope is exactly: `bot`, `Vec3`, `mcData`, `print`, `printJson`, `sleep`, `waitFor` — nothing else (spec §6, Tenet 4). The response contains only what the script printed; a print-less success returns one HINT line.
- No client/server mods; LAN worlds + offline-mode local servers only; bot username defaults to `devrig` (spec §2, §4).
- Recipes are markdown with copy-paste JS blocks that must parse (`docs/../resources/recipes/*.md`, spec §7); every JS fence is syntax-checked by a contract test.
- Tool descriptions follow the steroid house style: `task_id` + `reason` audit params on heavy tools, "prefer execute_code" steering on `craft_chat` and `craft_take_screenshot`.
- Node built-in test tooling is vitest; unit tests must not require a running Minecraft server. Integration tests run only via the dedicated `npm run test:integration` script (task-level gating — never runtime skip-detection inside a test).
- Commit style: imperative, what+why, no AI co-author mentions.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/version.ts`, `test/version.test.ts`

**Interfaces:**
- Produces: ESM TypeScript project where `npm test` runs vitest; `SERVER_NAME = 'devrig-craft'`, `SERVER_VERSION` exported from `src/version.ts`.

- [ ] **Step 1: Write config files**

`package.json`:

```json
{
  "name": "devrig-craft",
  "version": "0.1.0",
  "description": "devrig plays Minecraft — MCP Steroid philosophy, Minecraft host",
  "type": "module",
  "license": "Apache-2.0",
  "bin": { "devrig-craft": "dist/cli.js" },
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run --exclude 'test-integration/**'",
    "test:integration": "vitest run test-integration --testTimeout 600000"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "mineflayer": "^4.20.0",
    "mineflayer-pathfinder": "^2.4.5",
    "minecraft-protocol": "^1.47.0",
    "vec3": "^0.1.10",
    "zod": "^3.24.0"
  },
  "optionalDependencies": {
    "prismarine-viewer": "^1.28.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['test/**/*.test.ts', 'test-integration/**/*.test.ts'] } })
```

`.gitignore`:

```
node_modules/
dist/
*.log
```

`src/version.ts`:

```ts
export const SERVER_NAME = 'devrig-craft'
export const SERVER_VERSION = '0.1.0'
```

`test/version.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SERVER_NAME } from '../src/version.js'

describe('scaffold', () => {
  it('exports the server name', () => {
    expect(SERVER_NAME).toBe('devrig-craft')
  })
})
```

- [ ] **Step 2: Install and run the test**

Run: `npm install && npm test`
Expected: 1 test PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/version.ts test/version.test.ts package-lock.json
git commit -m "Scaffold devrig-craft: TypeScript ESM project with vitest"
```

---

### Task 2: LAN announcement parser

**Files:**
- Create: `src/discovery/lanParser.ts`
- Test: `test/lanParser.test.ts`

**Interfaces:**
- Produces: `parseLanAnnouncement(payload: string): { motd: string, port: number } | null`

Minecraft clients that pressed *Open to LAN* broadcast UDP datagrams to `224.0.2.60:4445` every ~1.5 s with the payload `[MOTD]<world name>[/MOTD][AD]<port>[/AD]`. This parser is a pure function over that payload.

- [ ] **Step 1: Write the failing test**

`test/lanParser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseLanAnnouncement } from '../src/discovery/lanParser.js'

describe('parseLanAnnouncement', () => {
  it('parses a standard announcement', () => {
    expect(parseLanAnnouncement("[MOTD]Grigorii's world[/MOTD][AD]54321[/AD]"))
      .toEqual({ motd: "Grigorii's world", port: 54321 })
  })

  it('parses a MOTD containing brackets', () => {
    expect(parseLanAnnouncement('[MOTD]a [fun] world[/MOTD][AD]1234[/AD]'))
      .toEqual({ motd: 'a [fun] world', port: 1234 })
  })

  it('returns null for garbage', () => {
    expect(parseLanAnnouncement('hello')).toBeNull()
  })

  it('returns null for out-of-range ports', () => {
    expect(parseLanAnnouncement('[MOTD]x[/MOTD][AD]99999[/AD]')).toBeNull()
    expect(parseLanAnnouncement('[MOTD]x[/MOTD][AD]0[/AD]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lanParser.test.ts`
Expected: FAIL — cannot find module `../src/discovery/lanParser.js`.

- [ ] **Step 3: Write the implementation**

`src/discovery/lanParser.ts`:

```ts
const LAN_RE = /\[MOTD\](.*)\[\/MOTD\]\[AD\](\d{1,5})\[\/AD\]/s

export function parseLanAnnouncement(payload: string): { motd: string; port: number } | null {
  const m = LAN_RE.exec(payload)
  if (!m) return null
  const port = Number(m[2])
  if (port < 1 || port > 65535) return null
  return { motd: m[1], port }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lanParser.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/discovery/lanParser.ts test/lanParser.test.ts
git commit -m "Parse Minecraft LAN world announcements ([MOTD]/[AD] datagrams)"
```

---

### Task 3: World slugs (routing keys)

**Files:**
- Create: `src/discovery/slug.ts`
- Test: `test/slug.test.ts`

**Interfaces:**
- Produces: `worldSlug(displayName: string, taken: Set<string>): string` — lowercase kebab slug, deduplicated with `-2`, `-3`, … suffixes. This is the `world_name` routing key (mirrors devrig's `project_name` slug rule).

- [ ] **Step 1: Write the failing test**

`test/slug.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { worldSlug } from '../src/discovery/slug.js'

describe('worldSlug', () => {
  it('kebab-cases display names', () => {
    expect(worldSlug("Grigorii's world", new Set())).toBe('grigorii-s-world')
  })

  it('collapses runs and trims edge dashes', () => {
    expect(worldSlug('  My -- World!! ', new Set())).toBe('my-world')
  })

  it('falls back to "world" when nothing survives', () => {
    expect(worldSlug('!!!', new Set())).toBe('world')
  })

  it('deduplicates against taken slugs', () => {
    const taken = new Set(['my-world', 'my-world-2'])
    expect(worldSlug('My World', taken)).toBe('my-world-3')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/slug.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/discovery/slug.ts`:

```ts
export function worldSlug(displayName: string, taken: Set<string>): string {
  const base =
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'world'
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/slug.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/discovery/slug.ts test/slug.test.ts
git commit -m "Add world_name slug allocation with dedup (devrig naming mirror)"
```

---

### Task 4: Discovery snapshot builder

**Files:**
- Create: `src/discovery/snapshot.ts`
- Test: `test/snapshot.test.ts`

**Interfaces:**
- Consumes: `parseLanAnnouncement`, `worldSlug` (Tasks 2–3).
- Produces:
  - `type DiscoveredWorld = { worldName: string; displayName: string; host: string; port: number; source: 'lan' | 'server'; version: string | null; compatible: boolean }`
  - `type LanSource = () => Promise<Array<{ motd: string; port: number; host: string }>>`
  - `type PingSource = (host: string, port: number) => Promise<{ version: string } | null>`
  - `buildSnapshot(lan: LanSource, ping: PingSource, extraPorts?: number[]): Promise<DiscoveredWorld[]>`
  - `isVersionSupported(version: string): boolean` — true when the major.minor is within `SUPPORTED_RANGE = ['1.18', '1.21']` (pin; update as mineflayer catches up).

Sources are injected so the builder is unit-testable without sockets. Real sources come in Task 5.

- [ ] **Step 1: Write the failing test**

`test/snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSnapshot, isVersionSupported } from '../src/discovery/snapshot.js'

const noLan = async () => []
const noPing = async () => null

describe('buildSnapshot', () => {
  it('lists LAN worlds with slugs and version from ping', async () => {
    const lan = async () => [{ motd: "Grigorii's world", port: 54321, host: '192.168.1.10' }]
    const ping = async () => ({ version: '1.21.4' })
    const worlds = await buildSnapshot(lan, ping)
    expect(worlds).toEqual([
      {
        worldName: 'grigorii-s-world',
        displayName: "Grigorii's world",
        host: '192.168.1.10',
        port: 54321,
        source: 'lan',
        version: '1.21.4',
        compatible: true,
      },
    ])
  })

  it('dedupes identical repeated LAN announcements', async () => {
    const ann = { motd: 'w', port: 1000, host: 'h' }
    const worlds = await buildSnapshot(async () => [ann, ann, ann], noPing)
    expect(worlds).toHaveLength(1)
  })

  it('adds localhost servers found on extra ports', async () => {
    const ping = async (_h: string, p: number) => (p === 25565 ? { version: '1.20.1' } : null)
    const worlds = await buildSnapshot(noLan, ping, [25565])
    expect(worlds).toEqual([
      {
        worldName: 'localhost-25565',
        displayName: 'localhost:25565',
        host: '127.0.0.1',
        port: 25565,
        source: 'server',
        version: '1.20.1',
        compatible: true,
      },
    ])
  })

  it('keeps unreachable-ping LAN worlds with null version, marked incompatible', async () => {
    const lan = async () => [{ motd: 'w', port: 1000, host: 'h' }]
    const worlds = await buildSnapshot(lan, noPing)
    expect(worlds[0]!.version).toBeNull()
    expect(worlds[0]!.compatible).toBe(false)
  })
})

describe('isVersionSupported', () => {
  it('accepts the pinned range and rejects outside it', () => {
    expect(isVersionSupported('1.21.4')).toBe(true)
    expect(isVersionSupported('1.18')).toBe(true)
    expect(isVersionSupported('1.8.9')).toBe(false)
    expect(isVersionSupported('1.22')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/snapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/discovery/snapshot.ts`:

```ts
import { worldSlug } from './slug.js'

export type DiscoveredWorld = {
  worldName: string
  displayName: string
  host: string
  port: number
  source: 'lan' | 'server'
  version: string | null
  compatible: boolean
}

export type LanSource = () => Promise<Array<{ motd: string; port: number; host: string }>>
export type PingSource = (host: string, port: number) => Promise<{ version: string } | null>

export const SUPPORTED_RANGE: [string, string] = ['1.18', '1.21']

function minor(version: string): number {
  const m = /^1\.(\d+)/.exec(version)
  return m ? Number(m[1]) : NaN
}

export function isVersionSupported(version: string): boolean {
  const v = minor(version)
  return v >= minor(SUPPORTED_RANGE[0]) && v <= minor(SUPPORTED_RANGE[1])
}

export async function buildSnapshot(
  lan: LanSource,
  ping: PingSource,
  extraPorts: number[] = [],
): Promise<DiscoveredWorld[]> {
  const taken = new Set<string>()
  const worlds: DiscoveredWorld[] = []
  const seen = new Set<string>()

  for (const a of await lan()) {
    const key = `${a.host}:${a.port}`
    if (seen.has(key)) continue
    seen.add(key)
    const pinged = await ping(a.host, a.port)
    const version = pinged?.version ?? null
    const worldName = worldSlug(a.motd, taken)
    taken.add(worldName)
    worlds.push({
      worldName,
      displayName: a.motd,
      host: a.host,
      port: a.port,
      source: 'lan',
      version,
      compatible: version !== null && isVersionSupported(version),
    })
  }

  for (const port of extraPorts) {
    if (seen.has(`127.0.0.1:${port}`)) continue
    const pinged = await ping('127.0.0.1', port)
    if (!pinged) continue
    const worldName = worldSlug(`localhost-${port}`, taken)
    taken.add(worldName)
    worlds.push({
      worldName,
      displayName: `localhost:${port}`,
      host: '127.0.0.1',
      port,
      source: 'server',
      version: pinged.version,
      compatible: isVersionSupported(pinged.version),
    })
  }

  return worlds
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/snapshot.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/discovery/snapshot.ts test/snapshot.test.ts
git commit -m "Build on-demand discovery snapshot from injectable LAN + ping sources"
```

---

### Task 5: Real LAN listener and Server List Ping sources

**Files:**
- Create: `src/discovery/sources.ts`
- Test: `test/sources.test.ts`

**Interfaces:**
- Consumes: `LanSource`, `PingSource` types (Task 4), `parseLanAnnouncement` (Task 2).
- Produces:
  - `collectLanAnnouncements(windowMs?: number): ReturnType<LanSource>` — joins multicast group `224.0.2.60` on UDP port 4445, collects datagrams for `windowMs` (default 1800 ms — announcements repeat every 1500 ms), parses each with `parseLanAnnouncement`, resolves with parsed entries (host = sender address).
  - `pingWorld: PingSource` — wraps `minecraft-protocol`'s `ping()` with a 1500 ms timeout, mapping the result to `{ version: result.version.name }`, `null` on any error.

The unit test exercises the real UDP path over loopback by sending a datagram to the listener's port — no Minecraft needed. `pingWorld`'s error path is unit-tested (closed port → null); its happy path is covered by the Task 12 integration test.

- [ ] **Step 1: Write the failing test**

`test/sources.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import dgram from 'node:dgram'
import { collectLanAnnouncements, pingWorld } from '../src/discovery/sources.js'

describe('collectLanAnnouncements', () => {
  it('collects a datagram sent to the LAN port during the window', async () => {
    const pending = collectLanAnnouncements(600)
    // Give the listener a beat to bind before sending.
    await new Promise((r) => setTimeout(r, 150))
    const sock = dgram.createSocket('udp4')
    sock.send('[MOTD]loop world[/MOTD][AD]7777[/AD]', 4445, '127.0.0.1', () => sock.close())
    const anns = await pending
    expect(anns).toContainEqual({ motd: 'loop world', port: 7777, host: '127.0.0.1' })
  })

  it('resolves empty when nothing announces', async () => {
    expect(await collectLanAnnouncements(200)).toEqual([])
  })
})

describe('pingWorld', () => {
  it('returns null for a closed port', async () => {
    expect(await pingWorld('127.0.0.1', 39999)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sources.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/discovery/sources.ts`:

```ts
import dgram from 'node:dgram'
import mc from 'minecraft-protocol'
import { parseLanAnnouncement } from './lanParser.js'
import type { LanSource, PingSource } from './snapshot.js'

const LAN_GROUP = '224.0.2.60'
const LAN_PORT = 4445

export function collectLanAnnouncements(windowMs = 1800): ReturnType<LanSource> {
  return new Promise((resolve) => {
    const found: Array<{ motd: string; port: number; host: string }> = []
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const done = () => {
      try {
        sock.close()
      } catch (e) {
        console.error('lan listener close failed:', e)
      }
      resolve(found)
    }
    sock.on('error', (e) => {
      console.error('lan listener error:', e)
      done()
    })
    sock.on('message', (buf, rinfo) => {
      const parsed = parseLanAnnouncement(buf.toString('utf8'))
      if (parsed) found.push({ ...parsed, host: rinfo.address })
    })
    sock.bind(LAN_PORT, () => {
      try {
        sock.addMembership(LAN_GROUP)
      } catch (e) {
        // No multicast on this interface — loopback datagrams still arrive.
        console.error('lan multicast join failed:', e)
      }
      setTimeout(done, windowMs)
    })
  })
}

export const pingWorld: PingSource = async (host, port) => {
  try {
    const result = await new Promise<any>((resolve, reject) => {
      mc.ping({ host, port, closeTimeout: 1500, noPongTimeout: 1500 }, (err: unknown, res: unknown) =>
        err ? reject(err) : resolve(res),
      )
    })
    const name = result?.version?.name
    return typeof name === 'string' ? { version: name } : null
  } catch (e) {
    console.error(`ping ${host}:${port} failed:`, e)
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sources.test.ts`
Expected: 3 PASS. (If port 4445 is busy because a local Minecraft client is running, close it and re-run — the listener binds with `reuseAddr`, so this is rare.)

- [ ] **Step 5: Commit**

```bash
git add src/discovery/sources.ts test/sources.test.ts
git commit -m "Add real discovery sources: UDP 4445 LAN listener and Server List Ping"
```

---

### Task 6: Execute-code sandbox

**Files:**
- Create: `src/runtime/sandbox.ts`
- Test: `test/sandbox.test.ts`

**Interfaces:**
- Produces:
  - `executeScript(code: string, scope: Record<string, unknown>, timeoutMs: number): Promise<string>` — runs `code` as the body of an async function inside a `node:vm` context whose globals are exactly `scope` plus `print`, `printJson`, `sleep`. Returns the printed lines joined with `\n`. A successful run that printed nothing returns exactly `HINT: script completed but printed nothing — use print(...)/printJson(...) to return data.`
  - Errors: rejects with `ScriptError` carrying `message` and the original `stack`.
  - Timeout: rejects with `ScriptError` whose message starts with `Script timed out after`.

`waitFor` from the spec's scope is bot-specific, so it is provided in Task 8's scope object, not by the sandbox.

- [ ] **Step 1: Write the failing test**

`test/sandbox.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { executeScript, ScriptError } from '../src/runtime/sandbox.js'

describe('executeScript', () => {
  it('returns only what the script prints', async () => {
    const out = await executeScript('print("a"); print("b", 42)', {}, 1000)
    expect(out).toBe('a\nb 42')
  })

  it('printJson pretty-prints', async () => {
    const out = await executeScript('printJson({ x: 1 })', {}, 1000)
    expect(out).toBe('{\n  "x": 1\n}')
  })

  it('supports top-level await and scope values', async () => {
    const out = await executeScript('await sleep(10); print(magic + 1)', { magic: 41 }, 1000)
    expect(out).toBe('42')
  })

  it('returns the HINT line for print-less success', async () => {
    const out = await executeScript('const x = 1', {}, 1000)
    expect(out).toContain('HINT: script completed but printed nothing')
  })

  it('rejects with ScriptError carrying the thrown message', async () => {
    await expect(executeScript('throw new Error("boom")', {}, 1000)).rejects.toThrowError(/boom/)
    await expect(executeScript('throw new Error("boom")', {}, 1000)).rejects.toBeInstanceOf(ScriptError)
  })

  it('reports syntax errors without crashing the process', async () => {
    await expect(executeScript('const const', {}, 1000)).rejects.toBeInstanceOf(ScriptError)
  })

  it('times out hung scripts', async () => {
    await expect(executeScript('await sleep(5000)', {}, 100)).rejects.toThrowError(/timed out after/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sandbox.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/runtime/sandbox.ts`:

```ts
import vm from 'node:vm'

export class ScriptError extends Error {
  constructor(message: string, public readonly scriptStack?: string) {
    super(message)
    this.name = 'ScriptError'
  }
}

export const NO_PRINT_HINT =
  'HINT: script completed but printed nothing — use print(...)/printJson(...) to return data.'

export async function executeScript(
  code: string,
  scope: Record<string, unknown>,
  timeoutMs: number,
): Promise<string> {
  const lines: string[] = []
  const context = vm.createContext({
    ...scope,
    print: (...args: unknown[]) => lines.push(args.map(String).join(' ')),
    printJson: (value: unknown) => lines.push(JSON.stringify(value, null, 2)),
    sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  })

  let fn: () => Promise<unknown>
  try {
    fn = vm.runInContext(`(async () => {\n${code}\n})`, context, {
      filename: 'craft-script.js',
      timeout: timeoutMs,
    }) as () => Promise<unknown>
  } catch (e) {
    const err = e as Error
    throw new ScriptError(`Script failed to compile: ${err.message}`, err.stack)
  }

  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ScriptError(`Script timed out after ${timeoutMs} ms`)),
      timeoutMs,
    )
  })
  try {
    await Promise.race([fn(), timeout])
  } catch (e) {
    if (e instanceof ScriptError) throw e
    const err = e as Error
    throw new ScriptError(`Script threw: ${err.message}`, err.stack)
  } finally {
    clearTimeout(timer)
  }

  return lines.length > 0 ? lines.join('\n') : NO_PRINT_HINT
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sandbox.test.ts`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/sandbox.ts test/sandbox.test.ts
git commit -m "Add vm sandbox for craft_execute_code: print capture, timeout, HINT contract"
```

---

### Task 7: Bot manager

**Files:**
- Create: `src/runtime/botManager.ts`
- Test: `test/botManager.test.ts`

**Interfaces:**
- Consumes: `DiscoveredWorld` (Task 4).
- Produces:
  - `type BotFactory = (opts: { host: string; port: number; username: string; auth: 'offline' }) => BotLike` — injectable; production wires mineflayer here (Task 8).
  - `type BotLike = NodeJS.EventEmitter & { entity?: { position: { x: number; y: number; z: number } }; health?: number; food?: number; end: (reason?: string) => void }`
  - `class BotManager`:
    - `join(world: DiscoveredWorld, username: string): void` — idempotent per `worldName`; registers state `joining`, flips to `ready` on `'spawn'`, to `error` (with message) on `'error'`/`'kicked'`/`'end'`.
    - `list(): Array<{ worldName: string; username: string; state: 'joining' | 'ready' | 'error'; error?: string; position?: { x: number; y: number; z: number }; health?: number; food?: number }>`
    - `get(worldName: string): { bot: BotLike; state: string } | undefined`
    - `endAll(): void`

- [ ] **Step 1: Write the failing test**

`test/botManager.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { BotManager, type BotLike } from '../src/runtime/botManager.js'
import type { DiscoveredWorld } from '../src/discovery/snapshot.js'

function world(name: string): DiscoveredWorld {
  return {
    worldName: name,
    displayName: name,
    host: 'h',
    port: 1,
    source: 'lan',
    version: '1.21.4',
    compatible: true,
  }
}

class FakeBot extends EventEmitter implements BotLike {
  entity = { position: { x: 1, y: 64, z: 3 } }
  health = 20
  food = 18
  ended = false
  end() {
    this.ended = true
  }
}

describe('BotManager', () => {
  it('tracks joining → ready on spawn', () => {
    const bot = new FakeBot()
    const mgr = new BotManager(() => bot)
    mgr.join(world('w'), 'devrig')
    expect(mgr.list()[0]).toMatchObject({ worldName: 'w', state: 'joining' })
    bot.emit('spawn')
    expect(mgr.list()[0]).toMatchObject({
      state: 'ready',
      position: { x: 1, y: 64, z: 3 },
      health: 20,
      food: 18,
    })
  })

  it('records kick reasons as error state', () => {
    const bot = new FakeBot()
    const mgr = new BotManager(() => bot)
    mgr.join(world('w'), 'devrig')
    bot.emit('kicked', 'You are banned')
    expect(mgr.list()[0]).toMatchObject({ state: 'error', error: 'kicked: You are banned' })
  })

  it('is idempotent per world while a live bot exists', () => {
    let created = 0
    const mgr = new BotManager(() => {
      created++
      return new FakeBot()
    })
    mgr.join(world('w'), 'devrig')
    mgr.join(world('w'), 'devrig')
    expect(created).toBe(1)
  })

  it('rejoining after error creates a fresh bot', () => {
    let created = 0
    const bots: FakeBot[] = []
    const mgr = new BotManager(() => {
      created++
      const b = new FakeBot()
      bots.push(b)
      return b
    })
    mgr.join(world('w'), 'devrig')
    bots[0]!.emit('end', 'socketClosed')
    mgr.join(world('w'), 'devrig')
    expect(created).toBe(2)
  })

  it('endAll ends every bot', () => {
    const bot = new FakeBot()
    const mgr = new BotManager(() => bot)
    mgr.join(world('w'), 'devrig')
    mgr.endAll()
    expect(bot.ended).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/botManager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/runtime/botManager.ts`:

```ts
import type { EventEmitter } from 'node:events'
import type { DiscoveredWorld } from '../discovery/snapshot.js'

export type BotLike = EventEmitter & {
  entity?: { position: { x: number; y: number; z: number } }
  health?: number
  food?: number
  end: (reason?: string) => void
}

export type BotFactory = (opts: {
  host: string
  port: number
  username: string
  auth: 'offline'
}) => BotLike

type BotState = 'joining' | 'ready' | 'error'

type Entry = {
  world: DiscoveredWorld
  username: string
  bot: BotLike
  state: BotState
  error?: string
}

export class BotManager {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly factory: BotFactory) {}

  join(world: DiscoveredWorld, username: string): void {
    const existing = this.entries.get(world.worldName)
    if (existing && existing.state !== 'error') return

    const bot = this.factory({ host: world.host, port: world.port, username, auth: 'offline' })
    const entry: Entry = { world, username, bot, state: 'joining' }
    this.entries.set(world.worldName, entry)

    const fail = (error: string) => {
      entry.state = 'error'
      entry.error = error
      console.error(`bot ${world.worldName}: ${error}`)
    }
    bot.on('spawn', () => {
      entry.state = 'ready'
    })
    bot.on('error', (e: unknown) => fail(`error: ${String(e)}`))
    bot.on('kicked', (reason: unknown) => fail(`kicked: ${String(reason)}`))
    bot.on('end', (reason: unknown) => {
      if (entry.state !== 'error') fail(`connection ended: ${String(reason)}`)
    })
  }

  list() {
    return [...this.entries.values()].map((e) => ({
      worldName: e.world.worldName,
      username: e.username,
      state: e.state,
      ...(e.error ? { error: e.error } : {}),
      ...(e.state === 'ready' && e.bot.entity ? { position: e.bot.entity.position } : {}),
      ...(e.state === 'ready' && e.bot.health !== undefined ? { health: e.bot.health } : {}),
      ...(e.state === 'ready' && e.bot.food !== undefined ? { food: e.bot.food } : {}),
    }))
  }

  get(worldName: string): { bot: BotLike; state: BotState } | undefined {
    const e = this.entries.get(worldName)
    return e ? { bot: e.bot, state: e.state } : undefined
  }

  endAll(): void {
    for (const e of this.entries.values()) {
      try {
        e.bot.end('devrig-craft shutdown')
      } catch (err) {
        console.error('bot end failed:', err)
      }
    }
    this.entries.clear()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/botManager.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/botManager.ts test/botManager.test.ts
git commit -m "Track bot lifecycle per world: joining/ready/error with injectable factory"
```

---

### Task 8: MCP server with all 8 tools

**Files:**
- Create: `src/server.ts`, `src/runtime/mineflayerFactory.ts`
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: `buildSnapshot`/`DiscoveredWorld` (Task 4), real sources (Task 5), `executeScript`/`ScriptError` (Task 6), `BotManager`/`BotFactory` (Task 7), recipe loader placeholder (full corpus in Task 9).
- Produces:
  - `createCraftServer(deps: { lan: LanSource; ping: PingSource; botFactory: BotFactory; recipesDir?: string; extraPorts?: number[] }): McpServer` — registers exactly the 8 tools; testable over `InMemoryTransport`.
  - `src/runtime/mineflayerFactory.ts` exports `mineflayerFactory: BotFactory` that calls `mineflayer.createBot(...)` and loads `mineflayer-pathfinder`; it also attaches `bot.craftScope()` returning `{ bot, Vec3, mcData, waitFor }` for the sandbox.
  - Tool behaviors (each responds `{ content: [{ type: 'text', text }] }`):
    - `craft_list_worlds` (no params): JSON array of the current snapshot (calls `buildSnapshot` fresh — stateless).
    - `craft_list_bots` (no params): JSON of `botManager.list()`.
    - `craft_join_world` (`world_name`, optional `username` default `devrig`): resolves the world from a fresh snapshot; unknown name → error text listing known `world_name`s; incompatible version → error text with the supported range; otherwise `botManager.join(...)` and returns "joining — poll craft_list_bots until state=ready".
    - `craft_execute_code` (`world_name`, `code`, `task_id`, `reason`, optional `timeout` seconds default 120): requires a `ready` bot (else error text telling the caller to join/poll); runs `executeScript(code, scope, timeout*1000)`; on `ScriptError` returns `isError: true` with message + stack.
    - `craft_fetch_resource` (`uri`): serves the recipe markdown (Task 9 fills the corpus; until then, unknown URI → error text listing known URIs).
    - `craft_chat` (`world_name`, `text`, `task_id`, `reason`): `bot.chat(text)`; description carries the "HEAVY — prefer craft_execute_code with bot.chat(...)" steering.
    - `craft_take_screenshot` (`world_name`, `task_id`, `reason`): tries `import('prismarine-viewer')`; on any failure returns error text "screenshot unavailable on this host (headless-gl) — verify via bot.blockAt sweeps instead". Success path renders one frame to a temp PNG and returns its path. Best-effort by spec §12.
    - `craft_execute_feedback` (`task_id`, `execution_id`, `success_rating` 0..1, `explanation`): appends one JSON line to `stderr` log; returns "recorded".
- ALL logging goes to stderr — stdout is the JSON-RPC channel (never `console.log`).

- [ ] **Step 1: Write the failing test**

`test/server.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCraftServer } from '../src/server.js'
import type { BotLike } from '../src/runtime/botManager.js'

class FakeBot extends EventEmitter implements BotLike {
  entity = { position: { x: 0, y: 64, z: 0 } }
  health = 20
  food = 20
  lastChat = ''
  chat(text: string) {
    this.lastChat = text
  }
  blockAt() {
    return { name: 'stone' }
  }
  end() {}
}

const EXPECTED_TOOLS = [
  'craft_list_worlds',
  'craft_list_bots',
  'craft_join_world',
  'craft_execute_code',
  'craft_fetch_resource',
  'craft_take_screenshot',
  'craft_chat',
  'craft_execute_feedback',
]

describe('craft MCP server', () => {
  let client: Client
  let bot: FakeBot

  beforeEach(async () => {
    bot = new FakeBot()
    const server = createCraftServer({
      lan: async () => [{ motd: 'test world', port: 7777, host: '127.0.0.1' }],
      ping: async () => ({ version: '1.21.4' }),
      botFactory: () => bot,
    })
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test', version: '0.0.0' })
    await Promise.all([server.connect(serverT), client.connect(clientT)])
  })

  function text(result: any): string {
    return result.content[0].text as string
  }

  it('registers exactly the 8 mirrored tools', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(tools).toEqual([...EXPECTED_TOOLS].sort())
  })

  it('lists discovered worlds with routing keys', async () => {
    const res = await client.callTool({ name: 'craft_list_worlds', arguments: {} })
    const worlds = JSON.parse(text(res))
    expect(worlds[0]).toMatchObject({ worldName: 'test-world', version: '1.21.4', compatible: true })
  })

  it('join → poll → execute_code round trip', async () => {
    await client.callTool({ name: 'craft_join_world', arguments: { world_name: 'test-world' } })
    bot.emit('spawn')
    const bots = JSON.parse(text(await client.callTool({ name: 'craft_list_bots', arguments: {} })))
    expect(bots[0]).toMatchObject({ worldName: 'test-world', state: 'ready' })

    const res = await client.callTool({
      name: 'craft_execute_code',
      arguments: {
        world_name: 'test-world',
        code: 'print(bot.blockAt().name)',
        task_id: 't1',
        reason: 'test',
      },
    })
    expect(text(res)).toBe('stone')
  })

  it('execute_code against a non-ready bot returns guidance, not a crash', async () => {
    const res = await client.callTool({
      name: 'craft_execute_code',
      arguments: { world_name: 'test-world', code: 'print(1)', task_id: 't', reason: 'r' },
    })
    expect(res.isError).toBe(true)
    expect(text(res)).toContain('craft_join_world')
  })

  it('join_world rejects unknown names with the known list', async () => {
    const res = await client.callTool({ name: 'craft_join_world', arguments: { world_name: 'nope' } })
    expect(res.isError).toBe(true)
    expect(text(res)).toContain('test-world')
  })

  it('script errors surface as isError with the message', async () => {
    await client.callTool({ name: 'craft_join_world', arguments: { world_name: 'test-world' } })
    bot.emit('spawn')
    const res = await client.callTool({
      name: 'craft_execute_code',
      arguments: { world_name: 'test-world', code: 'throw new Error("boom")', task_id: 't', reason: 'r' },
    })
    expect(res.isError).toBe(true)
    expect(text(res)).toContain('boom')
  })

  it('craft_chat relays through the bot', async () => {
    await client.callTool({ name: 'craft_join_world', arguments: { world_name: 'test-world' } })
    bot.emit('spawn')
    await client.callTool({
      name: 'craft_chat',
      arguments: { world_name: 'test-world', text: 'hello', task_id: 't', reason: 'r' },
    })
    expect(bot.lastChat).toBe('hello')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server.ts` (tool descriptions abbreviated here to the load-bearing sentences — write them in full steroid house style in code):

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { buildSnapshot, type DiscoveredWorld, type LanSource, type PingSource, SUPPORTED_RANGE } from './discovery/snapshot.js'
import { BotManager, type BotFactory, type BotLike } from './runtime/botManager.js'
import { executeScript, ScriptError } from './runtime/sandbox.js'
import { SERVER_NAME, SERVER_VERSION } from './version.js'

export type CraftServerDeps = {
  lan: LanSource
  ping: PingSource
  botFactory: BotFactory
  recipesDir?: string
  extraPorts?: number[]
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

export function createCraftServer(deps: CraftServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
  const bots = new BotManager(deps.botFactory)
  const snapshot = () => buildSnapshot(deps.lan, deps.ping, deps.extraPorts ?? [25565])

  server.registerTool(
    'craft_list_worlds',
    {
      description:
        'List running Minecraft worlds this machine can join: LAN-opened singleplayer worlds ' +
        '(any launcher, incl. Prism) and local offline-mode servers. Returns world_name — the ' +
        'routing key for every other tool. Rebuilt fresh on every call.',
      inputSchema: {},
    },
    async () => ok(JSON.stringify(await snapshot(), null, 2)),
  )

  server.registerTool(
    'craft_list_bots',
    {
      description:
        'List live bots and their readiness (joining/ready/error), position, health, food. ' +
        'Poll this after craft_join_world until state=ready.',
      inputSchema: {},
    },
    async () => ok(JSON.stringify(bots.list(), null, 2)),
  )

  server.registerTool(
    'craft_join_world',
    {
      description:
        'ASYNC: start joining a discovered world as a bot. Returns immediately; poll ' +
        'craft_list_bots until state=ready before calling craft_execute_code.',
      inputSchema: {
        world_name: z.string().describe('routing key from craft_list_worlds'),
        username: z.string().optional().describe('bot username, default "devrig"'),
      },
    },
    async ({ world_name, username }) => {
      const worlds = await snapshot()
      const world = worlds.find((w) => w.worldName === world_name)
      if (!world)
        return err(
          `Unknown world_name "${world_name}". Known: ${worlds.map((w) => w.worldName).join(', ') || '(none — is a world Open to LAN?)'}`,
        )
      if (!world.compatible)
        return err(
          `World "${world_name}" runs ${world.version ?? 'an unknown version'}; supported range is ${SUPPORTED_RANGE[0]}–${SUPPORTED_RANGE[1]}.`,
        )
      bots.join(world, username ?? 'devrig')
      return ok(`Joining "${world_name}" as ${username ?? 'devrig'} — poll craft_list_bots until state=ready.`)
    },
  )

  server.registerTool(
    'craft_execute_code',
    {
      description:
        'THE main tool. Execute JavaScript with the full mineflayer API in scope: bot (with ' +
        'pathfinder loaded), Vec3, mcData, print/printJson/sleep/waitFor. The response contains ' +
        'ONLY what the script prints. Read mcp-craft://prompt/skill first for recipes. Verify ' +
        'builds via bot.blockAt sweeps, not screenshots.',
      inputSchema: {
        world_name: z.string(),
        code: z.string().describe('body of an async function; top-level await works'),
        task_id: z.string().describe('reuse across related calls to group audit logs'),
        reason: z.string().describe('full task description of intent and expected outcome'),
        timeout: z.number().optional().describe('seconds, default 120'),
      },
    },
    async ({ world_name, code, timeout }) => {
      const entry = bots.get(world_name)
      if (!entry || entry.state !== 'ready')
        return err(
          `No ready bot in "${world_name}" (state: ${entry?.state ?? 'none'}). Call craft_join_world, then poll craft_list_bots until state=ready.`,
        )
      try {
        const scope = craftScope(entry.bot)
        return ok(await executeScript(code, scope, (timeout ?? 120) * 1000))
      } catch (e) {
        if (e instanceof ScriptError) return err(`${e.message}\n${e.scriptStack ?? ''}`.trim())
        throw e
      }
    },
  )

  server.registerTool(
    'craft_fetch_resource',
    {
      description:
        'Fetch an mcp-craft:// recipe article — copy-paste JS for building, navigation, ' +
        'inventory, world queries. Start at mcp-craft://prompt/skill.',
      inputSchema: { uri: z.string() },
    },
    async ({ uri }) => {
      const article = await loadRecipe(deps.recipesDir, uri)
      return article ? ok(article) : err(`Unknown URI "${uri}". Known: ${(await listRecipeUris(deps.recipesDir)).join(', ')}`)
    },
  )

  server.registerTool(
    'craft_chat',
    {
      description:
        'HEAVY/debug: send one raw chat line or slash-command. Prefer craft_execute_code with ' +
        'bot.chat(...) so sends compose with logic and verification.',
      inputSchema: { world_name: z.string(), text: z.string(), task_id: z.string(), reason: z.string() },
    },
    async ({ world_name, text }) => {
      const entry = bots.get(world_name)
      if (!entry || entry.state !== 'ready') return err(`No ready bot in "${world_name}".`)
      ;(entry.bot as BotLike & { chat: (t: string) => void }).chat(text)
      return ok('sent')
    },
  )

  server.registerTool(
    'craft_take_screenshot',
    {
      description:
        'HEAVY ENDPOINT, best-effort: render the bot POV to a PNG (prismarine-viewer headless). ' +
        'For verification prefer craft_execute_code with bot.blockAt sweeps — this is for humans.',
      inputSchema: { world_name: z.string(), task_id: z.string(), reason: z.string() },
    },
    async ({ world_name }) => {
      const entry = bots.get(world_name)
      if (!entry || entry.state !== 'ready') return err(`No ready bot in "${world_name}".`)
      try {
        const path = await renderScreenshot(entry.bot)
        return ok(`screenshot written: ${path}`)
      } catch (e) {
        console.error('screenshot failed:', e)
        return err('screenshot unavailable on this host (headless-gl) — verify via bot.blockAt sweeps instead')
      }
    },
  )

  server.registerTool(
    'craft_execute_feedback',
    {
      description: 'Rate a prior craft_execute_code call 0.00–1.00 with an explanation; logged for tuning.',
      inputSchema: {
        task_id: z.string(),
        execution_id: z.string(),
        success_rating: z.number().min(0).max(1),
        explanation: z.string(),
      },
    },
    async (args) => {
      console.error(`feedback: ${JSON.stringify(args)}`)
      return ok('recorded')
    },
  )

  return server
}

function craftScope(bot: BotLike): Record<string, unknown> {
  const scopeFn = (bot as BotLike & { craftScope?: () => Record<string, unknown> }).craftScope
  if (scopeFn) return scopeFn()
  // Test bots without a factory-attached scope: expose the bot plus a generic waitFor.
  return {
    bot,
    waitFor: (event: string, timeoutMs = 10000) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`waitFor("${event}") timed out after ${timeoutMs} ms`)), timeoutMs)
        bot.once(event, (...args: unknown[]) => {
          clearTimeout(t)
          resolve(args)
        })
      }),
  }
}

async function loadRecipe(recipesDir: string | undefined, uri: string): Promise<string | null> {
  if (!recipesDir) return null
  const { readFile } = await import('node:fs/promises')
  const rel = uri.replace(/^mcp-craft:\/\//, '')
  if (!/^[a-z0-9/-]+$/.test(rel)) return null
  try {
    return await readFile(`${recipesDir}/${rel}.md`, 'utf8')
  } catch {
    return null
  }
}

async function listRecipeUris(recipesDir: string | undefined): Promise<string[]> {
  if (!recipesDir) return []
  const { readdir } = await import('node:fs/promises')
  try {
    const files = await readdir(`${recipesDir}/prompt`).catch(() => [] as string[])
    const skills = await readdir(`${recipesDir}/skill`).catch(() => [] as string[])
    return [
      ...files.map((f) => `mcp-craft://prompt/${f.replace(/\.md$/, '')}`),
      ...skills.map((f) => `mcp-craft://skill/${f.replace(/\.md$/, '')}`),
    ]
  } catch {
    return []
  }
}

async function renderScreenshot(bot: BotLike): Promise<string> {
  const viewer = await import('prismarine-viewer')
  const { tmpdir } = await import('node:os')
  const path = `${tmpdir()}/devrig-craft-${Date.now()}.png`
  await (viewer as any).headlessFrame(bot, { output: path, width: 960, height: 540 })
  return path
}
```

`src/runtime/mineflayerFactory.ts`:

```ts
import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import minecraftData from 'minecraft-data'
import type { BotFactory, BotLike } from './botManager.js'

const { pathfinder } = pathfinderPkg

export const mineflayerFactory: BotFactory = ({ host, port, username, auth }) => {
  const bot = mineflayer.createBot({ host, port, username, auth })
  bot.loadPlugin(pathfinder)
  ;(bot as unknown as { craftScope: () => Record<string, unknown> }).craftScope = () => ({
    bot,
    Vec3,
    mcData: minecraftData(bot.version),
    waitFor: (event: string, timeoutMs = 10000) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error(`waitFor("${event}") timed out after ${timeoutMs} ms`)),
          timeoutMs,
        )
        bot.once(event as any, (...args: unknown[]) => {
          clearTimeout(t)
          resolve(args)
        })
      }),
  })
  return bot as unknown as BotLike
}
```

Note: `prismarine-viewer`'s single-frame headless API differs across versions — if `headlessFrame` does not exist in the installed version, adapt `renderScreenshot` to the installed API (`viewer.headless(bot, { output, frames: 1 })` in older releases) and keep the catch-all error path; the contract under test is only "success returns a path, failure returns the guidance error".

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/server.test.ts && npm test`
Expected: all PASS (screenshot tool is not exercised against a fake bot beyond registration).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/runtime/mineflayerFactory.ts test/server.test.ts
git commit -m "Register the 8 craft_* MCP tools mirroring the steroid surface"
```

---

### Task 9: Recipe corpus + fence contract test

**Files:**
- Create: `resources/recipes/prompt/skill.md`, `resources/recipes/skill/navigation.md`, `resources/recipes/skill/building.md`, `resources/recipes/skill/building-with-commands.md`, `resources/recipes/skill/inventory.md`, `resources/recipes/skill/world-queries.md`, `resources/recipes/skill/survival.md`, `resources/recipes/skill/design-philosophy.md`
- Test: `test/recipes.test.ts`

**Interfaces:**
- Consumes: `loadRecipe`/`listRecipeUris` behavior (Task 8) — files live under `resources/recipes/` and map `mcp-craft://<prompt|skill>/<name>` → `resources/recipes/<prompt|skill>/<name>.md`.
- Produces: 8 markdown articles whose every ```js fence is a valid `craft_execute_code` body.

Content requirements per article (write full articles, not stubs; each 40–120 lines with at least one complete copy-paste ```js block):

- `prompt/skill.md` — index of all URIs + the philosophy note: few tools, power in execute_code + recipes; verify via API not pixels.
- `skill/navigation.md` — pathfinder: `const { goals, Movements } = bot.pathfinder ? require('mineflayer-pathfinder') : ...` — NO. Use the loaded plugin idiom: `bot.pathfinder.setMovements(new Movements(bot))` is set up by the factory; recipe shows `const { goals } = await import('mineflayer-pathfinder')` alternative and the canonical `bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1))`, stuck recovery (timeout + re-goal), following a player.
- `skill/building.md` — the promo happy path: pick a flat spot near the player, creative flight, `bot.placeBlock(referenceBlock, faceVector)` loop for a 5×5 house with door gap + torches; equipping blocks with `bot.creative.setInventorySlot`; reach/facing constraints (≤4.5 blocks, must look at the face); ends with a blockAt verification sweep printing a diff of expected vs actual.
- `skill/building-with-commands.md` — detect cheats (`bot.game.gameMode`, try `/gamemode`), `/fill` and `/setblock` via `bot.chat`, when to prefer this (large builds), always verify after.
- `skill/inventory.md` — creative `setInventorySlot` with `mcData.itemsByName`, survival crafting via `bot.craft`, counting items.
- `skill/world-queries.md` — `bot.blockAt(new Vec3(...))`, `bot.findBlocks({ matching, maxDistance, count })`, entity queries via `bot.entities`; THE verification pattern (assert-what-you-built) as the article's centerpiece.
- `skill/survival.md` — food/health monitoring, eating, night/mob basics to keep demos alive.
- `skill/design-philosophy.md` — the tenets mapped to Minecraft, table of `craft_*` ↔ `steroid_*`, links to devrig.dev and github.com/jonnyzzz/mcp-steroid. This is the marketing payload.

- [ ] **Step 1: Write the failing contract test**

`test/recipes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import vm from 'node:vm'

const RECIPES = 'resources/recipes'

async function allArticles(): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = []
  for (const dir of ['prompt', 'skill']) {
    for (const f of await readdir(`${RECIPES}/${dir}`)) {
      out.push({ path: `${dir}/${f}`, text: await readFile(`${RECIPES}/${dir}/${f}`, 'utf8') })
    }
  }
  return out
}

function jsFences(md: string): string[] {
  return [...md.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]!)
}

describe('recipe corpus', () => {
  it('ships the 8 spec articles', async () => {
    const paths = (await allArticles()).map((a) => a.path).sort()
    expect(paths).toEqual(
      [
        'prompt/skill.md',
        'skill/building-with-commands.md',
        'skill/building.md',
        'skill/design-philosophy.md',
        'skill/inventory.md',
        'skill/navigation.md',
        'skill/survival.md',
        'skill/world-queries.md',
      ].sort(),
    )
  })

  it('every article has at least one js fence, except the two prose articles', async () => {
    const proseOnly = new Set(['prompt/skill.md', 'skill/design-philosophy.md'])
    for (const a of await allArticles()) {
      if (proseOnly.has(a.path)) continue
      expect(jsFences(a.text).length, `${a.path} needs a js fence`).toBeGreaterThan(0)
    }
  })

  it('every js fence parses as an async execute_code body', async () => {
    for (const a of await allArticles()) {
      for (const [i, fence] of jsFences(a.text).entries()) {
        expect(
          () => new vm.Script(`(async () => {\n${fence}\n})`),
          `${a.path} fence #${i} must parse`,
        ).not.toThrow()
      }
    }
  })

  it('the index lists every skill URI', async () => {
    const index = await readFile(`${RECIPES}/prompt/skill.md`, 'utf8')
    for (const name of ['navigation', 'building', 'building-with-commands', 'inventory', 'world-queries', 'survival', 'design-philosophy']) {
      expect(index).toContain(`mcp-craft://skill/${name}`)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/recipes.test.ts`
Expected: FAIL — `resources/recipes/prompt` does not exist.

- [ ] **Step 3: Write the 8 articles**

Write each article per the content requirements above. Sample fence style (from `skill/building.md`) — every fence must be a complete runnable `craft_execute_code` body like this:

```js
// Build a 5x5 stone platform at the bot's feet (creative mode).
const base = bot.entity.position.floored().offset(-2, -1, -2)
const stone = mcData.itemsByName['stone']
await bot.creative.setInventorySlot(36, new (require('prismarine-item')(bot.version))(stone.id, 64))
let placed = 0
for (let dx = 0; dx < 5; dx++) {
  for (let dz = 0; dz < 5; dz++) {
    const target = base.offset(dx, 0, dz)
    if (bot.blockAt(target)?.name === 'stone') continue
    const below = bot.blockAt(target.offset(0, -1, 0))
    await bot.placeBlock(below, new Vec3(0, 1, 0))
    placed++
  }
}
print(`placed ${placed} blocks`)
// Verify — never trust the loop:
let missing = 0
for (let dx = 0; dx < 5; dx++)
  for (let dz = 0; dz < 5; dz++)
    if (bot.blockAt(base.offset(dx, 0, dz))?.name !== 'stone') missing++
print(missing === 0 ? 'VERIFIED: platform complete' : `INCOMPLETE: ${missing} blocks missing`)
```

(The exact placement idioms — creative slot index, prismarine-item construction — must be validated against the pinned mineflayer version during Task 12's integration run; fix the recipes there if the API differs. The contract test in this task only guarantees they parse.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/recipes.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Wire the recipes dir into the server test**

Add to `test/server.test.ts` `beforeEach` deps: `recipesDir: 'resources/recipes'`, plus one test:

```ts
it('fetches a recipe by mcp-craft URI', async () => {
  const res = await client.callTool({
    name: 'craft_fetch_resource',
    arguments: { uri: 'mcp-craft://skill/building' },
  })
  expect(text(res)).toContain('placeBlock')
})
```

Run: `npm test` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add resources/recipes test/recipes.test.ts test/server.test.ts
git commit -m "Ship the mcp-craft:// recipe corpus with a js-fence parse contract"
```

---

### Task 10: CLI entry point

**Files:**
- Create: `src/cli.ts`
- Modify: `src/server.ts` (no changes expected — verify `createCraftServer` needs nothing new)
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `createCraftServer` (Task 8), real sources (Task 5), `mineflayerFactory` (Task 8).
- Produces: `devrig-craft` binary: no args (or `mcp`) → stdio MCP server; `worlds` → one-shot discovery print to stdout (human/debug); `--version`.

- [ ] **Step 1: Write the failing test**

`test/cli.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

describe('cli', () => {
  it('prints the version', async () => {
    const { stdout } = await run('npx', ['tsx', 'src/cli.ts', '--version'])
    expect(stdout.trim()).toBe('devrig-craft 0.1.0')
  })

  it('worlds subcommand prints a JSON array (empty is fine)', async () => {
    const { stdout } = await run('npx', ['tsx', 'src/cli.ts', 'worlds', '--window-ms', '200'])
    expect(() => JSON.parse(stdout)).not.toThrow()
  })
})
```

Add `tsx` to devDependencies: `npm install -D tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli.test.ts`
Expected: FAIL — cli.ts missing.

- [ ] **Step 3: Write the implementation**

`src/cli.ts`:

```ts
#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createCraftServer } from './server.js'
import { collectLanAnnouncements, pingWorld } from './discovery/sources.js'
import { buildSnapshot } from './discovery/snapshot.js'
import { mineflayerFactory } from './runtime/mineflayerFactory.js'
import { SERVER_NAME, SERVER_VERSION } from './version.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2)

function flag(name: string, fallback: number): number {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback
}

async function main() {
  if (args.includes('--version')) {
    console.log(`${SERVER_NAME} ${SERVER_VERSION}`)
    return
  }
  if (args[0] === 'worlds') {
    const windowMs = flag('--window-ms', 1800)
    const worlds = await buildSnapshot(() => collectLanAnnouncements(windowMs), pingWorld, [25565])
    console.log(JSON.stringify(worlds, null, 2))
    return
  }
  // Default: stdio MCP server. stdout is JSON-RPC — everything else goes to stderr.
  const recipesDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'resources', 'recipes')
  const server = createCraftServer({
    lan: () => collectLanAnnouncements(),
    ping: pingWorld,
    botFactory: mineflayerFactory,
    recipesDir,
  })
  await server.connect(new StdioServerTransport())
  console.error(`${SERVER_NAME} ${SERVER_VERSION} listening on stdio`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

Note the recipes path: when running from `dist/cli.js`, `dirname(dirname(...))` is the package root — `resources/` ships in the npm package (add `"files": ["dist", "resources"]` to `package.json`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/cli.test.ts && npm run build && npm test`
Expected: all PASS; build clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/cli.test.ts package.json package-lock.json
git commit -m "Add devrig-craft CLI: stdio MCP server plus one-shot worlds discovery"
```

---

### Task 11: README with the tenet mapping

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything shipped; the marketing story from `docs/design.md` §1, §10.

- [ ] **Step 1: Write README.md**

Required sections (write in full, promo-quality prose):

1. Hero: "devrig plays Minecraft" — one paragraph: the philosophy behind devrig/MCP Steroid (narrow tool surface, one code-execution tool, recipes) applied to Minecraft; 30-narrow-tools vs 8-tools-one-script comparison with the 10×10-platform tool-call count.
2. Quickstart: open a world → Esc → *Open to LAN* (enable cheats) → `claude mcp add --scope user devrig-craft -- npx devrig-craft` → "build me a house".
3. The 8 tools table (`craft_*` ↔ `steroid_*`, one line each).
4. How discovery works (UDP 4445 + Server List Ping; no mods, no launcher integration — Prism "just works").
5. Supported versions (the pinned range from `SUPPORTED_RANGE`), LAN/offline-only limitation, screenshot best-effort caveat.
6. Links: devrig.dev, github.com/jonnyzzz/mcp-steroid, `docs/design.md`.

- [ ] **Step 2: Verify quickstart honesty**

Run: `npm run build && node dist/cli.js --version` — confirm the commands in the README are the commands that work.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Write README: devrig philosophy mapped to Minecraft, quickstart, tool table"
```

---

### Task 12: Docker integration smoke test

**Files:**
- Create: `test-integration/smoke.test.ts`, `test-integration/docker.ts`

**Interfaces:**
- Consumes: the built server (`createCraftServer` with real ping + `mineflayerFactory`), `pingWorld` (Task 5).
- Produces: CI-runnable proof of the whole loop: discover (ping path) → join → execute_code builds a 3×3 platform → blockAt verifies. Runs ONLY via `npm run test:integration` (needs Docker; never auto-skips at runtime — if Docker is missing the test fails, per the no-skip-detection constraint).

- [ ] **Step 1: Write the docker helper**

`test-integration/docker.ts`:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)

const IMAGE = 'itzg/minecraft-server:java21'
export const MC_VERSION = '1.21.4'
export const MC_PORT = 25599

export async function startServer(): Promise<string> {
  const { stdout } = await run('docker', [
    'run', '-d', '--rm',
    '-e', 'EULA=TRUE',
    '-e', `VERSION=${MC_VERSION}`,
    '-e', 'ONLINE_MODE=FALSE',
    '-e', 'MODE=creative',
    '-e', 'OP_PERMISSION_LEVEL=4',
    '-p', `${MC_PORT}:25565`,
    IMAGE,
  ])
  return stdout.trim()
}

export async function stopServer(id: string): Promise<void> {
  await run('docker', ['stop', id])
}

export async function waitForReady(timeoutMs = 300000): Promise<void> {
  const { pingWorld } = await import('../src/discovery/sources.js')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await pingWorld('127.0.0.1', MC_PORT)) return
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`Minecraft server not ready after ${timeoutMs} ms`)
}
```

- [ ] **Step 2: Write the smoke test**

`test-integration/smoke.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCraftServer } from '../src/server.js'
import { pingWorld } from '../src/discovery/sources.js'
import { mineflayerFactory } from '../src/runtime/mineflayerFactory.js'
import { startServer, stopServer, waitForReady, MC_PORT } from './docker.js'

let containerId: string
let client: Client

const text = (r: any) => r.content[0].text as string

beforeAll(async () => {
  containerId = await startServer()
  await waitForReady()
  const server = createCraftServer({
    lan: async () => [],
    ping: pingWorld,
    botFactory: mineflayerFactory,
    recipesDir: 'resources/recipes',
    extraPorts: [MC_PORT],
  })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'smoke', version: '0.0.0' })
  await Promise.all([server.connect(st), client.connect(ct)])
}, 360000)

afterAll(async () => {
  if (containerId) await stopServer(containerId)
})

describe('end-to-end smoke', () => {
  it('discovers the dockerized server', async () => {
    const worlds = JSON.parse(text(await client.callTool({ name: 'craft_list_worlds', arguments: {} })))
    expect(worlds.some((w: any) => w.port === MC_PORT && w.compatible)).toBe(true)
  })

  it('joins, builds a 3x3 platform via execute_code, and verifies it', async () => {
    const worlds = JSON.parse(text(await client.callTool({ name: 'craft_list_worlds', arguments: {} })))
    const worldName = worlds.find((w: any) => w.port === MC_PORT).worldName

    await client.callTool({ name: 'craft_join_world', arguments: { world_name: worldName } })
    for (let i = 0; i < 60; i++) {
      const bots = JSON.parse(text(await client.callTool({ name: 'craft_list_bots', arguments: {} })))
      if (bots[0]?.state === 'ready') break
      if (bots[0]?.state === 'error') throw new Error(bots[0].error)
      await new Promise((r) => setTimeout(r, 1000))
    }

    // Op the bot via server console so /setblock works, then build via commands
    // (the command path is deterministic; the placeBlock path is exercised by the
    // building recipe during manual demo validation).
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    await promisify(execFile)('docker', ['exec', containerId, 'rcon-cli', 'op', 'devrig'])

    const res = await client.callTool({
      name: 'craft_execute_code',
      arguments: {
        world_name: worldName,
        code: `
const base = bot.entity.position.floored().offset(2, 0, 2)
for (let dx = 0; dx < 3; dx++)
  for (let dz = 0; dz < 3; dz++)
    bot.chat('/setblock ' + (base.x + dx) + ' ' + base.y + ' ' + (base.z + dz) + ' minecraft:stone')
await sleep(3000)
let ok = 0
for (let dx = 0; dx < 3; dx++)
  for (let dz = 0; dz < 3; dz++)
    if (bot.blockAt(base.offset(dx, 0, dz))?.name === 'stone') ok++
print('stone blocks verified: ' + ok + '/9')
`,
        task_id: 'smoke',
        reason: 'integration smoke: build and verify a 3x3 platform',
      },
    })
    expect(text(res)).toBe('stone blocks verified: 9/9')
  }, 300000)
})
```

- [ ] **Step 3: Run the integration test**

Run: `npm run test:integration`
Expected: 2 PASS (first run pulls the image and generates a world — minutes). If the mineflayer/recipe idioms from Task 9 turn out wrong against this pinned version, fix the recipes now and re-run `npm test` too.

- [ ] **Step 4: Commit**

```bash
git add test-integration/smoke.test.ts test-integration/docker.ts
git commit -m "Add dockerized end-to-end smoke: discover, join, build, blockAt-verify"
```

---

### Task 13: Manual Prism/LAN validation script (docs only)

**Files:**
- Create: `docs/manual-demo.md`

**Interfaces:**
- Consumes: the shipped CLI (Task 10), README quickstart (Task 11).

- [ ] **Step 1: Write the manual validation checklist**

`docs/manual-demo.md` — the exact demo script, each step with its expected observation:

1. Launch a 1.21.x instance from Prism Launcher, create/open a singleplayer creative world with cheats ON.
2. Esc → *Open to LAN* → note the port in chat.
3. `node dist/cli.js worlds` → expect a JSON entry with `source: "lan"`, the same port, `compatible: true`.
4. `claude mcp add --scope user devrig-craft -- npx devrig-craft` (note `--scope user` — Claude defaults to project-local).
5. In Claude Code: "Find my running Minecraft world and build a small house with a door and torches next to me. Verify it block-by-block when done."
6. Expected tool sequence: `craft_list_worlds` → `craft_join_world` → poll `craft_list_bots` → `craft_fetch_resource(building)` → `craft_execute_code` (1–3 calls) → verification sweep output.
7. In-game observation: the `devrig` bot appears, flies to a flat spot, places the house; chat shows nothing except any `/`-commands it chose to use.
8. Record: total tool calls, tokens, wall time — the numbers for the promo table.

- [ ] **Step 2: Execute the checklist once on this machine and fix what breaks**

This is the M2 gate: the LAN announce parser, join flow, and building recipes have now met a real Prism instance. File and fix issues before calling M1+M2 done.

- [ ] **Step 3: Commit**

```bash
git add docs/manual-demo.md
git commit -m "Document the Prism LAN manual demo checklist (M2 gate)"
```

---

## Self-review notes

- Spec coverage: §4 discovery → Tasks 2–5; §5 tools → Task 8; §6 runtime → Tasks 6–8; §7 recipes → Task 9; §8 build modes → recipes (building.md / building-with-commands.md); §9 testing → Tasks 1–12 unit + Task 12 integration; §10–11 promo/M-milestones → Tasks 11, 13 cover M1+M2 scope; M3 (comparison harness, video) is intentionally out of this plan — separate plan once M2 is validated.
- Known API risk concentrated in two places by design: `prismarine-viewer` single-frame rendering (Task 8 note) and creative-inventory idioms in recipes (Task 9 note, validated in Task 12/13). Both have explicit fix-here instructions.
- Type consistency: `DiscoveredWorld.worldName` (camelCase internal) vs `world_name` (snake_case MCP params) is deliberate and consistent throughout: JSON output uses `worldName`, tool params use `world_name`.
