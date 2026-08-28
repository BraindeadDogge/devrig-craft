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
  const raw = i >= 0 ? args[i + 1] : undefined
  return raw !== undefined ? Number(raw) : fallback
}

export function resolvePorts(argv: string[], env: NodeJS.ProcessEnv): number[] {
  const valid = (p: number) => Number.isInteger(p) && p > 0 && p <= 65535
  const fromFlags = argv
    .flatMap((a, i) => (a === '--port' && argv[i + 1] !== undefined ? [Number(argv[i + 1])] : []))
    .filter(valid)
  if (fromFlags.length > 0) return fromFlags
  const fromEnv = (env.DEVRIG_CRAFT_PORTS ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(valid)
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
    snapshot: () => buildSnapshot(() => collectLanAnnouncements(undefined, lanPort), pingWorld, ports),
    botFactory: mineflayerFactory,
    recipesDir,
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
