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
    const dflt = await run('npx', ['tsx', 'src/cli.ts', 'print-ports'], {
      env: { ...process.env, DEVRIG_CRAFT_PORTS: '' },
    })
    expect(JSON.parse(dflt.stdout)).toEqual([25565])
  })
}, 60000)
