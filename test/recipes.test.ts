import { describe, it, expect } from 'vitest'
import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const RECIPES = 'resources/recipes'
// Inside the repo so tsc resolves mineflayer types by walking up to node_modules.
const FENCE_DIR = 'build/fence-check'

// Mirrors the craft_execute_code scope EXACTLY (spec §6), so a renamed or
// misspelled mineflayer method fails the build. "types": [] does NOT keep Node
// globals out: mineflayer's own index.d.ts opens with
// /// <reference types="node" />, and an explicit reference wins over the types
// option — so `require`/`setTimeout` still compile here and are caught by the
// out-of-scope token test below instead. The mineflayer-pathfinder type import
// is what puts `bot.pathfinder` on Bot (its index.d.ts augments the mineflayer
// module), mirroring the factory's bot.loadPlugin(pathfinder).
const PRELUDE = `import type { Bot } from 'mineflayer'
import type { Pathfinder } from 'mineflayer-pathfinder'
import type { Vec3 as Vec3Class } from 'vec3'
declare const bot: Bot
declare const _pathfinder: Pathfinder
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
  it('ships the 8 articles (M1 + M2)', async () => {
    const paths = (await allArticles()).map((a) => a.path).sort()
    expect(paths).toEqual(
      [
        'prompt/skill.md',
        'skill/building-with-commands.md',
        'skill/building.md',
        'skill/design-philosophy.md',
        'skill/house.md',
        'skill/humanlike.md',
        'skill/inventory.md',
        'skill/navigation.md',
        'skill/survival.md',
        'skill/world-queries.md',
      ].sort(),
    )
  })

  it('every skill article has at least one js fence, except the prose articles', async () => {
    const proseOnly = new Set(['prompt/skill.md', 'skill/design-philosophy.md'])
    for (const a of await allArticles()) {
      if (proseOnly.has(a.path)) continue
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
    await run('npx', ['tsc', '-p', `${FENCE_DIR}/tsconfig.json`]).catch((e: unknown) => {
      const x = e as { stdout?: string; stderr?: string }
      throw new Error(`recipe fence failed to type-check:\n${x.stdout}\n${x.stderr}`)
    })
  }, 120000)

  it('no fence reaches outside the injected scope', async () => {
    // tsc cannot enforce this (see the PRELUDE comment), so assert on the text.
    const forbidden: Array<[RegExp, string]> = [
      [/\brequire\s*\(/, 'require() — nothing is importable inside a script'],
      [/^\s*import\s/m, 'import — the script body is not a module'],
      [/\bsetTimeout\s*\(/, 'setTimeout — use sleep(ms)'],
      [/\bsetInterval\s*\(/, 'setInterval — use a loop with sleep(ms)'],
      [/\bconsole\s*\./, 'console — use print()/printJson()'],
      [/\bprocess\s*\./, 'process — no Node globals in the sandbox'],
    ]
    for (const a of await allArticles()) {
      for (const [i, fence] of jsFences(a.text).entries()) {
        for (const [re, why] of forbidden) {
          expect(re.test(fence), `${a.path} fence #${i} uses ${why}`).toBe(false)
        }
      }
    }
  })

  it('the index lists every skill URI and the scope contract', async () => {
    const index = await readFile(`${RECIPES}/prompt/skill.md`, 'utf8')
    for (const name of [
      'house',
      'humanlike',
      'building',
      'building-with-commands',
      'world-queries',
      'navigation',
      'inventory',
      'survival',
      'design-philosophy',
    ]) {
      expect(index).toContain(`mcp-craft://skill/${name}`)
    }
    expect(index).toContain('no `require`')
  })
})
