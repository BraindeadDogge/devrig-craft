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
