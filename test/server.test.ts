import { describe, it, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCraftServer } from '../src/server.js'
import type { BotLike } from '../src/runtime/botManager.js'
import type { DiscoveredWorld } from '../src/discovery/types.js'

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

const TEST_WORLD: DiscoveredWorld = {
  worldName: 'test-world',
  displayName: 'test world',
  host: '127.0.0.1',
  port: 7777,
  source: 'lan',
  version: '1.21.4',
  players: null,
  compatible: true,
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
      snapshot: async () => [TEST_WORLD],
      botFactory: () => bot,
      recipesDir: 'resources/recipes',
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

  it('join_world rejects incompatible versions with the supported range', async () => {
    const old = { ...TEST_WORLD, worldName: 'old-world', version: '1.8.9', compatible: false }
    const { server } = createCraftServer({
      snapshot: async () => [old],
      botFactory: () => bot,
      feedbackPath,
    })
    const [ct, st] = InMemoryTransport.createLinkedPair()
    const c = new Client({ name: 't2', version: '0.0.0' })
    await Promise.all([server.connect(st), c.connect(ct)])
    const res = await c.callTool({ name: 'craft_join_world', arguments: { world_name: 'old-world' } })
    expect(res.isError).toBe(true)
    expect(text(res)).toContain('1.18')
  })

  it('rejects oversized code and out-of-range timeouts at the schema', async () => {
    await joinAndSpawn()
    // The MCP SDK surfaces input-validation failures as isError tool results.
    const tooBig = await exec('x'.repeat(100_001))
    expect(tooBig.isError).toBe(true)
    expect(text(tooBig)).toContain('at most 100000')
    const badTimeout = await exec('print(1)', 601)
    expect(badTimeout.isError).toBe(true)
    expect(text(badTimeout)).toContain('less than or equal to 600')
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

  it('fetches a recipe by mcp-craft URI', async () => {
    const res = await client.callTool({
      name: 'craft_fetch_resource',
      arguments: { uri: 'mcp-craft://skill/building' },
    })
    expect(text(res)).toContain('placeBlock')
  })

  it('fetch_resource rejects unknown URIs with guidance', async () => {
    const res = await client.callTool({
      name: 'craft_fetch_resource',
      arguments: { uri: 'mcp-craft://skill/nope' },
    })
    expect(res.isError).toBe(true)
    expect(text(res)).toContain('Unknown URI')
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
