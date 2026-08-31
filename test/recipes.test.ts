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
  it('ships the 10 articles (M1 + M2 + blueprint)', async () => {
    const paths = (await allArticles()).map((a) => a.path).sort()
    expect(paths).toEqual(
      [
        'prompt/skill.md',
        'skill/blueprint.md',
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

  it('no fence swallows a tool error in an empty catch handler', async () => {
    // The placement contract's refusals ("out of arm's reach", "no line of
    // sight") are the only actionable feedback a script gets; a `.catch(() =>
    // {})` around placeBlock/dig throws them away and the model debugs blind.
    const empty = /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)/
    for (const a of await allArticles()) {
      for (const [i, fence] of jsFences(a.text).entries()) {
        expect(empty.test(fence), `${a.path} fence #${i} discards a tool error`).toBe(false)
      }
    }
  })

  it('the house build fences report per-cell outcomes, tool errors and stalled walks', async () => {
    const house = await readFile(`${RECIPES}/skill/house.md`, 'utf8')
    const fences = jsFences(house)
    // fence 0 is the lot survey; 1 and 2 are the two build phases.
    for (const i of [1, 2]) {
      for (const key of ['tally', 'errors', 'stalls']) {
        expect(fences[i], `house build fence #${i} must report ${key}`).toContain(key)
      }
    }
  })

  it('the house build fences route with pathfinder before shoving in a straight line', async () => {
    // A straight-line walk cannot get around the wall it just built, so it
    // pushes into it until the stall watchdog punches through — measured live:
    // the bot could not reach the roof and demolished its own walls instead.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      expect(fences[i], `house build fence #${i} must path around obstacles`).toContain(
        'bot.pathfinder.goto',
      )
    }
  })

  it('the house build fences work out which face is visible before clicking it', async () => {
    // The runtime refuses a click whose eye-ray does not reach that face first.
    // Brute-forcing all six faces and catching the refusal wastes the walk and
    // teaches the model nothing; the fence casts the same ray itself, first.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      expect(fences[i], `house build fence #${i} must test sight itself`).toContain(
        'bot.world.raycast',
      )
      expect(fences[i], `house build fence #${i} must pick a face, not iterate blindly`).toContain(
        'chooseFace',
      )
    }
  })

  it('humanlike teaches how to tell which face is clickable from where you stand', async () => {
    const humanlike = await readFile(`${RECIPES}/skill/humanlike.md`, 'utf8')
    expect(humanlike).toContain('bot.world.raycast')
  })

  it('the roof fence gains height deliberately and takes its scaffolding back down', async () => {
    // "Jump and click" is not how a person reaches a roof: you stand on what
    // you built, or you pillar up — and you dig the pillar out when you leave.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    expect(fences[2], 'roof fence must raise itself deliberately').toContain('raiseTo')
    expect(fences[2], 'roof fence must remove what it stood on').toContain('pillars')
  })

  it('the house build fences know where they are relative to the build, and climb out of holes', async () => {
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      expect(fences[i], `fence #${i} must report its own position vs BASE`).toContain('whereAmI')
      expect(fences[i], `fence #${i} must get itself out of a hole`).toContain('climbOutOfPit')
    }
  })

  it('humanlike teaches locating yourself against the build and getting out of a hole', async () => {
    const humanlike = await readFile(`${RECIPES}/skill/humanlike.md`, 'utf8')
    expect(humanlike).toMatch(/## Where am I/)
  })

  it('the house build fences climb to a face that is above them', async () => {
    // The measured failure: the roof and the upper wall courses sit above the
    // bot's eye, so no top face is visible from the ground and no stand-spot
    // next to them has solid ground under it. standWhereVisible found nothing,
    // returned false, and put() bumped "no face from anywhere I can stand" —
    // 60 times in one run. A person pillars up instead of giving up.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      expect(fences[i], `fence #${i} must gain height from the placement path`).toMatch(
        /standWhereVisible[\s\S]*?raiseTo/,
      )
      expect(fences[i], `fence #${i} must offer stand-spots it has to build up to`).toContain(
        'airborne',
      )
      expect(fences[i], `fence #${i} must name height as the reason it failed`).toContain(
        'above me',
      )
    }
  })

  it('raiseTo walks to the spot at its own level before pillaring up', async () => {
    // Asking the pathfinder for a goal in mid-air costs the full 12s timeout
    // and cannot succeed: there is no floor to stand on yet. Measured live as
    // 15 "walk to …: timeout" entries in a single 170s run.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      expect(fences[i], `fence #${i} must define raiseTo`).toContain('async function raiseTo')
      expect(fences[i], `fence #${i} must not path into mid-air before it has pillared`).toMatch(
        /raiseTo[\s\S]*?below the goal/,
      )
    }
  })

  it('the wall courses stand at the height of the course they are laying', async () => {
    // Every stand call in the wall phase was walkTo(sx, 0, sz): the bot laid
    // the third course and the attic from the floor, where the face it needed
    // was above its eye.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    expect(fences[1], 'wall fence must stand at the course height').toContain('standDyFor')
  })

  it('humanlike teaches reaching a face that is above you', async () => {
    const humanlike = await readFile(`${RECIPES}/skill/humanlike.md`, 'utf8')
    expect(humanlike).toMatch(/## Reaching something above you/)
    expect(humanlike).toContain('raiseTo')
  })

  it('the floor fence steps off a cell before it digs it', async () => {
    // Measured live in the user's world: digAt() ran FIRST, the bot fell into
    // the cell it had just dug, and a block cannot be placed into the cell you
    // are standing in — so the hole stayed. The old guard ran after the dig and
    // compared pos against feet-1, which is already false once you have fallen,
    // so it never fired. Result: a floor of holes with four planks in it.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    const floor = fences[1]!
    expect(floor, 'must be able to stand beside a cell').toContain('async function standBeside')
    // The invariant that matters: inside digAt, the bot gets beside the block
    // BEFORE it breaks it. A guard after the dig cannot work — once you have
    // fallen in, the hole is at your feet, not under them.
    const dig = floor.slice(floor.indexOf('async function digAt'))
    const body = dig.slice(0, dig.indexOf('\n}'))
    const beside = body.indexOf('standBeside')
    const breaks = body.indexOf('bot.dig(')
    expect(beside, 'digAt must call standBeside').toBeGreaterThan(-1)
    expect(breaks, 'digAt must break the block').toBeGreaterThan(-1)
    expect(beside, 'standBeside must run BEFORE bot.dig').toBeLessThan(breaks)
    // and standBeside must refuse the cell itself, or it re-creates the bug
    const sb = floor.slice(floor.indexOf('async function standBeside'))
    expect(sb.slice(0, sb.indexOf('\n}')), 'standBeside must never return the cell itself').toContain(
      'pos.equals(f)',
    )
  })

  it("the recipe's sight test matches the runtime's, entry face included", async () => {
    // The runtime accepts a click only if the eye-ray ENTERS through the face
    // being clicked (mineflayerFactory canSeeFace: hit.intersect vs the face
    // plane). The recipe copy stopped at "the ray reached the right block", so
    // it approved faces the contract then refused — measured live at 12 of 80
    // face tests, and 1 in 5 of everything chooseFace picked. Never the
    // reverse: the recipe test is strictly looser.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      expect(fences[i], `fence #${i} must check the ray's entry face`).toContain('intersect')
    }
    const humanlike = await readFile(`${RECIPES}/skill/humanlike.md`, 'utf8')
    expect(humanlike, 'the doctrine article must teach the same test').toContain('intersect')
  })

  it('a refused face is retried against the other faces, not given up on', async () => {
    // chooseFace returns the NEAREST usable face. When the runtime refuses it,
    // another face of the same cell often works (measured: 2 of 10). Placing
    // once and reporting "placement did not land" throws that away.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      expect(fences[i], `fence #${i} must consider every usable face`).toContain('chooseFaces')
    }
  })

  it('the stuck-walk watchdog never digs a block the design wants', async () => {
    // Measured live: three pathfinder timeouts during the roof phase let the
    // straight-line fallback tunnel through the finished shell — 22 wall
    // blocks destroyed. The watchdog exists to free the bot from terrain and
    // cannot tell a hillside from the wall it just built, so the design has to
    // tell it.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      expect(fences[i], `fence #${i} must know which blocks are its own`).toContain('partOfTheHouse')
      const walk = fences[i]!.slice(fences[i]!.indexOf('async function walkTo'))
      const body = walk.slice(0, walk.indexOf('\n}'))
      expect(body, `fence #${i}: the watchdog must check before it digs`).toContain('partOfTheHouse')
    }
  })

  it('scaffolding is dug from beside it, never from on top of it', async () => {
    // Step 2b walked to p.y + 1 — onto the pillar — and then tried to mine it.
    // The contract refused every one ("no line of sight ... 1.1 away"), so the
    // pillars stayed standing in the living room.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    const roof = fences[2]!
    expect(roof, 'the roof fence must be able to stand beside a block').toContain(
      'async function standBeside',
    )
    const cleanup = roof.slice(roof.indexOf('// pillars are scaffolding too'))
    expect(cleanup, 'the pillar cleanup must stand beside each pillar').toContain('standBeside')
    expect(cleanup, 'and must not walk onto the pillar it is removing').not.toMatch(
      /walkTo\([^)]*p\.y - y0 \+ 1/,
    )
  })

  it('a placement never targets the cell the bot is standing in', async () => {
    // The server drops such a placement in silence and mineflayer surfaces it
    // as "Event blockUpdate did not fire within 5000ms" — which reads like a
    // network fault and is almost always this instead.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      const put = fences[i]!.slice(fences[i]!.indexOf('async function put'))
      const body = put.slice(0, put.indexOf('\n}'))
      expect(body, `fence #${i}: put must notice it is standing in the target`).toContain(
        'standing there',
      )
      expect(body, `fence #${i}: and step out instead of giving up`).toContain('stepAside')
    }
  })

  it('the bed has a fallback, because placeBlock cannot seat one on 1.21.4', async () => {
    // Refused from four positions and facings, always as a silent no-op.
    // Reporting "bed refused" and moving on leaves the house without a bed.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    expect(fences[1], 'the bed must have a documented fallback').toContain('setblock')
    expect(fences[1], 'and must say which way it went in').toContain('bed by command')
  })

  it('reaches height by flying in creative, and keeps the pillar for survival', async () => {
    // Scaffolding under every single block is not how anyone builds: a creative
    // player flies, and a survival player pillars ONCE and then works outward
    // block against block. The old fence pillared per cell and filled the
    // living room with planks it then failed to remove.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      const f = fences[i]!
      expect(f, `fence #${i} must fly to height when it can`).toContain('startFlying')
      expect(f, `fence #${i} must pick the mode from the gamemode`).toContain('gameMode')
      expect(f, `fence #${i} must keep the nerd-pole for survival`).toMatch(
        /canFly[\s\S]*?jump/,
      )
    }
  })

  it('only the survival path leaves scaffolding to clean up', async () => {
    // A flown-to roof leaves nothing behind, so the cleanup must be conditional
    // rather than a phase that always runs (and always half-failed).
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    const raise = fences[1]!.slice(fences[1]!.indexOf('async function raiseTo'))
    const body = raise.slice(0, raise.indexOf('\n}'))
    const fly = body.indexOf('canFly')
    const push = body.indexOf('pillars.push')
    expect(fly, 'raiseTo must branch on canFly').toBeGreaterThan(-1)
    expect(push, 'raiseTo must still record survival scaffolding').toBeGreaterThan(-1)
    expect(fly, 'the flight branch comes first').toBeLessThan(push)
  })

  it('humanlike teaches flying for height in creative', async () => {
    const humanlike = await readFile(`${RECIPES}/skill/humanlike.md`, 'utf8')
    expect(humanlike).toContain('startFlying')
    expect(humanlike, 'and must no longer forbid flight outright').not.toContain(
      'flight is for nothing in this corpus',
    )
  })

  it('an airborne bot flies to the next cell instead of landing for each one', async () => {
    // Landing and taking off again per block is what turns a two-minute roof
    // into a 420s timeout: measured live, flyTo arrives in 0.1-0.4s, while the
    // land-then-pathfind cycle costs 3-15s per cell. A phase works either on
    // the ground or in the air; it does not alternate every block.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      const walk = fences[i]!.slice(fences[i]!.indexOf('async function walkTo'))
      const body = walk.slice(0, walk.indexOf('\n}'))
      const fly = body.indexOf('flyTo')
      const landing = body.indexOf('await land()')
      expect(fly, `fence #${i}: walkTo must reuse flight while airborne`).toBeGreaterThan(-1)
      expect(landing, `fence #${i}: walkTo must still be able to land`).toBeGreaterThan(-1)
      expect(fly, `fence #${i}: try flying BEFORE giving up the air`).toBeLessThan(landing)
    }
  })

  it('flight goes up and over the build, never straight through it', async () => {
    // mineflayer's flyTo moves the bot's position directly in 0.5-block steps
    // with NO collision check — its own comment says "straight line, so make
    // sure there's a clear path" — and finishes on `once(bot, 'move', 0)`,
    // which has no timeout. Aimed through a wall it thrashes: measured live,
    // 6s elapsed with the bot not having moved at all. So every hop is flown
    // clear of the build: up, across, down.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      const f = fences[i]!
      expect(f, `fence #${i} must route flight over the build`).toContain('flyClear')
      const fly = f.slice(f.indexOf('async function flyClear'))
      const body = fly.slice(0, fly.indexOf('\n}'))
      expect(body, `fence #${i}: flyClear must climb above the build first`).toContain('cruiseY')
      expect(body, `fence #${i}: and bound every leg`).toMatch(/flyLeg\(leg, \d+\)/)
    }
  })

  it('the helpers shared by both build fences are byte-identical', async () => {
    // design.md:112 bans a wrapper layer, so the two fences necessarily carry
    // the same helpers twice. What is NOT acceptable is for the copies to
    // drift: seesFace did exactly that, ending up looser than the runtime's
    // own check, and one placement in five was doomed before it was sent.
    // Duplication we can live with; divergence we cannot, so pin it here.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    const shared = [
      'function seesFace',
      'function chooseFaces',
      'async function walkTo',
      'async function raiseTo',
      'async function flyClear',
      'async function standWhereVisible',
      'async function stepAside',
      'async function land',
      'function whereAmI',
      'async function climbOutOfPit',
    ]
    const extract = (fence: string, name: string): string => {
      const start = fence.indexOf(name)
      expect(start, `both build fences must define ${name}`).toBeGreaterThan(-1)
      const rest = fence.slice(start)
      const end = rest.indexOf('\n}')
      expect(end, `${name} must be a complete declaration`).toBeGreaterThan(-1)
      return rest.slice(0, end + 2)
    }
    for (const name of shared) {
      const a = extract(fences[1]!, name)
      const b = extract(fences[2]!, name)
      expect(b, `${name} has drifted between Step 2a and Step 2b`).toBe(a)
    }
  })

  it("humanlike's sight test is the same code the house fences use", async () => {
    // A third copy, and the one a model reads when it builds something that is
    // not a house. If it teaches a looser test than the runtime enforces, every
    // recipe written from it inherits the same wasted clicks.
    const house = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))[1]!
    const humanlike = await readFile(`${RECIPES}/skill/humanlike.md`, 'utf8')
    const body = (src: string): string => {
      const at = src.indexOf('function seesFace')
      const rest = src.slice(at)
      return rest
        .slice(0, rest.indexOf('\n}') + 2)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.trim())
        .join('\n')
    }
    expect(body(humanlike), 'humanlike teaches a different sight test').toBe(body(house))
  })

  it('flight is flown, not teleported', async () => {
    // bot.creative.flyTo walks the ENTITY POSITION along a straight line with
    // no collision check and no timeout on its last step; the server fights it
    // and the call can simply never return. Measured alternatives in the live
    // world: `forward` + look moves a weightless bot at 2.97 blocks/s, and
    // holding velocity.y on each physics tick climbs at 7 blocks/s — both are
    // ordinary motion the server accepts. Jump and sneak do nothing at all
    // while weightless (0.00 either way), because a jump needs onGround and
    // flight never is.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      const f = fences[i]!
      expect(f, `fence #${i} must not teleport with bot.creative.flyTo`).not.toContain(
        'bot.creative.flyTo(', // the call; naming it in a comment is fine
      )
      expect(f, `fence #${i} must steer with the controls`).toContain("setControlState('forward'")
      expect(f, `fence #${i} must climb by holding velocity`).toContain('velocity.y')
      expect(f, `fence #${i} must drive that from the physics tick`).toContain('physicsTick')
    }
  })

  it('flight tries the direct hop before climbing over the build', async () => {
    // Routing up to cruise height and back down for EVERY hop costs ~20 blocks
    // of vertical travel per block placed. Measured: Step 2b ran out of 420s
    // having laid the attic deck and three columns of one slope. The climb is
    // for when the straight line is actually blocked, not for every move.
    const fences = jsFences(await readFile(`${RECIPES}/skill/house.md`, 'utf8'))
    for (const i of [1, 2]) {
      const f = fences[i]!
      const fly = f.slice(f.indexOf('async function flyClear'))
      const body = fly.slice(0, fly.indexOf('\n}'))
      const direct = body.indexOf('flyLeg(goal')
      const cruise = body.indexOf('cruiseY')
      expect(direct, `fence #${i}: flyClear must try the direct hop`).toBeGreaterThan(-1)
      expect(cruise, `fence #${i}: and still be able to climb over`).toBeGreaterThan(-1)
      expect(direct, `fence #${i}: direct first, climb second`).toBeLessThan(cruise)
    }
  })

  it('the house verify fence demands a real door and does not accept a hole', async () => {
    const house = await readFile(`${RECIPES}/skill/house.md`, 'utf8')
    expect(house).not.toContain('oak_door|air')
  })

  it('no house fence announces a finished house — only the verify verdict may', async () => {
    const house = await readFile(`${RECIPES}/skill/house.md`, 'utf8')
    for (const [i, fence] of jsFences(house).entries()) {
      const claim = /bot\.chat\([^\n]*(House done|house is done|finished the house)/i
      expect(claim.test(fence), `house fence #${i} claims completion in chat`).toBe(false)
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

  it('the index tells the agent to look at what it built', async () => {
    // Every defect found on 2026-08-29 was found by a human looking at the
    // world and saying so. A verdict of "done" that was never looked at is
    // exactly the failure this step exists to prevent.
    const raw = await readFile(`${RECIPES}/prompt/skill.md`, 'utf8')
    // Collapse whitespace so markdown line-wrapping cannot decide the result.
    const index = raw.replace(/\s+/g, ' ')
    expect(index, 'mentions craft_take_screenshot').toContain('craft_take_screenshot')
    expect(
      index,
      'tells the agent to compare what it sees against what it set out to build',
    ).toMatch(/compare .{0,80}(what you (see|built)|the pictures|them) against .{0,80}(what you (set out to build|built|meant to build)|your intent)/i)
    expect(
      index,
      'tells the agent to state a verdict and fix what is wrong',
    ).toMatch(/say plainly whether it is right.{0,120}name what is wrong and fix it/i)
  })

  it('ships the blueprint article and lists it in the index', async () => {
    const paths = (await allArticles()).map((a) => a.path)
    expect(paths).toContain('skill/blueprint.md')
    const index = await readFile(`${RECIPES}/prompt/skill.md`, 'utf8')
    expect(index).toContain('mcp-craft://skill/blueprint')
  })

  it('the blueprint article states the three plan characters', async () => {
    // A plan is only unambiguous if every character has exactly one meaning.
    // These three are the whole grammar; if the article does not pin them, two
    // readers will disagree about what a blank cell means.
    const blueprint = await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8')
    const flat = blueprint.replace(/\s+/g, ' ')
    expect(flat, 'a legend character means the block belongs there').toMatch(/legend character/i)
    expect(flat, "'.' must mean the cell has to be empty").toMatch(/`\.`[^`]{0,80}empty/i)
    expect(flat, 'a space must mean leave it alone').toMatch(/space[^`]{0,80}(leave|not mine|not yours)/i)
  })

  it('renderPlan shows the plan before anything is placed', async () => {
    const fences = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8'))
    const all = fences.join('\n')
    expect(all, 'the engine must be able to show its intent').toContain('function renderPlan')
    expect(all, 'and it prints rather than returning a blob').toMatch(/renderPlan[\s\S]{0,900}print\(/)
  })

  it('the worked example legend and plan agree, in both directions', async () => {
    // The example is what a reader copies. A legend entry no row uses ships a
    // building missing that feature (a house with no windows) plus a dead
    // legend line; a row character with no legend entry is a cell that cannot
    // be built at all. renderPlan warns about the second at runtime and says
    // nothing about the first, so the example itself has to be right.
    const fence = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8'))[0]!
    const legendSrc = /^const LEGEND = \{.*\}$/m.exec(fence)
    const planSrc = /^const PLAN = \[[\s\S]*?^\]$/m.exec(fence)
    expect(legendSrc, 'the example must declare a LEGEND literal').not.toBeNull()
    expect(planSrc, 'the example must declare a PLAN literal').not.toBeNull()
    const { LEGEND, PLAN } = new Function(
      `${legendSrc![0]}\n${planSrc![0]}\nreturn { LEGEND, PLAN }`,
    )() as { LEGEND: Record<string, string>; PLAN: Array<{ y: number; rows: string[] }> }

    const used = new Set(
      PLAN.flatMap((l) => l.rows.join('').split('')).filter((c) => c !== '.' && c !== ' '),
    )
    const declared = new Set(Object.keys(LEGEND))
    const unused = [...declared].filter((c) => !used.has(c))
    const undeclared = [...used].filter((c) => !declared.has(c))
    expect(unused, `LEGEND declares ${unused.join(', ')} but no row uses it`).toEqual([])
    expect(undeclared, `rows use ${undeclared.join(', ')} with no LEGEND entry`).toEqual([])
  })

  it('the worked example is a rectangular grid, as the article demands of any plan', async () => {
    // "Every row the same length, every layer the same number of rows" is the
    // article's own rule; an example that breaks it teaches the exception.
    const fence = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8'))[0]!
    const planSrc = /^const PLAN = \[[\s\S]*?^\]$/m.exec(fence)!
    const PLAN = new Function(`${planSrc[0]}\nreturn PLAN`)() as Array<{ rows: string[] }>
    const widths = new Set(PLAN.flatMap((l) => l.rows.map((r) => r.length)))
    const depths = new Set(PLAN.map((l) => l.rows.length))
    expect([...widths], 'ragged row lengths in the example').toHaveLength(1)
    expect([...depths], 'layers of differing depth in the example').toHaveLength(1)
  })
})
