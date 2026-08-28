# devrig-craft M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Revision 2 (2026-08-28): incorporates the accepted findings of the plan
review (`docs/m1-plan-review.md`, PR #2). M2 scope moved to
`docs/plans/2026-08-28-devrig-craft-m2.md`.

**Goal:** A stdio MCP server (`devrig-craft`) that discovers running Minecraft worlds (LAN-opened clients such as Prism Launcher instances, or local offline-mode servers), joins them as a mineflayer bot, and drives the game through one code-execution tool plus a recipe corpus — mirroring the MCP Steroid tool surface 1:1.

**Architecture:** One Node/TypeScript process: a stateless stdio MCP server whose discovery snapshot is rebuilt on demand per call (UDP 4445 multicast + Server List Ping), an in-process bot manager (one mineflayer bot per joined world, dies with the process), and a `vm`-sandboxed `craft_execute_code` runtime where the script's printed output is the entire tool response (after an `execution_id` line).

**Tech Stack:** Node 22+, TypeScript 5 (ESM), `@modelcontextprotocol/sdk`, `zod`, `mineflayer`, `mineflayer-pathfinder`, `minecraft-protocol` (ping), `minecraft-data`, `prismarine-item`, `vec3`, `vitest`.

**Spec:** `docs/design.md` (this repo) — read it before starting; every contract below argues from it. §2 (security non-goal), §6 (runtime limits) and §13 (decisions log) are load-bearing for this plan.

**M1 gate:** `npm test` green (typecheck + unit + pack smoke) and the Task 12 Docker smoke passing on a clean machine.

## Global Constraints

- Exactly 8 MCP tools, named: `craft_list_worlds`, `craft_list_bots`, `craft_join_world`, `craft_execute_code`, `craft_fetch_resource`, `craft_take_screenshot`, `craft_chat`, `craft_execute_feedback`. No additional tools (spec §5, Tenet 1). In M1 `craft_take_screenshot` ships only its tested error branch (spec §5).
- The CLI is stateless: no state files on disk except the feedback JSONL in the OS temp dir; discovery snapshot rebuilt on demand per call; in-memory bot registry dies with the process (spec §3, Tenet 3).
- `craft_execute_code` scope is exactly: `bot`, `Vec3`, `mcData`, `goals`, `Movements`, `Item`, `print`, `printJson`, `sleep`, `waitFor` — nothing else; no `require`, no dynamic `import`, no Node globals (spec §6). The response is `execution_id: <uuid>` then only what the script printed; a print-less success returns one HINT line.
- Runtime limits (spec §6): `code` ≤ 100 000 chars; `timeout` 1–600 s (default 120); output capped ~2000 lines / 256 KB with middle truncation keeping the tail. Timeout force-disconnects the bot. Synchronous infinite loops hang the process — documented, not defended.
- Executions are serialized per world: concurrent `craft_execute_code`/`craft_chat` against a busy bot returns an explicit "bot busy" error (spec §5).
- All JSON tool output uses snake_case keys; camelCase never crosses the MCP boundary (spec §5).
- No client/server mods; LAN worlds + offline-mode local servers only; bot username defaults to `devrig` (spec §2, §4).
- M1 recipes are 4 articles (spec §7); every ```js fence must **type-check** (`tsc --noEmit` against a scope prelude), not merely parse.
- ALL logging goes to stderr — stdout is the JSON-RPC channel (never `console.log` on the server path).
- Unit tests must not require a running Minecraft server or touch the real LAN port 4445. Integration tests run only via `npm run test:integration` (needs Docker; never auto-skips at runtime).
- Commit style: imperative, what+why, no AI co-author mentions.

## File structure

```
src/version.ts                    constants
src/discovery/lanParser.ts        pure datagram parser
src/discovery/slug.ts             world_name allocation
src/discovery/snapshot.ts         snapshot builder (DI sources)
src/discovery/sources.ts          real UDP listener + Server List Ping
src/runtime/sandbox.ts            vm execution, limits, error shaping
src/runtime/botManager.ts         bot lifecycle + per-world lock
src/runtime/mineflayerFactory.ts  real bot factory + script scope
src/wire.ts                       camelCase→snake_case boundary mapper
src/server.ts                     the 8 MCP tools
src/cli.ts                        stdio entry, flags, signals
resources/recipes/                mcp-craft:// corpus
test/                             unit tests
test-integration/                 Docker smoke
.github/workflows/ci.yml          unit per PR, integration on demand
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, `.gitignore`, `src/version.ts`, `test/version.test.ts`

**Interfaces:**
- Produces: ESM TypeScript project where `npm test` = typecheck (src + tests) + vitest; `SERVER_NAME = 'devrig-craft'`, `SERVER_VERSION` exported from `src/version.ts`; `files` whitelist already carries `dist` + `resources` for the Task 10 pack smoke.

- [ ] **Step 1: Write config files**

`package.json` (note: `minecraft-data` and `prismarine-item` are declared directly — both are used by `src/`, and relying on transitive resolution through mineflayer is a latent break):

```json
{
  "name": "devrig-craft",
  "version": "0.1.0",
  "description": "devrig plays Minecraft — MCP Steroid philosophy, Minecraft host",
  "type": "module",
  "license": "Apache-2.0",
  "bin": { "devrig-craft": "dist/cli.js" },
  "files": ["dist", "resources"],
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.test.json --noEmit",
    "test": "npm run typecheck && vitest run test",
    "test:pack": "npm run build && npm pack --pack-destination build && tar -tf build/devrig-craft-0.1.0.tgz | grep -q package/resources/recipes/prompt/skill.md && npx --yes ./build/devrig-craft-0.1.0.tgz --version",
    "test:integration": "vitest run test-integration --testTimeout 600000"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "mineflayer": "^4.20.0",
    "mineflayer-pathfinder": "^2.4.5",
    "minecraft-protocol": "^1.47.0",
    "minecraft-data": "^3.0.0",
    "prismarine-item": "^1.15.0",
    "vec3": "^0.1.10",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "tsx": "^4.19.0",
    "@types/node": "^22.0.0"
  }
}
```

After `npm install`, align the two pinned ranges with reality: `npm ls minecraft-data prismarine-item` and set the ranges to what the installed mineflayer actually pulls, so both resolve to a single copy.

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

`tsconfig.test.json` (typechecks tests too — vitest transpiles without checking, so without this a typo in a test surfaces as an obscure runtime error):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "test", "test-integration"]
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
build/
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
Expected: typecheck clean, 1 test PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json tsconfig.json tsconfig.test.json vitest.config.ts .gitignore src/version.ts test/version.test.ts package-lock.json
git commit -m "Scaffold devrig-craft: TypeScript ESM project, typechecked tests"
```

---

### Task 2: LAN announcement parser

**Files:**
- Create: `src/discovery/lanParser.ts`
- Test: `test/lanParser.test.ts`

**Interfaces:**
- Produces: `parseLanAnnouncement(payload: string): { motd: string, port: number } | null`

Minecraft clients that pressed *Open to LAN* broadcast UDP datagrams to `224.0.2.60:4445` every ~1.5 s with the payload `[MOTD]<world name>[/MOTD][AD]<port>[/AD]`. This parser is a pure function over that payload. (M1 tests use synthetic strings; a real captured datagram joins these fixtures during the M2 manual validation — spec §9.)

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
  return { motd: m[1]!, port }
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
- Produces: `worldSlug(displayName: string, taken: Set<string>): string` — lowercase kebab slug, deduplicated with `-2`, `-3`, … suffixes. This is the `world_name` routing key (mirrors devrig's `project_name` slug rule). ASCII-only by decision (spec §13: the demo is English-only); slug *stability across snapshots* is Task 4's responsibility (deterministic input ordering).

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
- Consumes: `worldSlug` (Task 3).
- Produces:
  - `type PingResult = { version: string; motd: string; players: { online: number; max: number } | null }`
  - `type DiscoveredWorld = { worldName: string; displayName: string; host: string; port: number; source: 'lan' | 'server'; version: string | null; players: { online: number; max: number } | null; compatible: boolean }`
  - `type LanSource = () => Promise<Array<{ motd: string; port: number; host: string }>>`
  - `type PingSource = (host: string, port: number) => Promise<PingResult | null>`
  - `buildSnapshot(lan: LanSource, ping: PingSource, extraPorts?: number[]): Promise<DiscoveredWorld[]>` — **deterministic**: announcements sorted by (host, port) before slug allocation (spec §4 stability rule); all pings run in parallel.
  - `isVersionSupported(version: string): boolean` — true when the major.minor is within `SUPPORTED_RANGE = ['1.18', '1.21']` (pin; update as mineflayer catches up).

- [ ] **Step 1: Write the failing test**

`test/snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSnapshot, isVersionSupported, type PingResult } from '../src/discovery/snapshot.js'

const noLan = async () => []
const noPing = async () => null
const ping = (version: string, motd = '', players: PingResult['players'] = null) =>
  async () => ({ version, motd, players })

describe('buildSnapshot', () => {
  it('lists LAN worlds with slugs and version from ping', async () => {
    const lan = async () => [{ motd: "Grigorii's world", port: 54321, host: '192.168.1.10' }]
    const worlds = await buildSnapshot(lan, ping('1.21.4'))
    expect(worlds).toEqual([
      {
        worldName: 'grigorii-s-world',
        displayName: "Grigorii's world",
        host: '192.168.1.10',
        port: 54321,
        source: 'lan',
        version: '1.21.4',
        players: null,
        compatible: true,
      },
    ])
  })

  it('assigns dedup suffixes independent of announcement arrival order', async () => {
    const a = { motd: 'w', port: 2000, host: 'b-host' }
    const b = { motd: 'w', port: 1000, host: 'a-host' }
    const order1 = await buildSnapshot(async () => [a, b], ping('1.21.4'))
    const order2 = await buildSnapshot(async () => [b, a], ping('1.21.4'))
    expect(order1).toEqual(order2)
    expect(order1.find((w) => w.host === 'a-host')!.worldName).toBe('w')
    expect(order1.find((w) => w.host === 'b-host')!.worldName).toBe('w-2')
  })

  it('dedupes identical repeated LAN announcements', async () => {
    const ann = { motd: 'w', port: 1000, host: 'h' }
    const worlds = await buildSnapshot(async () => [ann, ann, ann], noPing)
    expect(worlds).toHaveLength(1)
  })

  it('uses the server MOTD as display name and surfaces players', async () => {
    const p = ping('1.20.1', 'Epic Server', { online: 3, max: 20 })
    const worlds = await buildSnapshot(noLan, async (h, port) => (port === 25565 ? p() : null), [25565])
    expect(worlds[0]).toMatchObject({
      worldName: 'epic-server',
      displayName: 'Epic Server',
      source: 'server',
      players: { online: 3, max: 20 },
    })
  })

  it('falls back to localhost:PORT when the server MOTD is empty', async () => {
    const worlds = await buildSnapshot(noLan, ping('1.20.1'), [25565])
    expect(worlds[0]).toMatchObject({ worldName: 'localhost-25565', displayName: 'localhost:25565' })
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

export type PingResult = {
  version: string
  motd: string
  players: { online: number; max: number } | null
}

export type DiscoveredWorld = {
  worldName: string
  displayName: string
  host: string
  port: number
  source: 'lan' | 'server'
  version: string | null
  players: { online: number; max: number } | null
  compatible: boolean
}

export type LanSource = () => Promise<Array<{ motd: string; port: number; host: string }>>
export type PingSource = (host: string, port: number) => Promise<PingResult | null>

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
  const seen = new Set<string>()
  const announcements = (await lan())
    .filter((a) => {
      const key = `${a.host}:${a.port}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    // Deterministic slug allocation: order by (host, port), never by UDP arrival.
    .sort((x, y) => x.host.localeCompare(y.host) || x.port - y.port)

  const ports = extraPorts.filter((p) => !seen.has(`127.0.0.1:${p}`))
  const [lanPings, serverPings] = await Promise.all([
    Promise.all(announcements.map((a) => ping(a.host, a.port))),
    Promise.all(ports.map((p) => ping('127.0.0.1', p))),
  ])

  const taken = new Set<string>()
  const worlds: DiscoveredWorld[] = []

  announcements.forEach((a, i) => {
    const pinged = lanPings[i] ?? null
    const worldName = worldSlug(a.motd, taken)
    taken.add(worldName)
    worlds.push({
      worldName,
      displayName: a.motd,
      host: a.host,
      port: a.port,
      source: 'lan',
      version: pinged?.version ?? null,
      players: pinged?.players ?? null,
      compatible: pinged !== null && isVersionSupported(pinged.version),
    })
  })

  ports.forEach((port, i) => {
    const pinged = serverPings[i] ?? null
    if (!pinged) return
    const displayName = pinged.motd.trim() || `localhost:${port}`
    const worldName = worldSlug(displayName, taken)
    taken.add(worldName)
    worlds.push({
      worldName,
      displayName,
      host: '127.0.0.1',
      port,
      source: 'server',
      version: pinged.version,
      players: pinged.players,
      compatible: isVersionSupported(pinged.version),
    })
  })

  return worlds
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/snapshot.test.ts`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/discovery/snapshot.ts test/snapshot.test.ts
git commit -m "Build deterministic discovery snapshot: sorted slugs, parallel pings, MOTD names"
```

---

### Task 5: Real LAN listener and Server List Ping sources

**Files:**
- Create: `src/discovery/sources.ts`
- Test: `test/sources.test.ts`

**Interfaces:**
- Consumes: `LanSource`, `PingSource`, `PingResult` types (Task 4), `parseLanAnnouncement` (Task 2).
- Produces:
  - `collectLanAnnouncements(windowMs?: number, port?: number): ReturnType<LanSource>` — joins multicast group `224.0.2.60` on UDP `port` (default 4445), collects datagrams for `windowMs` (default 1800 ms), parses each with `parseLanAnnouncement`. The port parameter exists for test isolation — two `reuseAddr` sockets on one port split unicast datagrams non-deterministically (measured in the review), so tests must not share 4445 with each other or with a real client.
  - `pingWorld: PingSource` — wraps `minecraft-protocol`'s `ping()` with a 1500 ms timeout, mapping the result to `{ version, motd, players }`; `null` on any error or on a response without `version.name`.

- [ ] **Step 1: Write the failing test**

`test/sources.test.ts` (the mocked ping cases cover exactly the class of breakage that survives a `minecraft-protocol` upgrade; the UDP cases use a free ephemeral port and marker-based assertions so a real Minecraft client on the network cannot redden them):

```ts
import { describe, it, expect, vi } from 'vitest'
import dgram from 'node:dgram'
import type { AddressInfo } from 'node:net'

vi.mock('minecraft-protocol', () => ({ default: { ping: vi.fn() } }))
import mc from 'minecraft-protocol'
import { collectLanAnnouncements, pingWorld } from '../src/discovery/sources.js'

const mockedPing = vi.mocked((mc as unknown as { ping: Function }).ping)

function freeUdpPort(): Promise<number> {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4')
    s.bind(0, () => {
      const port = (s.address() as AddressInfo).port
      s.close(() => resolve(port))
    })
  })
}

describe('collectLanAnnouncements', () => {
  it('collects a datagram sent during the window and ignores garbage', async () => {
    const port = await freeUdpPort()
    const pending = collectLanAnnouncements(600, port)
    await new Promise((r) => setTimeout(r, 150))
    const sock = dgram.createSocket('udp4')
    sock.send('garbage', port, '127.0.0.1')
    sock.send('[MOTD]loop world[/MOTD][AD]7777[/AD]', port, '127.0.0.1', () => sock.close())
    const anns = await pending
    expect(anns).toContainEqual({ motd: 'loop world', port: 7777, host: '127.0.0.1' })
    expect(anns.filter((a) => a.motd === 'loop world')).toHaveLength(1)
  })
})

describe('pingWorld', () => {
  it('maps a full response to version, motd and players', async () => {
    mockedPing.mockImplementationOnce((_o: unknown, cb: Function) =>
      cb(null, {
        version: { name: '1.21.4' },
        description: { text: 'Epic Server' },
        players: { online: 3, max: 20 },
      }),
    )
    expect(await pingWorld('h', 1)).toEqual({
      version: '1.21.4',
      motd: 'Epic Server',
      players: { online: 3, max: 20 },
    })
  })

  it('handles string descriptions and missing players', async () => {
    mockedPing.mockImplementationOnce((_o: unknown, cb: Function) =>
      cb(null, { version: { name: '1.20.1' }, description: 'plain motd' }),
    )
    expect(await pingWorld('h', 1)).toEqual({ version: '1.20.1', motd: 'plain motd', players: null })
  })

  it('returns null when version.name is missing', async () => {
    mockedPing.mockImplementationOnce((_o: unknown, cb: Function) => cb(null, { version: {} }))
    expect(await pingWorld('h', 1)).toBeNull()
  })

  it('returns null when ping errors', async () => {
    mockedPing.mockImplementationOnce((_o: unknown, cb: Function) => cb(new Error('ECONNREFUSED')))
    expect(await pingWorld('h', 1)).toBeNull()
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
import type { LanSource, PingResult, PingSource } from './snapshot.js'

const LAN_GROUP = '224.0.2.60'
export const LAN_PORT = 4445

export function collectLanAnnouncements(windowMs = 1800, port = LAN_PORT): ReturnType<LanSource> {
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
    sock.bind(port, () => {
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

type RawPing = {
  version?: { name?: unknown }
  description?: unknown
  players?: { online?: unknown; max?: unknown }
}

function motdText(description: unknown): string {
  if (typeof description === 'string') return description
  if (description && typeof description === 'object') {
    const d = description as { text?: unknown; extra?: unknown[] }
    const extra = Array.isArray(d.extra) ? d.extra.map(motdText).join('') : ''
    return `${typeof d.text === 'string' ? d.text : ''}${extra}`
  }
  return ''
}

export const pingWorld: PingSource = async (host, port) => {
  try {
    const result = await new Promise<RawPing>((resolve, reject) => {
      mc.ping({ host, port, closeTimeout: 1500, noPongTimeout: 1500 }, (err: unknown, res: RawPing) =>
        err ? reject(err) : resolve(res),
      )
    })
    const name = result?.version?.name
    if (typeof name !== 'string') return null
    const players =
      typeof result.players?.online === 'number' && typeof result.players?.max === 'number'
        ? { online: result.players.online, max: result.players.max }
        : null
    const mapped: PingResult = { version: name, motd: motdText(result.description), players }
    return mapped
  } catch (e) {
    console.error(`ping ${host}:${port} failed:`, e)
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sources.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/discovery/sources.ts test/sources.test.ts
git commit -m "Add discovery sources: parameterized LAN listener, fully-parsed Server List Ping"
```

---

### Task 6: Execute-code sandbox

**Files:**
- Create: `src/runtime/sandbox.ts`
- Test: `test/sandbox.test.ts`

**Interfaces:**
- Produces:
  - `executeScript(code: string, scope: Record<string, unknown>, timeoutMs: number): Promise<string>` — runs `code` as the body of an async function inside a `node:vm` context whose globals are exactly `scope` plus `print`, `printJson`, `sleep`. Returns the printed lines joined with `\n`, middle-truncated past `MAX_LINES = 2000` / `MAX_BYTES = 262144` (head 100 lines + `[output truncated: N lines omitted]` + tail). A successful run that printed nothing returns exactly `HINT: script completed but printed nothing — use print(...)/printJson(...) to return data.`
  - `class ScriptError extends Error` with `scriptStack?: string`, `failingLine?: string` ("line N: <source>"), and `timedOut: boolean`. Line numbers match the user's code (the async-wrapper offset is compensated via `lineOffset`).
  - `printJson(undefined)` (and functions/symbols) prints the string `undefined` — never a silent empty response.

Known limitations, by spec §2/§6 (do NOT try to fix in M1): the vm context is not a trust boundary, and a synchronous `while(true)` hangs the process. The async-timeout side effect (force-disconnecting the bot) is the caller's job — Task 8.

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

  it('printJson(undefined) prints "undefined", not an empty response', async () => {
    const out = await executeScript('printJson(undefined)', {}, 1000)
    expect(out).toBe('undefined')
  })

  it('supports top-level await and scope values', async () => {
    const out = await executeScript('await sleep(10); print(magic + 1)', { magic: 41 }, 1000)
    expect(out).toBe('42')
  })

  it('returns the HINT line for print-less success', async () => {
    const out = await executeScript('const x = 1', {}, 1000)
    expect(out).toContain('HINT: script completed but printed nothing')
  })

  it('truncates huge output from the middle, keeping the tail', async () => {
    const out = await executeScript('for (let i = 0; i < 5000; i++) print("line " + i)', {}, 5000)
    const lines = out.split('\n')
    expect(lines.length).toBeLessThan(2100)
    expect(out).toContain('[output truncated:')
    expect(lines[lines.length - 1]).toBe('line 4999')
    expect(lines[0]).toBe('line 0')
  })

  it('rejects with ScriptError carrying message and failing line', async () => {
    const code = 'print("ok")\nthrow new Error("boom")'
    const err = await executeScript(code, {}, 1000).then(
      () => null,
      (e) => e as ScriptError,
    )
    expect(err).toBeInstanceOf(ScriptError)
    expect(err!.message).toContain('boom')
    expect(err!.failingLine).toBe('line 2: throw new Error("boom")')
    expect(err!.timedOut).toBe(false)
  })

  it('reports syntax errors without crashing the process', async () => {
    await expect(executeScript('const const', {}, 1000)).rejects.toBeInstanceOf(ScriptError)
  })

  it('times out hung scripts and marks timedOut', async () => {
    const err = await executeScript('await sleep(5000)', {}, 100).then(
      () => null,
      (e) => e as ScriptError,
    )
    expect(err!.message).toMatch(/timed out after/)
    expect(err!.timedOut).toBe(true)
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
  constructor(
    message: string,
    public readonly scriptStack?: string,
    public readonly failingLine?: string,
    public readonly timedOut: boolean = false,
  ) {
    super(message)
    this.name = 'ScriptError'
  }
}

export const NO_PRINT_HINT =
  'HINT: script completed but printed nothing — use print(...)/printJson(...) to return data.'

const MAX_LINES = 2000
const MAX_BYTES = 262144
const HARD_LINE_CAP = 20000

function extractFailingLine(stack: string | undefined, srcLines: string[]): string | undefined {
  const m = /craft-script\.js:(\d+)/.exec(stack ?? '')
  if (!m) return undefined
  const n = Number(m[1])
  const src = srcLines[n - 1]
  return src !== undefined ? `line ${n}: ${src.trim()}` : undefined
}

function renderOutput(lines: string[], skipped: number): string {
  let all = skipped > 0 ? [...lines, `[output truncated: ${skipped} further lines dropped]`] : lines
  if (all.length > MAX_LINES) {
    const omitted = all.length - 100 - (MAX_LINES - 101)
    all = [...all.slice(0, 100), `[output truncated: ${omitted} lines omitted]`, ...all.slice(-(MAX_LINES - 101))]
  }
  let text = all.join('\n')
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    // Keep the tail — verification output lives at the end.
    text = `[output truncated to the last ${MAX_BYTES} bytes]\n` + text.slice(-MAX_BYTES)
  }
  return text
}

export async function executeScript(
  code: string,
  scope: Record<string, unknown>,
  timeoutMs: number,
): Promise<string> {
  const lines: string[] = []
  let skipped = 0
  const push = (line: string) => {
    if (lines.length < HARD_LINE_CAP) lines.push(line)
    else skipped++
  }
  const srcLines = code.split('\n')
  const context = vm.createContext({
    ...scope,
    print: (...args: unknown[]) => push(args.map(String).join(' ')),
    printJson: (value: unknown) => {
      const s = JSON.stringify(value, null, 2)
      push(s === undefined ? 'undefined' : s)
    },
    sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  })

  let fn: () => Promise<unknown>
  try {
    fn = vm.runInContext(`(async () => {\n${code}\n})`, context, {
      filename: 'craft-script.js',
      lineOffset: -1, // reported numbers match the user's code, not the wrapper
      timeout: timeoutMs,
    }) as () => Promise<unknown>
  } catch (e) {
    const err = e as Error
    throw new ScriptError(`Script failed to compile: ${err.message}`, err.stack, extractFailingLine(err.stack, srcLines))
  }

  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ScriptError(`Script timed out after ${timeoutMs} ms`, undefined, undefined, true)),
      timeoutMs,
    )
  })
  try {
    await Promise.race([fn(), timeout])
  } catch (e) {
    if (e instanceof ScriptError) throw e
    const err = e as Error
    throw new ScriptError(`Script threw: ${err.message}`, err.stack, extractFailingLine(err.stack, srcLines))
  } finally {
    clearTimeout(timer)
  }

  return lines.length > 0 || skipped > 0 ? renderOutput(lines, skipped) : NO_PRINT_HINT
}
```

Note on `lineOffset: -1`: the option shifts *reported* positions only. Confirm the failing-line test passes against a real stack on the pinned Node version; if the runtime you're on anchors stack lines differently, adjust the offset arithmetic in `extractFailingLine` (not the wrapper) until `line 2: throw new Error("boom")` holds.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sandbox.test.ts`
Expected: 9 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/sandbox.ts test/sandbox.test.ts
git commit -m "Add vm sandbox: print capture, output caps, aligned error lines, timeout marking"
```

---

### Task 7: Bot manager

**Files:**
- Create: `src/runtime/botManager.ts`
- Test: `test/botManager.test.ts`

**Interfaces:**
- Consumes: `DiscoveredWorld` (Task 4).
- Produces:
  - `type BotFactory = (opts: { host: string; port: number; username: string; auth: 'offline' }) => BotLike`
  - `type BotLike = NodeJS.EventEmitter & { entity?: { position: { x: number; y: number; z: number } }; health?: number; food?: number; end: (reason?: string) => void }`
  - `class BotManager`:
    - `join(world: DiscoveredWorld, username: string): void` — idempotent per `worldName` while live; a previous errored bot is ended AND has its listeners detached before the replacement is created (a late `end` from the old emitter must not poison the new entry); joins that neither spawn nor fail flip to `error` after `JOIN_TIMEOUT_MS = 60_000`.
    - `list(): Array<{ worldName: string; username: string; state: 'joining' | 'ready' | 'error'; error?: string; position?: {...}; health?: number; food?: number }>`
    - `get(worldName: string): { bot: BotLike; state: 'joining' | 'ready' | 'error' } | undefined`
    - `tryLock(worldName: string): (() => void) | null` — per-world execution lock; returns a release function or `null` when the bot is already running a script (spec §5 serialization).
    - `endAll(): void`

- [ ] **Step 1: Write the failing test**

`test/botManager.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
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
    players: null,
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

afterEach(() => vi.useRealTimers())

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

  it('flips to error when a join never spawns within the timeout', () => {
    vi.useFakeTimers()
    const mgr = new BotManager(() => new FakeBot())
    mgr.join(world('w'), 'devrig')
    vi.advanceTimersByTime(60_001)
    expect(mgr.list()[0]).toMatchObject({ state: 'error' })
    expect(mgr.list()[0]!.error).toContain('join timed out')
  })

  it('spawn cancels the join timer', () => {
    vi.useFakeTimers()
    const bot = new FakeBot()
    const mgr = new BotManager(() => bot)
    mgr.join(world('w'), 'devrig')
    bot.emit('spawn')
    vi.advanceTimersByTime(120_000)
    expect(mgr.list()[0]).toMatchObject({ state: 'ready' })
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

  it('rejoin after error ends the old bot and detaches its listeners', () => {
    const bots: FakeBot[] = []
    const mgr = new BotManager(() => {
      const b = new FakeBot()
      bots.push(b)
      return b
    })
    mgr.join(world('w'), 'devrig')
    bots[0]!.emit('end', 'socketClosed')
    mgr.join(world('w'), 'devrig')
    expect(bots).toHaveLength(2)
    expect(bots[0]!.ended).toBe(true)
    bots[1]!.emit('spawn')
    // A late event from the OLD emitter must not poison the new entry:
    bots[0]!.emit('end', 'late straggler')
    expect(mgr.list()[0]).toMatchObject({ state: 'ready' })
  })

  it('tryLock serializes executions per world', () => {
    const bot = new FakeBot()
    const mgr = new BotManager(() => bot)
    mgr.join(world('w'), 'devrig')
    const release = mgr.tryLock('w')
    expect(release).not.toBeNull()
    expect(mgr.tryLock('w')).toBeNull()
    release!()
    expect(mgr.tryLock('w')).not.toBeNull()
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

export const JOIN_TIMEOUT_MS = 60_000

type Entry = {
  world: DiscoveredWorld
  username: string
  bot: BotLike
  state: BotState
  error?: string
  joinTimer?: NodeJS.Timeout
  locked: boolean
}

export class BotManager {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly factory: BotFactory) {}

  join(world: DiscoveredWorld, username: string): void {
    const existing = this.entries.get(world.worldName)
    if (existing && existing.state !== 'error') return
    if (existing) this.dispose(existing)

    const bot = this.factory({ host: world.host, port: world.port, username, auth: 'offline' })
    const entry: Entry = { world, username, bot, state: 'joining', locked: false }
    this.entries.set(world.worldName, entry)

    const fail = (error: string) => {
      entry.state = 'error'
      entry.error = error
      clearTimeout(entry.joinTimer)
      console.error(`bot ${world.worldName}: ${error}`)
    }
    entry.joinTimer = setTimeout(() => {
      if (entry.state === 'joining')
        fail(`join timed out after ${JOIN_TIMEOUT_MS / 1000}s — is the world still open to LAN?`)
    }, JOIN_TIMEOUT_MS)
    bot.on('spawn', () => {
      entry.state = 'ready'
      clearTimeout(entry.joinTimer)
    })
    bot.on('error', (e: unknown) => fail(`error: ${String(e)}`))
    bot.on('kicked', (reason: unknown) => fail(`kicked: ${String(reason)}`))
    bot.on('end', (reason: unknown) => {
      if (entry.state !== 'error') fail(`connection ended: ${String(reason)}`)
    })
  }

  private dispose(entry: Entry): void {
    clearTimeout(entry.joinTimer)
    entry.bot.removeAllListeners()
    try {
      entry.bot.end('devrig-craft: replaced by rejoin')
    } catch (e) {
      console.error('bot end failed:', e)
    }
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

  tryLock(worldName: string): (() => void) | null {
    const e = this.entries.get(worldName)
    if (!e || e.locked) return null
    e.locked = true
    return () => {
      e.locked = false
    }
  }

  endAll(): void {
    for (const e of this.entries.values()) this.dispose(e)
    this.entries.clear()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/botManager.test.ts`
Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/botManager.ts test/botManager.test.ts
git commit -m "Track bot lifecycle: join timeout, clean rejoin, per-world lock, endAll"
```

---

### Task 8: MCP server with all 8 tools

**Files:**
- Create: `src/server.ts`, `src/wire.ts`, `src/runtime/mineflayerFactory.ts`
- Test: `test/server.test.ts`, `test/wire.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–7.
- Produces:
  - `src/wire.ts`: `toWire(value: unknown): unknown` — recursively converts object keys camelCase→snake_case; applied to every JSON tool response. camelCase never crosses the MCP boundary.
  - `createCraftServer(deps: { lan: LanSource; ping: PingSource; botFactory: BotFactory; recipesDir?: string; extraPorts?: number[]; feedbackPath?: string }): { server: McpServer; endAll: () => void }` — registers exactly the 8 tools; `endAll` is for the CLI's signal handlers (Task 10).
  - `src/runtime/mineflayerFactory.ts` exports `mineflayerFactory: BotFactory`: creates the mineflayer bot, loads pathfinder, and attaches `craftScope()` returning `{ bot, Vec3, mcData, goals, Movements, Item, waitFor }` — `Item` is `prismarine-item` bound to `bot.version`, `goals`/`Movements` come from `mineflayer-pathfinder` (spec §6: native entry-point classes, injected — no `require` inside scripts).
  - Tool contracts (each responds `{ content: [{ type: 'text', text }] }`; JSON payloads pass through `toWire`):
    - `craft_list_worlds` (no params): fresh snapshot as JSON.
    - `craft_list_bots` (no params): `botManager.list()` as JSON.
    - `craft_join_world` (`world_name`, optional `username` default `devrig`): unknown name → error listing known names; incompatible → error with supported range; success echoes the resolved `host:port` (spec §4 stability visibility).
    - `craft_execute_code` (`world_name`, `code` ≤100 000 chars, `task_id`, `reason`, optional `timeout` int 1–600 default 120): requires a `ready` bot; acquires the per-world lock or returns `bot busy: another script is running in this world — retry after it finishes`; generates `execution_id` (`randomUUID()`), logs `{execution_id, task_id, reason, world_name, durationMs, ok}` as one stderr line, and returns `execution_id: <uuid>` as the first response line. On `ScriptError` with `timedOut`: force `bot.end()` (stops world mutation) and tell the caller to rejoin. On other `ScriptError`: message + failing line + stack, `isError: true`.
    - `craft_fetch_resource` (`uri`): serves `resources/recipes/<prompt|skill>/<name>.md`; unknown → error listing known URIs.
    - `craft_chat` (`world_name`, `text`, `task_id`, `reason`): takes the same per-world lock (busy → same error); steering description.
    - `craft_take_screenshot` (`world_name`, `task_id`, `reason`): **M1 = error branch only** — always returns `isError: true` with `screenshot not available in M1 — verify via bot.blockAt sweeps (mcp-craft://skill/world-queries); the human is watching first-person anyway`. No prismarine-viewer import in M1.
    - `craft_execute_feedback` (`task_id`, `execution_id`, `success_rating` 0..1, `explanation`): rejects an `execution_id` that this process never issued; appends one JSONL line to `feedbackPath` (default `os.tmpdir()/devrig-craft-feedback.jsonl`) and returns `recorded to <path>`.

- [ ] **Step 1: Write the failing wire test**

`test/wire.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toWire } from '../src/wire.js'

describe('toWire', () => {
  it('snake_cases keys recursively, leaving values and arrays intact', () => {
    expect(
      toWire({ worldName: 'w', players: { onlineCount: 1 }, list: [{ displayName: 'x' }] }),
    ).toEqual({ world_name: 'w', players: { online_count: 1 }, list: [{ display_name: 'x' }] })
  })

  it('passes primitives through', () => {
    expect(toWire('a')).toBe('a')
    expect(toWire(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Write the failing server test**

`test/server.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCraftServer } from '../src/server.js'
import type { BotLike } from '../src/runtime/botManager.js'

class FakeBot extends EventEmitter implements BotLike {
  entity = { position: { x: 0, y: 64, z: 0 } }
  health = 20
  food = 20
  lastChat = ''
  ended = false
  chat(text: string) {
    this.lastChat = text
  }
  blockAt() {
    return { name: 'stone' }
  }
  end() {
    this.ended = true
  }
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

const text = (r: any): string => r.content[0].text as string

describe('craft MCP server', () => {
  let client: Client
  let bot: FakeBot
  let feedbackPath: string

  beforeEach(async () => {
    bot = new FakeBot()
    feedbackPath = join(tmpdir(), `craft-feedback-test-${Date.now()}-${Math.random()}.jsonl`)
    const { server } = createCraftServer({
      lan: async () => [{ motd: 'test world', port: 7777, host: '127.0.0.1' }],
      ping: async () => ({ version: '1.21.4', motd: '', players: null }),
      botFactory: () => bot,
      recipesDir: 'resources/recipes',
      extraPorts: [],
      feedbackPath,
    })
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test', version: '0.0.0' })
    await Promise.all([server.connect(serverT), client.connect(clientT)])
  })

  async function joinAndSpawn(): Promise<void> {
    await client.callTool({ name: 'craft_join_world', arguments: { world_name: 'test-world' } })
    bot.emit('spawn')
  }

  async function exec(code: string, timeout?: number) {
    return client.callTool({
      name: 'craft_execute_code',
      arguments: { world_name: 'test-world', code, task_id: 't', reason: 'r', ...(timeout ? { timeout } : {}) },
    })
  }

  it('registers exactly the 8 mirrored tools', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(tools).toEqual([...EXPECTED_TOOLS].sort())
  })

  it('lists worlds in snake_case with routing keys and no camelCase leaks', async () => {
    const raw = text(await client.callTool({ name: 'craft_list_worlds', arguments: {} }))
    const worlds = JSON.parse(raw)
    expect(worlds[0]).toMatchObject({ world_name: 'test-world', version: '1.21.4', compatible: true })
    expect(raw).not.toMatch(/"[a-z0-9]+[A-Z]\w*"\s*:/)
  })

  it('join echoes host:port, then execute_code returns execution_id + output', async () => {
    const joinRes = await client.callTool({ name: 'craft_join_world', arguments: { world_name: 'test-world' } })
    expect(text(joinRes)).toContain('127.0.0.1:7777')
    bot.emit('spawn')
    const res = await exec('print(bot.blockAt().name)')
    const [first, ...rest] = text(res).split('\n')
    expect(first).toMatch(/^execution_id: [0-9a-f-]{36}$/)
    expect(rest.join('\n')).toBe('stone')
  })

  it('execute_code against a non-ready bot returns guidance, not a crash', async () => {
    const res = await exec('print(1)')
    expect(res.isError).toBe(true)
    expect(text(res)).toContain('craft_join_world')
  })

  it('join_world rejects unknown names with the known list', async () => {
    const res = await client.callTool({ name: 'craft_join_world', arguments: { world_name: 'nope' } })
    expect(res.isError).toBe(true)
    expect(text(res)).toContain('test-world')
  })

  it('rejects oversized code and out-of-range timeouts at the schema', async () => {
    await joinAndSpawn()
    await expect(exec('x'.repeat(100_001))).rejects.toThrow()
    await expect(exec('print(1)', 601)).rejects.toThrow()
  })

  it('serializes executions: concurrent call gets an explicit busy error', async () => {
    await joinAndSpawn()
    const slow = exec('await sleep(300); print("slow done")')
    await new Promise((r) => setTimeout(r, 50))
    const busy = await exec('print("fast")')
    expect(busy.isError).toBe(true)
    expect(text(busy)).toContain('bot busy')
    expect(text(await slow)).toContain('slow done')
  })

  it('script errors surface with the failing line', async () => {
    await joinAndSpawn()
    const res = await exec('throw new Error("boom")')
    expect(res.isError).toBe(true)
    expect(text(res)).toContain('boom')
    expect(text(res)).toContain('line 1:')
  })

  it('a timed-out script disconnects the bot and says to rejoin', async () => {
    await joinAndSpawn()
    const res = await exec('await sleep(60_000)', 1)
    expect(res.isError).toBe(true)
    expect(text(res)).toContain('rejoin')
    expect(bot.ended).toBe(true)
  })

  it('feedback rejects unknown execution ids and records known ones', async () => {
    await joinAndSpawn()
    const bad = await client.callTool({
      name: 'craft_execute_feedback',
      arguments: { task_id: 't', execution_id: 'never-issued', success_rating: 1, explanation: 'x' },
    })
    expect(bad.isError).toBe(true)

    const res = await exec('print(1)')
    const id = text(res).split('\n')[0]!.replace('execution_id: ', '')
    const good = await client.callTool({
      name: 'craft_execute_feedback',
      arguments: { task_id: 't', execution_id: id, success_rating: 0.9, explanation: 'built it' },
    })
    expect(text(good)).toContain(feedbackPath)
    const logged = JSON.parse((await readFile(feedbackPath, 'utf8')).trim())
    expect(logged).toMatchObject({ execution_id: id, success_rating: 0.9 })
  })

  it('craft_chat relays through the bot and respects the lock', async () => {
    await joinAndSpawn()
    await client.callTool({
      name: 'craft_chat',
      arguments: { world_name: 'test-world', text: 'hello', task_id: 't', reason: 'r' },
    })
    expect(bot.lastChat).toBe('hello')
  })

  it('screenshot returns the M1 guidance error', async () => {
    await joinAndSpawn()
    const res = await client.callTool({
      name: 'craft_take_screenshot',
      arguments: { world_name: 'test-world', task_id: 't', reason: 'r' },
    })
    expect(res.isError).toBe(true)
    expect(text(res)).toContain('blockAt')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/wire.test.ts test/server.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write the implementation**

`src/wire.ts`:

```ts
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())

export function toWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toWire)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [snake(k), toWire(v)]))
  }
  return value
}
```

`src/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { appendFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSnapshot, SUPPORTED_RANGE, type LanSource, type PingSource } from './discovery/snapshot.js'
import { BotManager, type BotFactory, type BotLike } from './runtime/botManager.js'
import { executeScript, ScriptError } from './runtime/sandbox.js'
import { toWire } from './wire.js'
import { SERVER_NAME, SERVER_VERSION } from './version.js'

export type CraftServerDeps = {
  lan: LanSource
  ping: PingSource
  botFactory: BotFactory
  recipesDir?: string
  extraPorts?: number[]
  feedbackPath?: string
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })
const json = (value: unknown) => ok(JSON.stringify(toWire(value), null, 2))

export function createCraftServer(deps: CraftServerDeps): { server: McpServer; endAll: () => void } {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
  const bots = new BotManager(deps.botFactory)
  const issuedExecutions = new Set<string>()
  const feedbackPath = deps.feedbackPath ?? join(tmpdir(), 'devrig-craft-feedback.jsonl')
  const snapshot = () => buildSnapshot(deps.lan, deps.ping, deps.extraPorts ?? [25565])

  server.registerTool(
    'craft_list_worlds',
    {
      description:
        'List running Minecraft worlds this machine can join: LAN-opened singleplayer worlds ' +
        '(any launcher, incl. Prism) and local offline-mode servers. Returns world_name — the ' +
        'routing key for every other tool — plus version, players and a compat flag. Rebuilt ' +
        'fresh on every call.',
      inputSchema: {},
    },
    async () => json(await snapshot()),
  )

  server.registerTool(
    'craft_list_bots',
    {
      description:
        'List live bots and their readiness (joining/ready/error), position, health, food. ' +
        'Poll this after craft_join_world until state=ready.',
      inputSchema: {},
    },
    async () => json(bots.list()),
  )

  server.registerTool(
    'craft_join_world',
    {
      description:
        'ASYNC: start joining a discovered world as a bot. Returns immediately; poll ' +
        'craft_list_bots until state=ready before calling craft_execute_code. Joins time out ' +
        'after 60s into an error state.',
      inputSchema: {
        world_name: z.string().max(256).describe('routing key from craft_list_worlds'),
        username: z.string().max(16).optional().describe('bot username, default "devrig"'),
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
      return ok(
        `Joining "${world_name}" (${world.host}:${world.port}) as ${username ?? 'devrig'} — poll craft_list_bots until state=ready.`,
      )
    },
  )

  server.registerTool(
    'craft_execute_code',
    {
      description:
        'THE main tool. Execute JavaScript with the full mineflayer API in scope: bot (pathfinder ' +
        'loaded), Vec3, mcData, goals, Movements, Item, print/printJson/sleep/waitFor. No require, ' +
        'no import — everything you need is already in scope. The response is an execution_id line, ' +
        'then ONLY what the script prints. Read mcp-craft://prompt/skill first for recipes. Verify ' +
        'builds via bot.blockAt sweeps, not screenshots.',
      inputSchema: {
        world_name: z.string().max(256),
        code: z.string().max(100_000).describe('body of an async function; top-level await works'),
        task_id: z.string().max(256).describe('reuse across related calls to group audit logs'),
        reason: z.string().max(4096).describe('full task description of intent and expected outcome'),
        timeout: z.number().int().min(1).max(600).optional().describe('seconds, default 120'),
      },
    },
    async ({ world_name, code, task_id, reason, timeout }) => {
      const entry = bots.get(world_name)
      if (!entry || entry.state !== 'ready')
        return err(
          `No ready bot in "${world_name}" (state: ${entry?.state ?? 'none'}). Call craft_join_world, then poll craft_list_bots until state=ready.`,
        )
      const release = bots.tryLock(world_name)
      if (!release) return err('bot busy: another script is running in this world — retry after it finishes')

      const executionId = randomUUID()
      issuedExecutions.add(executionId)
      const started = Date.now()
      const audit = (okFlag: boolean) =>
        console.error(
          JSON.stringify({
            execution_id: executionId,
            task_id,
            reason,
            world_name,
            duration_ms: Date.now() - started,
            ok: okFlag,
          }),
        )
      try {
        const scope = craftScope(entry.bot)
        const output = await executeScript(code, scope, (timeout ?? 120) * 1000)
        audit(true)
        return ok(`execution_id: ${executionId}\n${output}`)
      } catch (e) {
        audit(false)
        if (e instanceof ScriptError && e.timedOut) {
          try {
            entry.bot.end('devrig-craft: script timeout')
          } catch (endErr) {
            console.error('bot end after timeout failed:', endErr)
          }
          return err(
            `execution_id: ${executionId}\n${e.message}\nBot disconnected to stop the runaway script — craft_join_world to rejoin.`,
          )
        }
        if (e instanceof ScriptError)
          return err(
            `execution_id: ${executionId}\n${[e.message, e.failingLine, e.scriptStack].filter(Boolean).join('\n')}`,
          )
        throw e
      } finally {
        release()
      }
    },
  )

  server.registerTool(
    'craft_fetch_resource',
    {
      description:
        'Fetch an mcp-craft:// recipe article — copy-paste JS for building, world queries, ' +
        'command-based construction. Start at mcp-craft://prompt/skill.',
      inputSchema: { uri: z.string().max(512) },
    },
    async ({ uri }) => {
      const article = await loadRecipe(deps.recipesDir, uri)
      return article
        ? ok(article)
        : err(`Unknown URI "${uri}". Known: ${(await listRecipeUris(deps.recipesDir)).join(', ')}`)
    },
  )

  server.registerTool(
    'craft_chat',
    {
      description:
        'HEAVY/debug: send one raw chat line or slash-command. Prefer craft_execute_code with ' +
        'bot.chat(...) so sends compose with logic and verification.',
      inputSchema: {
        world_name: z.string().max(256),
        text: z.string().max(256),
        task_id: z.string().max(256),
        reason: z.string().max(4096),
      },
    },
    async ({ world_name, text }) => {
      const entry = bots.get(world_name)
      if (!entry || entry.state !== 'ready') return err(`No ready bot in "${world_name}".`)
      const release = bots.tryLock(world_name)
      if (!release) return err('bot busy: another script is running in this world — retry after it finishes')
      try {
        ;(entry.bot as BotLike & { chat: (t: string) => void }).chat(text)
        return ok('sent')
      } finally {
        release()
      }
    },
  )

  server.registerTool(
    'craft_take_screenshot',
    {
      description:
        'HEAVY ENDPOINT: render the bot POV. Not available in M1 — for verification use ' +
        'craft_execute_code with bot.blockAt sweeps (mcp-craft://skill/world-queries).',
      inputSchema: { world_name: z.string().max(256), task_id: z.string().max(256), reason: z.string().max(4096) },
    },
    async () =>
      err(
        'screenshot not available in M1 — verify via bot.blockAt sweeps (mcp-craft://skill/world-queries); the human is watching first-person anyway',
      ),
  )

  server.registerTool(
    'craft_execute_feedback',
    {
      description:
        'Rate a prior craft_execute_code call 0.00–1.00 with an explanation. Requires the ' +
        'execution_id that call returned.',
      inputSchema: {
        task_id: z.string().max(256),
        execution_id: z.string().max(64),
        success_rating: z.number().min(0).max(1),
        explanation: z.string().max(4096),
      },
    },
    async (args) => {
      if (!issuedExecutions.has(args.execution_id))
        return err(`Unknown execution_id "${args.execution_id}" — pass the id returned by craft_execute_code.`)
      await appendFile(feedbackPath, JSON.stringify({ ...args, ts: new Date().toISOString() }) + '\n', 'utf8')
      return ok(`recorded to ${feedbackPath}`)
    },
  )

  return { server, endAll: () => bots.endAll() }
}

function craftScope(bot: BotLike): Record<string, unknown> {
  const scopeFn = (bot as BotLike & { craftScope?: () => Record<string, unknown> }).craftScope
  if (scopeFn) return scopeFn()
  // Test bots without a factory-attached scope: expose the bot plus a generic waitFor.
  return {
    bot,
    waitFor: (event: string, timeoutMs = 10000) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error(`waitFor("${event}") timed out after ${timeoutMs} ms`)),
          timeoutMs,
        )
        bot.once(event, (...args: unknown[]) => {
          clearTimeout(t)
          resolve(args)
        })
      }),
  }
}

async function loadRecipe(recipesDir: string | undefined, uri: string): Promise<string | null> {
  if (!recipesDir) return null
  const rel = uri.replace(/^mcp-craft:\/\//, '')
  if (!/^[a-z0-9/-]+$/.test(rel)) return null
  try {
    return await readFile(join(recipesDir, `${rel}.md`), 'utf8')
  } catch {
    return null
  }
}

async function listRecipeUris(recipesDir: string | undefined): Promise<string[]> {
  if (!recipesDir) return []
  const uris: string[] = []
  for (const dir of ['prompt', 'skill']) {
    const files = await readdir(join(recipesDir, dir)).catch(() => [] as string[])
    uris.push(...files.map((f) => `mcp-craft://${dir}/${f.replace(/\.md$/, '')}`))
  }
  return uris
}
```

`src/runtime/mineflayerFactory.ts`:

```ts
import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import minecraftData from 'minecraft-data'
import prismarineItem from 'prismarine-item'
import type { BotFactory, BotLike } from './botManager.js'

const { pathfinder, Movements, goals } = pathfinderPkg

export const mineflayerFactory: BotFactory = ({ host, port, username, auth }) => {
  const bot = mineflayer.createBot({ host, port, username, auth })
  bot.loadPlugin(pathfinder)
  ;(bot as unknown as { craftScope: () => Record<string, unknown> }).craftScope = () => ({
    bot,
    Vec3,
    mcData: minecraftData(bot.version),
    goals,
    Movements,
    Item: prismarineItem(bot.version),
    waitFor: (event: string, timeoutMs = 10000) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error(`waitFor("${event}") timed out after ${timeoutMs} ms`)),
          timeoutMs,
        )
        bot.once(event as Parameters<typeof bot.once>[0], (...args: unknown[]) => {
          clearTimeout(t)
          resolve(args)
        })
      }),
  })
  return bot as unknown as BotLike
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/wire.test.ts test/server.test.ts && npm test`
Expected: all PASS. (`craft_fetch_resource`'s happy path stays red until Task 9 ships the corpus — if the runner insists on it now, assert only the unknown-URI branch here and move the happy-path assertion to Task 9 Step 5, where it is listed.)

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/wire.ts src/runtime/mineflayerFactory.ts test/server.test.ts test/wire.test.ts
git commit -m "Register the 8 craft_* tools: execution ids, per-world lock, snake_case wire"
```

---

### Task 9: Recipe corpus + typechecked fence contract

**Files:**
- Create: `resources/recipes/prompt/skill.md`, `resources/recipes/skill/building.md`, `resources/recipes/skill/building-with-commands.md`, `resources/recipes/skill/world-queries.md`
- Test: `test/recipes.test.ts`
- Modify: `test/server.test.ts` (add the fetch happy-path test)

**Interfaces:**
- Consumes: `loadRecipe`/`listRecipeUris` mapping (Task 8): `mcp-craft://<prompt|skill>/<name>` → `resources/recipes/<prompt|skill>/<name>.md`.
- Produces: the 4 M1 articles (spec §7); every ```js fence **type-checks** with `tsc --noEmit` against a prelude declaring exactly the sandbox scope — a `require`, an undeclared name, or a Node global fails the build.

Content requirements (write full articles, 40–120 lines each, at least one complete copy-paste ```js block in every skill article):

- `prompt/skill.md` — index of all M1 URIs + the philosophy note: few tools, power in execute_code + recipes; verify via API not pixels; scope reference (`bot`, `Vec3`, `mcData`, `goals`, `Movements`, `Item`, `print`, `printJson`, `sleep`, `waitFor` — and explicitly: no `require`, no `import`, use `sleep` not `setTimeout`). Prose-only (no js fences required).
- `skill/building.md` — the promo happy path: pick a flat spot near the player; creative flight; equip via `bot.creative.setInventorySlot(36, new Item(mcData.itemsByName.stone.id, 64))`; `bot.placeBlock(referenceBlock, faceVector)` loop for a 5×5 house with door gap + torches; reach/facing constraints (≤4.5 blocks, must look at the face); pathfinder repositioning via `bot.pathfinder.goto(new goals.GoalNear(x, y, z, 2))` when out of reach; ends with a blockAt verification sweep printing expected-vs-actual.
- `skill/building-with-commands.md` — detect cheats/op (`bot.game.gameMode`, try a `/gamemode` and read the chat reply), `/fill` and `/setblock` via `bot.chat`, when to prefer this (large builds), always verify with blockAt after.
- `skill/world-queries.md` — `bot.blockAt(new Vec3(x, y, z))`, `bot.findBlocks({ matching, maxDistance, count })`, entity queries via `bot.entities`; THE verification pattern (assert-what-you-built) as the centerpiece.

- [ ] **Step 1: Write the failing contract test**

`test/recipes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const RECIPES = 'resources/recipes'
// Inside the repo so tsc resolves mineflayer types by walking up to node_modules.
const FENCE_DIR = 'build/fence-check'

// Mirrors the craft_execute_code scope EXACTLY (spec §6). "types": [] in the
// generated tsconfig removes Node globals, so `require`/`setTimeout` in a
// fence fail to compile — which is the point.
const PRELUDE = `import type { Bot } from 'mineflayer'
import type { Vec3 as Vec3Class } from 'vec3'
declare const bot: Bot
declare const Vec3: typeof Vec3Class
declare const mcData: any
declare const goals: any
declare const Movements: any
declare const Item: any
declare function print(...args: unknown[]): void
declare function printJson(v: unknown): void
declare function sleep(ms: number): Promise<void>
declare function waitFor(event: string, timeoutMs?: number): Promise<unknown[]>
`

async function allArticles(): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = []
  for (const dir of ['prompt', 'skill']) {
    for (const f of await readdir(`${RECIPES}/${dir}`)) {
      out.push({ path: `${dir}/${f}`, text: await readFile(`${RECIPES}/${dir}/${f}`, 'utf8') })
    }
  }
  return out
}

const jsFences = (md: string): string[] =>
  [...md.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]!)

describe('recipe corpus', () => {
  it('ships the 4 M1 articles', async () => {
    const paths = (await allArticles()).map((a) => a.path).sort()
    expect(paths).toEqual(
      ['prompt/skill.md', 'skill/building-with-commands.md', 'skill/building.md', 'skill/world-queries.md'].sort(),
    )
  })

  it('every skill article has at least one js fence', async () => {
    for (const a of await allArticles()) {
      if (a.path === 'prompt/skill.md') continue
      expect(jsFences(a.text).length, `${a.path} needs a js fence`).toBeGreaterThan(0)
    }
  })

  it('every js fence type-checks as an execute_code body against the exact scope', async () => {
    await rm(FENCE_DIR, { recursive: true, force: true })
    await mkdir(FENCE_DIR, { recursive: true })
    const files: string[] = []
    for (const a of await allArticles()) {
      for (const [i, fence] of jsFences(a.text).entries()) {
        const name = `${a.path.replace(/[/.]/g, '_')}_${i}.ts`
        // Top-level await is legal here: the import type makes the file a module.
        await writeFile(`${FENCE_DIR}/${name}`, PRELUDE + '\n' + fence)
        files.push(name)
      }
    }
    await writeFile(
      `${FENCE_DIR}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: {
          target: 'es2022',
          module: 'esnext',
          moduleResolution: 'bundler',
          strict: false,
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        files,
      }),
    )
    await run('npx', ['tsc', '-p', `${FENCE_DIR}/tsconfig.json`]).catch((e: any) => {
      throw new Error(`recipe fence failed to type-check:\n${e.stdout}\n${e.stderr}`)
    })
  }, 120000)

  it('the index lists every M1 skill URI and the scope contract', async () => {
    const index = await readFile(`${RECIPES}/prompt/skill.md`, 'utf8')
    for (const name of ['building', 'building-with-commands', 'world-queries']) {
      expect(index).toContain(`mcp-craft://skill/${name}`)
    }
    expect(index).toContain('no `require`')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/recipes.test.ts`
Expected: FAIL — `resources/recipes/prompt` does not exist.

- [ ] **Step 3: Write the 4 articles**

Write each article per the content requirements above. Sample fence style (from `skill/building.md`) — every fence must be a complete runnable `craft_execute_code` body against the injected scope (note: `Item` comes from scope, never from `require`):

```js
// Build a 5x5 stone platform at the bot's feet (creative mode).
const base = bot.entity.position.floored().offset(-2, -1, -2)
await bot.creative.setInventorySlot(36, new Item(mcData.itemsByName.stone.id, 64))
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

(The exact placement idioms — creative slot 36 = hotbar 0, `Item` construction, reach handling — must be validated against the pinned mineflayer version during Task 12's integration run; fix the recipes there if the API differs. This task's contract test guarantees they type-check against mineflayer's own types, which already catches renamed methods.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/recipes.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Add the fetch happy-path test to the server suite**

Append to `test/server.test.ts`:

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
git commit -m "Ship the M1 recipe corpus with a tsc-typechecked fence contract"
```

---

### Task 10: CLI entry point

**Files:**
- Create: `src/cli.ts`
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `createCraftServer` + `endAll` (Task 8), real sources (Task 5), `mineflayerFactory` (Task 8).
- Produces: `devrig-craft` binary: no args → stdio MCP server; `worlds` → one-shot discovery JSON to stdout; `--version`. Extra ping ports via repeatable `--port N` and `DEVRIG_CRAFT_PORTS=25565,25566` env fallback (flag wins). `SIGINT`/`SIGTERM` call `endAll()` before exit so bots leave the world cleanly.

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

  it('worlds subcommand prints a JSON array', async () => {
    // --lan-port on a free ephemeral port: the test must not listen on the real
    // 4445 (it would race other tests and any real Minecraft client).
    const { stdout } = await run('npx', [
      'tsx', 'src/cli.ts', 'worlds', '--window-ms', '200', '--lan-port', '39876', '--no-default-ports',
    ])
    expect(Array.isArray(JSON.parse(stdout))).toBe(true)
  })

  it('parses --port flags and the env fallback', async () => {
    const flags = await run('npx', ['tsx', 'src/cli.ts', 'print-ports', '--port', '1', '--port', '2'])
    expect(JSON.parse(flags.stdout)).toEqual([1, 2])
    const env = await run('npx', ['tsx', 'src/cli.ts', 'print-ports'], {
      env: { ...process.env, DEVRIG_CRAFT_PORTS: '3,4' },
    })
    expect(JSON.parse(env.stdout)).toEqual([3, 4])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli.test.ts`
Expected: FAIL — cli.ts missing.

- [ ] **Step 3: Write the implementation**

`src/cli.ts`:

```ts
#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createCraftServer } from './server.js'
import { collectLanAnnouncements, pingWorld, LAN_PORT } from './discovery/sources.js'
import { buildSnapshot } from './discovery/snapshot.js'
import { mineflayerFactory } from './runtime/mineflayerFactory.js'
import { SERVER_NAME, SERVER_VERSION } from './version.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2)

function numFlag(name: string, fallback: number): number {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback
}

export function resolvePorts(argv: string[], env: NodeJS.ProcessEnv): number[] {
  const fromFlags = argv
    .flatMap((a, i) => (a === '--port' && argv[i + 1] ? [Number(argv[i + 1])] : []))
    .filter((p) => Number.isInteger(p) && p > 0 && p <= 65535)
  if (fromFlags.length > 0) return fromFlags
  const fromEnv = (env.DEVRIG_CRAFT_PORTS ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p <= 65535)
  if (fromEnv.length > 0) return fromEnv
  return argv.includes('--no-default-ports') ? [] : [25565]
}

async function main() {
  if (args.includes('--version')) {
    console.log(`${SERVER_NAME} ${SERVER_VERSION}`)
    return
  }
  const ports = resolvePorts(args, process.env)
  if (args[0] === 'print-ports') {
    console.log(JSON.stringify(ports))
    return
  }
  const lanPort = numFlag('--lan-port', LAN_PORT)
  if (args[0] === 'worlds') {
    const windowMs = numFlag('--window-ms', 1800)
    const worlds = await buildSnapshot(() => collectLanAnnouncements(windowMs, lanPort), pingWorld, ports)
    console.log(JSON.stringify(worlds, null, 2))
    return
  }
  // Default: stdio MCP server. stdout is JSON-RPC — everything else goes to stderr.
  const recipesDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'resources', 'recipes')
  const { server, endAll } = createCraftServer({
    lan: () => collectLanAnnouncements(undefined, lanPort),
    ping: pingWorld,
    botFactory: mineflayerFactory,
    recipesDir,
    extraPorts: ports,
  })
  const shutdown = (signal: string) => {
    console.error(`${SERVER_NAME}: ${signal} — disconnecting bots`)
    endAll()
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  await server.connect(new StdioServerTransport())
  console.error(`${SERVER_NAME} ${SERVER_VERSION} listening on stdio`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 4: Run tests, build, and the pack smoke**

Run: `npx vitest run test/cli.test.ts && npm test && npm run test:pack`
Expected: all PASS; `test:pack` proves the tarball ships `resources/` and its bin answers `--version` through `npx` — the actual quickstart path.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "Add devrig-craft CLI: stdio server, ports flags/env, clean shutdown, pack smoke"
```

---

### Task 11: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm test`, `npm run test:pack`, `npm run test:integration` (Tasks 1, 10, 12).
- Produces: unit CI on every push/PR; Docker integration on manual dispatch + weekly schedule (not per-PR — minutes of world generation per run).

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
  schedule:
    - cron: '17 4 * * 1'
jobs:
  unit:
    if: github.event_name == 'push' || github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run test:pack
  integration:
    if: github.event_name == 'workflow_dispatch' || github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run test:integration
```

- [ ] **Step 2: Verify and commit**

Push a branch and confirm the `unit` job runs green before merging this task. Then:

```bash
git add .github/workflows/ci.yml
git commit -m "Add CI: unit + pack smoke per PR, Docker integration on dispatch/schedule"
```

---

### Task 12: Docker integration smoke test

**Files:**
- Create: `test-integration/smoke.test.ts`, `test-integration/docker.ts`

**Interfaces:**
- Consumes: `createCraftServer` with real ping + `mineflayerFactory`, `pingWorld` (Task 5).
- Produces: proof of the whole loop against a real server, covering BOTH build paths: the deterministic `/setblock` path AND one physical `bot.placeBlock` (the product's main risk — exercised here, not first on camera). Runs ONLY via `npm run test:integration` (needs Docker; if Docker is missing the test fails — never auto-skips).

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

export async function opPlayer(id: string, name: string): Promise<void> {
  await run('docker', ['exec', id, 'rcon-cli', 'op', name])
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
import { startServer, stopServer, opPlayer, waitForReady, MC_PORT } from './docker.js'

let containerId: string
let client: Client
let worldName: string

const text = (r: any) => r.content[0].text as string
const output = (r: any) => text(r).split('\n').slice(1).join('\n') // drop the execution_id line

async function exec(code: string) {
  return client.callTool({
    name: 'craft_execute_code',
    arguments: { world_name: worldName, code, task_id: 'smoke', reason: 'integration smoke' },
  })
}

beforeAll(async () => {
  containerId = await startServer()
  await waitForReady()
  const { server } = createCraftServer({
    lan: async () => [],
    ping: pingWorld,
    botFactory: mineflayerFactory,
    recipesDir: 'resources/recipes',
    extraPorts: [MC_PORT],
  })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'smoke', version: '0.0.0' })
  await Promise.all([server.connect(st), client.connect(ct)])

  const worlds = JSON.parse(text(await client.callTool({ name: 'craft_list_worlds', arguments: {} })))
  const world = worlds.find((w: any) => w.port === MC_PORT)
  expect(world?.compatible).toBe(true)
  worldName = world.world_name

  await client.callTool({ name: 'craft_join_world', arguments: { world_name: worldName } })
  for (let i = 0; i < 90; i++) {
    const bots = JSON.parse(text(await client.callTool({ name: 'craft_list_bots', arguments: {} })))
    if (bots[0]?.state === 'ready') break
    if (bots[0]?.state === 'error') throw new Error(bots[0].error)
    await new Promise((r) => setTimeout(r, 1000))
  }
  await opPlayer(containerId, 'devrig')
}, 420000)

afterAll(async () => {
  if (containerId) await stopServer(containerId)
})

describe('end-to-end smoke', () => {
  it('builds a 3x3 platform via /setblock and verifies with blockAt', async () => {
    const res = await exec(`
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
`)
    expect(output(res)).toBe('stone blocks verified: 9/9')
  }, 120000)

  it('places one block physically via bot.placeBlock (the promo path)', async () => {
    // Deterministic reference: /setblock a dirt anchor next to the bot first,
    // then physically place on top of it — spawn terrain varies too much to
    // rely on whatever happens to be underfoot.
    const res = await exec(`
const anchor = bot.entity.position.floored().offset(2, -1, 0)
bot.chat('/setblock ' + anchor.x + ' ' + anchor.y + ' ' + anchor.z + ' minecraft:dirt')
bot.chat('/setblock ' + anchor.x + ' ' + (anchor.y + 1) + ' ' + anchor.z + ' minecraft:air')
await sleep(2000)
await bot.creative.setInventorySlot(36, new Item(mcData.itemsByName.stone.id, 1))
await sleep(500)
const ref = bot.blockAt(anchor)
await bot.placeBlock(ref, new Vec3(0, 1, 0))
await sleep(1000)
const placed = bot.blockAt(anchor.offset(0, 1, 0))
print('physically placed: ' + placed?.name)
`)
    expect(output(res)).toBe('physically placed: stone')
  }, 120000)
})
```

- [ ] **Step 3: Run the integration suite**

Run: `npm run test:integration`
Expected: 2 PASS (first run pulls the image and generates a world — minutes). **This is where the mineflayer idioms meet reality:** if `setInventorySlot`/`placeBlock`/`Item` calls fail against the pinned version, fix BOTH the test and the Task 9 recipes now, and re-run `npm test` (the fence typecheck) too.

- [ ] **Step 4: Commit**

```bash
git add test-integration/smoke.test.ts test-integration/docker.ts
git commit -m "Add Docker smoke: discover, join, command build AND physical placeBlock, verify"
```

---

## M1 acceptance gate

M1 is done when, on a clean machine:

1. `npm ci && npm test` — green (typecheck + all unit suites).
2. `npm run test:pack` — green (tarball carries resources, bin runs via npx).
3. `npm run test:integration` — 2/2 green against Docker.
4. The `unit` CI job is green on `main`.

Everything else (remaining recipes, screenshots, README, Prism manual validation, promo assets) is M2/M3 — see `docs/plans/2026-08-28-devrig-craft-m2.md`.

## Self-review notes

- Spec coverage: §4 discovery (stability, MOTD/players, port flags, parallel ping) → Tasks 2–5, 10; §5 tools (execution_id, busy lock, snake_case, M1 screenshot branch) → Task 8; §6 runtime (scope incl. goals/Movements/Item, limits, failing line, timeout→disconnect) → Tasks 6–8; §7 corpus (4 articles, tsc fences) → Task 9; §9 testing & CI → Tasks 1, 5, 9–12; §11 M1 gate → explicit section above.
- Review findings incorporated: #3–#7, #9–#16, #18(partial: feedback JSONL; captured datagram deferred to M2 with spec note), #19–#27. #1 resolved as documented limitation + timeout-disconnect (spec §2/§6); #2 resolved by widening the scope in the spec; #8/#17 moved to M2 with the screenshot success path.
- Type consistency: `worldName` camelCase is internal only; `toWire` converts at the boundary and the server test asserts no camelCase key leaks. `PingResult` produced by Task 5 matches Task 4's type. `ScriptError.timedOut` produced in Task 6 is consumed in Task 8. `tryLock` produced in Task 7 is consumed in Task 8.
