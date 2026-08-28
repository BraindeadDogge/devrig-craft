import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCraftServer } from '../src/server.js'
import { buildSnapshot } from '../src/discovery/snapshot.js'
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
    snapshot: () => buildSnapshot(async () => [], pingWorld, [MC_PORT]),
    botFactory: mineflayerFactory,
    recipesDir: 'resources/recipes',
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
bot.chat('/gamemode creative @s')
await sleep(1000)
await bot.creative.setInventorySlot(36, new Item(mcData.itemsByName.stone.id, 1))
await sleep(500)
const ref = bot.blockAt(anchor)
if (!ref) { print('anchor not loaded'); } else {
  await bot.placeBlock(ref, new Vec3(0, 1, 0))
  await sleep(1000)
  const placed = bot.blockAt(anchor.offset(0, 1, 0))
  print('physically placed: ' + (placed ? placed.name : 'unloaded'))
}
`)
    expect(output(res)).toBe('physically placed: stone')
  }, 120000)
})
