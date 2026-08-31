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

// The build engine used to be house.md's two build fences; it is blueprint.md's
// build fence now (house.md is a design guide with a worked plan). Every lesson
// pinned through this helper was paid for in a live world against the house
// recipe — the code moved, so the pin moves with it rather than being deleted.
// A worked example is what a reader copies, so it has to be right. Parse the
// literals out of the article and run them rather than grepping at the text.
function workedPlan(md: string): {
  LEGEND: Record<string, string>
  PLAN: Array<{ y: number; rows: string[] }>
} {
  const fence = jsFences(md).find((f) => /^const LEGEND = /m.test(f))
  expect(fence, 'the article must declare its worked example in a js fence').toBeDefined()
  const legendSrc = /^const LEGEND = \{.*\}$/m.exec(fence!)
  const planSrc = /^const PLAN = \[[\s\S]*?^\]$/m.exec(fence!)
  expect(legendSrc, 'the example must declare a LEGEND literal').not.toBeNull()
  expect(planSrc, 'the example must declare a PLAN literal').not.toBeNull()
  return new Function(`${legendSrc![0]}\n${planSrc![0]}\nreturn { LEGEND, PLAN }`)() as {
    LEGEND: Record<string, string>
    PLAN: Array<{ y: number; rows: string[] }>
  }
}

async function engineFence(): Promise<string> {
  const fences = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8'))
  const build = fences.find((f) => f.includes('async function buildPlan'))
  expect(build, 'blueprint.md must carry a fence defining buildPlan').toBeDefined()
  return build!
}

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

  it('the build engine tests that it can move before it places anything', async () => {
    // A rejoining bot spawns where it disconnected — boxed into leftovers, or
    // left HOVERING by server-side flight state, which the pathfinder cannot
    // route at all (measured: 21 cancelled goals, 0 blocks in 160s). A walk
    // test passes while flying, so altitude comes first. This was house.md's
    // ensureMobile, which the prompt index points at by name; it moved into the
    // engine with the rest of the prelude.
    const fence = await engineFence()
    expect(fence, 'the engine must carry the mobility self-test').toContain(
      'async function ensureMobile',
    )
    const call = fence.indexOf('await ensureMobile()')
    const build = fence.indexOf('await buildPlan()')
    expect(call, 'and must actually run it').toBeGreaterThan(-1)
    expect(build, 'and must run it before the build').toBeGreaterThan(call)
    const index = await readFile(`${RECIPES}/prompt/skill.md`, 'utf8')
    expect(index, "the index's rule 10 must point where the helper now lives").toMatch(
      /ensureMobile[^.]{0,80}mcp-craft:\/\/skill\/blueprint/,
    )
  })

  it('the build engine reports per-cell outcomes, tool errors and stalled walks', async () => {
    const fence = await engineFence()
    for (const key of ['tally', 'errors', 'stalls']) {
      expect(fence, `the build engine must report ${key}`).toContain(key)
    }
  })

  it('the build engine routes with pathfinder before shoving in a straight line', async () => {
    // A straight-line walk cannot get around the wall it just built, so it
    // pushes into it until the stall watchdog punches through — measured live:
    // the bot could not reach the roof and demolished its own walls instead.
    expect(await engineFence(), 'the build engine must path around obstacles').toContain(
      'bot.pathfinder.goto',
    )
  })

  it('the build engine works out which face is visible before clicking it', async () => {
    // The runtime refuses a click whose eye-ray does not reach that face first.
    // Brute-forcing all six faces and catching the refusal wastes the walk and
    // teaches the model nothing; the fence casts the same ray itself, first.
    const fence = await engineFence()
    expect(fence, 'the build engine must test sight itself').toContain('bot.world.raycast')
    expect(fence, 'the build engine must pick a face, not iterate blindly').toContain('chooseFace')
  })

  it('humanlike teaches how to tell which face is clickable from where you stand', async () => {
    const humanlike = await readFile(`${RECIPES}/skill/humanlike.md`, 'utf8')
    expect(humanlike).toContain('bot.world.raycast')
  })

  it('the build engine gains height deliberately and takes its scaffolding back down', async () => {
    // "Jump and click" is not how a person reaches a roof: you stand on what
    // you built, or you pillar up — and you dig the pillar out when you leave.
    // house.md's Step 2b owned that cleanup; the engine that replaced it has to
    // own it too, or a survival run ends with plank towers in the living room
    // (measured live: thirteen of them).
    const fence = await engineFence()
    expect(fence, 'the engine must raise itself deliberately').toContain('raiseTo')
    expect(fence, 'the engine must remove what it stood on').toContain(
      'pillars are scaffolding too',
    )
  })

  it('the build engine knows where it is relative to the build, and climbs out of holes', async () => {
    const fence = await engineFence()
    expect(fence, 'the engine must report its own position vs BASE').toContain('whereAmI')
    expect(fence, 'the engine must get itself out of a hole').toContain('climbOutOfPit')
  })

  it('humanlike teaches locating yourself against the build and getting out of a hole', async () => {
    const humanlike = await readFile(`${RECIPES}/skill/humanlike.md`, 'utf8')
    expect(humanlike).toMatch(/## Where am I/)
  })

  it('the build engine climbs to a face that is above it', async () => {
    // The measured failure: the roof and the upper wall courses sit above the
    // bot's eye, so no top face is visible from the ground and no stand-spot
    // next to them has solid ground under it. standWhereVisible found nothing,
    // returned false, and put() bumped "no face from anywhere I can stand" —
    // 60 times in one run. A person pillars up instead of giving up.
    const fence = await engineFence()
    expect(fence, 'the engine must gain height from the placement path').toMatch(
      /standWhereVisible[\s\S]*?raiseTo/,
    )
    expect(fence, 'the engine must offer stand-spots it has to build up to').toContain('airborne')
    expect(fence, 'the engine must name height as the reason it failed').toContain('above me')
  })

  it('raiseTo walks to the spot at its own level before pillaring up', async () => {
    // Asking the pathfinder for a goal in mid-air costs the full 12s timeout
    // and cannot succeed: there is no floor to stand on yet. Measured live as
    // 15 "walk to …: timeout" entries in a single 170s run.
    const fence = await engineFence()
    expect(fence, 'the engine must define raiseTo').toContain('async function raiseTo')
    expect(fence, 'raiseTo must not path into mid-air before it has pillared').toMatch(
      /raiseTo[\s\S]*?below the goal/,
    )
  })

  it('the engine lays a course from the height of that course, not from the floor', async () => {
    // Every stand call in house.md's wall phase was walkTo(sx, 0, sz): the bot
    // laid the third course and the attic from the floor, where the face it
    // needed was above its eye. house.md fixed that with standDyFor — a stand
    // height computed from the course number, which only a FIXED shape can do.
    // The engine has no courses to count, so standDyFor genuinely died with the
    // hardcoded house; the guarantee itself lives on in two places, both still
    // pinned: the placement path (standWhereVisible offers airborne perches and
    // raiseTo reaches them — see 'the build engine climbs to a face that is
    // above it') and the article's prose, which is what a model reads before it
    // writes a plan of its own.
    const blueprint = await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8')
    expect(
      blueprint.replace(/\s+/g, ' '),
      'blueprint.md must still teach standing at the height of the course',
    ).toMatch(/height of the course/i)
  })

  it('humanlike teaches reaching a face that is above you', async () => {
    const humanlike = await readFile(`${RECIPES}/skill/humanlike.md`, 'utf8')
    expect(humanlike).toMatch(/## Reaching something above you/)
    expect(humanlike).toContain('raiseTo')
  })

  it('the engine steps off a cell before it digs it', async () => {
    // Measured live in the user's world: digAt() ran FIRST, the bot fell into
    // the cell it had just dug, and a block cannot be placed into the cell you
    // are standing in — so the hole stayed. The old guard ran after the dig and
    // compared pos against feet-1, which is already false once you have fallen,
    // so it never fired. Result: a floor of holes with four planks in it.
    const floor = await engineFence()
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
    expect(await engineFence(), "the engine must check the ray's entry face").toContain('intersect')
    const humanlike = await readFile(`${RECIPES}/skill/humanlike.md`, 'utf8')
    expect(humanlike, 'the doctrine article must teach the same test').toContain('intersect')
  })

  it('a refused face is retried against the other faces, not given up on', async () => {
    // chooseFace returns the NEAREST usable face. When the runtime refuses it,
    // another face of the same cell often works (measured: 2 of 10). Placing
    // once and reporting "placement did not land" throws that away.
    expect(await engineFence(), 'the engine must consider every usable face').toContain(
      'chooseFaces',
    )
  })

  it('the stuck-walk watchdog never digs a block the design wants', async () => {
    // Measured live: three pathfinder timeouts during the roof phase let the
    // straight-line fallback tunnel through the finished shell — 22 wall
    // blocks destroyed. The watchdog exists to free the bot from terrain and
    // cannot tell a hillside from the wall it just built, so the design has to
    // tell it. house.md told it from a hardcoded footprint (partOfTheHouse);
    // the engine asks the plan instead (partOfTheBuild), so it is right for any
    // shape without the design being stated twice.
    const fence = await engineFence()
    expect(fence, 'the engine must know which blocks are its own').toContain('partOfTheBuild')
    const walk = fence.slice(fence.indexOf('async function walkTo'))
    const body = walk.slice(0, walk.indexOf('\n}'))
    expect(body, 'the watchdog must check before it digs').toContain('partOfTheBuild')
  })

  it('scaffolding is dug from beside it, never from on top of it', async () => {
    // Step 2b walked to p.y + 1 — onto the pillar — and then tried to mine it.
    // The contract refused every one ("no line of sight ... 1.1 away"), so the
    // pillars stayed standing in the living room.
    const roof = await engineFence()
    expect(roof, 'the engine must be able to stand beside a block').toContain(
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
    const fence = await engineFence()
    const put = fence.slice(fence.indexOf('async function put'))
    const body = put.slice(0, put.indexOf('\n}'))
    expect(body, 'put must notice it is standing in the target').toContain('standing there')
    expect(body, 'and step out instead of giving up').toContain('stepAside')
  })

  it('the bed has a fallback, because placeBlock cannot seat one on 1.21.4', async () => {
    // Refused from four positions and facings, always as a silent no-op.
    // Reporting "bed refused" and moving on leaves the house without a bed.
    // A two-cell block is not something a plan can express either, so this
    // lesson is now house.md's prose rather than a fence — but it still has to
    // be written down somewhere, or the next model rediscovers it the hard way.
    const flat = (await readFile(`${RECIPES}/skill/house.md`, 'utf8')).replace(/\s+/g, ' ')
    expect(flat, 'the article must say placeBlock cannot seat a bed here').toMatch(
      /bed[^.]{0,200}(placeBlock|by hand)/i,
    )
    expect(flat, 'and must give the command that does work').toContain('setblock')
    expect(flat, 'naming the version it was measured on').toContain('1.21.4')
  })

  it('reaches height by flying in creative, and keeps the pillar for survival', async () => {
    // Scaffolding under every single block is not how anyone builds: a creative
    // player flies, and a survival player pillars ONCE and then works outward
    // block against block. The old fence pillared per cell and filled the
    // living room with planks it then failed to remove.
    const f = await engineFence()
    expect(f, 'the engine must fly to height when it can').toContain('startFlying')
    expect(f, 'the engine must pick the mode from the gamemode').toContain('gameMode')
    expect(f, 'the engine must keep the nerd-pole for survival').toMatch(/canFly[\s\S]*?jump/)
  })

  it('only the survival path leaves scaffolding to clean up', async () => {
    // A flown-to roof leaves nothing behind, so the cleanup must be conditional
    // rather than a phase that always runs (and always half-failed).
    const fence = await engineFence()
    const raise = fence.slice(fence.indexOf('async function raiseTo'))
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
    //
    // The needle is the CALL, not the word: the old assertion looked for
    // 'flyTo', which the explanatory comment above walkTo also contains — so it
    // would have passed on prose alone with the flight removed.
    const fence = await engineFence()
    const walk = fence.slice(fence.indexOf('async function walkTo'))
    const body = walk.slice(0, walk.indexOf('\n}'))
    const fly = body.indexOf('await flyClear(')
    const landing = body.indexOf('await land()')
    expect(fly, 'walkTo must reuse flight while airborne').toBeGreaterThan(-1)
    expect(landing, 'walkTo must still be able to land').toBeGreaterThan(-1)
    expect(fly, 'try flying BEFORE giving up the air').toBeLessThan(landing)
  })

  it('flight goes up and over the build, never straight through it', async () => {
    // mineflayer's flyTo moves the bot's position directly in 0.5-block steps
    // with NO collision check — its own comment says "straight line, so make
    // sure there's a clear path" — and finishes on `once(bot, 'move', 0)`,
    // which has no timeout. Aimed through a wall it thrashes: measured live,
    // 6s elapsed with the bot not having moved at all. So every hop is flown
    // clear of the build: up, across, down.
    const f = await engineFence()
    expect(f, 'the engine must route flight over the build').toContain('flyClear')
    const fly = f.slice(f.indexOf('async function flyClear'))
    const body = fly.slice(0, fly.indexOf('\n}'))
    expect(body, 'flyClear must climb above the build first').toContain('cruiseY')
    expect(body, 'and bound every leg').toMatch(/flyLeg\(leg, \d+\)/)
  })

  it('every blueprint fence that restates LEGEND or PLAN states it identically', async () => {
    // design.md:112 bans a wrapper layer, so each fence is a self-contained
    // script and the plan literals are necessarily written out in all of them
    // (renderPlan, buildPlan, verifyPlan). What is NOT acceptable is for the
    // copies to drift: seesFace did exactly that between house.md's two build
    // fences, ending up looser than the runtime's own check, and one placement
    // in five was doomed before it was sent. Duplication we can live with;
    // divergence we cannot, so pin it here. (The build-vs-verify test at the
    // bottom of this file also pins BASE and planAt, which fence 0 does not
    // carry; this one covers all three copies of the plan itself.)
    const fences = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8'))
    const literals: Array<[string, RegExp]> = [
      ['LEGEND', /^const LEGEND = \{.*\}$/m],
      ['PLAN', /^const PLAN = \[[\s\S]*?^\]$/m],
    ]
    for (const [label, re] of literals) {
      const copies = fences
        .map((f) => re.exec(f)?.[0])
        .filter((x): x is string => x !== undefined)
      expect(copies.length, `${label} must be stated by more than one fence`).toBeGreaterThan(1)
      for (const copy of copies) expect(copy, `${label} has drifted between fences`).toBe(copies[0])
    }
  })

  it("humanlike's sight test is the same code the engine uses", async () => {
    // The second copy, and the one a model reads when it builds something that
    // is not a house. If it teaches a looser test than the runtime enforces,
    // every recipe written from it inherits the same wasted clicks.
    const house = await engineFence()
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
    const f = await engineFence()
    expect(f, 'the engine must not teleport with bot.creative.flyTo').not.toContain(
      'bot.creative.flyTo(', // the call; naming it in a comment is fine
    )
    expect(f, 'the engine must steer with the controls').toContain("setControlState('forward'")
    expect(f, 'the engine must climb by holding velocity').toContain('velocity.y')
    expect(f, 'the engine must drive that from the physics tick').toContain('physicsTick')
  })

  it('flight tries the direct hop before climbing over the build', async () => {
    // Routing up to cruise height and back down for EVERY hop costs ~20 blocks
    // of vertical travel per block placed. Measured: Step 2b ran out of 420s
    // having laid the attic deck and three columns of one slope. The climb is
    // for when the straight line is actually blocked, not for every move.
    const f = await engineFence()
    const fly = f.slice(f.indexOf('async function flyClear'))
    const body = fly.slice(0, fly.indexOf('\n}'))
    const direct = body.indexOf('flyLeg(goal')
    const cruise = body.indexOf('cruiseY')
    expect(direct, 'flyClear must try the direct hop').toBeGreaterThan(-1)
    expect(cruise, 'and still be able to climb over').toBeGreaterThan(-1)
    expect(direct, 'direct first, climb second').toBeLessThan(cruise)
  })

  it('the worked house plan puts a real door in the wall, and never a hole', async () => {
    // The old verify fence accepted 'oak_door|air' for the door cell, which
    // passes an open doorway off as a house. A plan cannot make that mistake by
    // accident — a cell is a legend character or '.', never both — but it can
    // still be drawn with no door at all, so check the example itself.
    const house = await readFile(`${RECIPES}/skill/house.md`, 'utf8')
    expect(house, 'never accept a hole where the door goes').not.toContain('oak_door|air')
    const { LEGEND, PLAN } = workedPlan(house)
    const doorChars = Object.entries(LEGEND)
      .filter(([, mat]) => mat === 'oak_door')
      .map(([ch]) => ch)
    expect(doorChars, 'the legend must name a door').toHaveLength(1)
    const used = new Set(PLAN.flatMap((l) => l.rows.join('').split('')))
    expect(used.has(doorChars[0]!), 'and the plan must actually place it').toBe(true)
  })

  it('no house fence announces a finished house — only the verify verdict may', async () => {
    const house = await readFile(`${RECIPES}/skill/house.md`, 'utf8')
    for (const [i, fence] of jsFences(house).entries()) {
      const claim = /bot\.chat\([^\n]*(House done|house is done|finished the house)/i
      expect(claim.test(fence), `house fence #${i} claims completion in chat`).toBe(false)
    }
  })

  it('house.md is a design guide with a worked plan, not a script', async () => {
    const house = await readFile(`${RECIPES}/skill/house.md`, 'utf8')
    const fences = jsFences(house)
    expect(fences.join('\n'), 'the house is expressed as a plan').toContain('const PLAN')
    expect(fences.join('\n'), 'with a legend').toContain('const LEGEND')
    for (const dead of ['isRing', 'isCorner', 'isWindow', 'wantAt'])
      expect(fences.join('\n'), `${dead} was the old hardcoded shape`).not.toContain(dead)
  })

  it('house.md never advises shrinking the PLAN the watchdog reads', async () => {
    // buildPlan and partOfTheBuild both read the GLOBAL PLAN. Splitting the
    // build into "layers 0-3 now, 4-6 next" leaves the finished walls outside
    // the plan on the second call, and the stuck-walk watchdog is then free to
    // tunnel out through them: measured live, three pathfinder timeouts during
    // the roof phase cost 22 wall blocks. Advice can reintroduce a regression
    // just as effectively as code, so pin the advice.
    const house = await readFile(`${RECIPES}/skill/house.md`, 'utf8')
    expect(house, 'a shrunk PLAN unguards everything it leaves out').not.toContain('PLAN.slice')
    expect(
      house.replace(/\s+/g, ' '),
      'and the article must say why the whole plan stays in every call',
    ).toMatch(/partOfTheBuild/)
  })

  it('house.md warns that the front eave lands on the second pass', async () => {
    // buildPlan sweeps each layer by row, z ascending, so at y+4 the whole z=0
    // row is reached before z=1 exists — an overhanging cell with no neighbour
    // yet has no face to click, and all seven bump "no face". It self-heals on
    // the documented re-run, but a reader who was not told will spend the run
    // debugging it. The old script built eaves last on purpose; a plan states
    // shape, not order, so that ordering knowledge has to survive as prose.
    const flat = (await readFile(`${RECIPES}/skill/house.md`, 'utf8')).replace(/\s+/g, ' ')
    expect(flat, 'the article must warn which row cannot land on the first pass').toMatch(
      /eave[^.]{0,200}second pass/i,
    )
  })

  it('house.md keeps the design knowledge a plan cannot carry', async () => {
    const flat = (await readFile(`${RECIPES}/skill/house.md`, 'utf8')).replace(/\s+/g, ' ')
    expect(flat, 'where the door goes').toMatch(/door/i)
    expect(flat, 'windows on every side').toMatch(/window/i)
    expect(flat, 'wall torches, not floor spam').toMatch(/torch/i)
    expect(flat, 'the bed cannot be placed by hand on this version').toMatch(/setblock|by command/i)
  })

  it('the worked plan is well formed', async () => {
    // A ragged plan builds a ragged house, and the engine only warns about it.
    const house = await readFile(`${RECIPES}/skill/house.md`, 'utf8')
    const rows = [...house.matchAll(/rows:\s*\[([^\]]*)\]/g)].map((m) =>
      [...m[1]!.matchAll(/'([^']*)'/g)].map((r) => r[1]!),
    )
    expect(rows.length, 'the plan must have layers').toBeGreaterThan(2)
    const widths = new Set(rows.flat().map((r) => r.length))
    const depths = new Set(rows.map((r) => r.length))
    expect(widths.size, `rows must all be the same width, got ${[...widths]}`).toBe(1)
    expect(depths.size, `layers must all have the same depth, got ${[...depths]}`).toBe(1)
  })

  it('the index sends a house request through the plan, not through a script', async () => {
    // The house row used to promise a script to copy and run. It is a design
    // guide now: the model authors a plan and the engine builds it, so the
    // index has to say that or the model looks for a fence that is not there.
    const index = (await readFile(`${RECIPES}/prompt/skill.md`, 'utf8')).replace(/\s+/g, ' ')
    const row = /\| `mcp-craft:\/\/skill\/house` \|([^|]*)\|/.exec(index)
    expect(row, 'the index must still carry a house row').not.toBeNull()
    expect(row![1], 'and it must describe a plan, not a ready-made script').toMatch(/plan/i)
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
    // Both articles carry a worked example — blueprint's toy shed and house.md's
    // oak starter house — and a reader is as likely to copy one as the other.
    for (const article of ['skill/blueprint.md', 'skill/house.md']) {
      const { LEGEND, PLAN } = workedPlan(await readFile(`${RECIPES}/${article}`, 'utf8'))
      const used = new Set(
        PLAN.flatMap((l) => l.rows.join('').split('')).filter((c) => c !== '.' && c !== ' '),
      )
      const declared = new Set(Object.keys(LEGEND))
      const unused = [...declared].filter((c) => !used.has(c))
      const undeclared = [...used].filter((c) => !declared.has(c))
      expect(unused, `${article}: LEGEND declares ${unused.join(', ')} but no row uses it`).toEqual(
        [],
      )
      expect(
        undeclared,
        `${article}: rows use ${undeclared.join(', ')} with no LEGEND entry`,
      ).toEqual([])
    }
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

  it('buildPlan drives everything from the plan, not from predicates', async () => {
    const fences = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8')).join('\n')
    expect(fences).toContain('async function buildPlan')
    // the engine must not carry the old house-shaped predicates
    for (const dead of ['isRing', 'isCorner', 'isWindow', 'wantAt'])
      expect(fences, `${dead} is house-specific; the engine reads the plan`).not.toContain(dead)
  })

  it('the engine keeps the movement lessons the house recipe paid for', async () => {
    // Each of these exists because a live run failed without it. Losing one in
    // the rewrite would re-open a defect that took a day to find.
    const fences = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8')).join('\n')
    for (const helper of ['standBeside', 'stepAside', 'chooseFaces', 'flyClear', 'raiseTo'])
      expect(fences, `${helper} must survive into the engine`).toContain(`function ${helper}`)
    expect(fences, 'the sight test must check the ray entry face').toContain('intersect')
    expect(fences, 'flight must not use the teleporting flyTo').not.toContain('bot.creative.flyTo(')
  })

  it('the engine will not dig a cell its own plan wants filled', async () => {
    const fences = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8')).join('\n')
    expect(fences, 'the stuck-walk watchdog needs a plan-driven guard').toMatch(
      /partOfTheBuild|partOfThePlan/,
    )
  })

  it('the movement prelude exists in exactly one fence, so no copy can drift', async () => {
    // This test used to pin blueprint.md's engine prelude byte-identical to
    // house.md's Step 2a copy. house.md is a design guide now and carries no
    // prelude at all, so there is no second copy left to pin — and a pin with
    // one side missing is not a weaker test, it is no test. What still matters
    // is what the pin protected against: a SECOND copy appearing and then
    // drifting, which is how seesFace ended up looser than the runtime's own
    // check. So assert the count instead, helper by helper. If a later edit
    // copies any of these into another fence, this fails, and whoever did it
    // must add a byte-identical pin — exactly as "blueprint's build and verify
    // fences state LEGEND, PLAN, BASE and planAt identically" does below for
    // the literals that genuinely are stated twice.
    //
    // The one deliberate cross-file copy that remains, humanlike.md's
    // seesFace, is pinned by "humanlike's sight test is the same code the
    // engine uses" above.
    const fences = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8'))
    const prelude = [
      'ensureMobile',
      'land',
      'flyLeg',
      'flyClear',
      'raiseTo',
      'stepAside',
      'standWhereVisible',
      'standBeside',
      'digAt',
      'seesFace',
      'seesBlockCentre',
      'chooseFaces',
      'chooseFace',
      'whereAmI',
      'climbOutOfPit',
      'approach',
      'noFaceReason',
      'put',
      'walkTo',
    ]
    for (const name of prelude) {
      const re = new RegExp(`(?:async function|function|const) ${name}\\b`)
      const holders = fences.filter((f) => re.test(f))
      expect(
        holders.length,
        `${name} is declared in ${holders.length} fences — one copy needs no pin, two need a byte-identical one`,
      ).toBe(1)
    }
  })

  it('planAt resolves a legend character to material, air, or "not mine" — and tells unknown apart from blank', async () => {
    // The text assertions above are not wrong, just insufficient: they never
    // execute planAt. It is a pure function with no bot dependency, so it can
    // run for real, exactly like the LEGEND/PLAN literal test above.
    const fence = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8'))[1]!
    const start = fence.indexOf('const planAt = ')
    expect(start, 'the engine must define planAt').toBeGreaterThan(-1)
    const rest = fence.slice(start)
    const end = rest.indexOf('\n}')
    const planAtSrc = rest.slice(0, end + 2)

    const planAt = new Function(`${planAtSrc}\nreturn planAt`)() as (
      plan: Array<{ y: number; rows: string[] }>,
      legend: Record<string, string>,
      dx: number,
      dy: number,
      dz: number,
    ) => string | null | undefined

    const legend = { L: 'oak_log', D: 'oak_door' }
    const plan = [{ y: 0, rows: ['L.D', 'L X'] }]

    expect(planAt(plan, legend, 0, 0, 0), 'a legend character resolves to its material').toBe(
      'oak_log',
    )
    expect(planAt(plan, legend, 1, 0, 0), "'.' means the cell must be empty").toBe('air')
    expect(planAt(plan, legend, 1, 0, 1), 'a space is not mine').toBeUndefined()
    expect(
      planAt(plan, legend, 2, 0, 1),
      'a character with no legend entry must not read the same as a space',
    ).toBeNull()
    expect(
      planAt(plan, legend, 2, 0, 1),
      'unknown-legend and not-mine must be distinguishable',
    ).not.toBe(planAt(plan, legend, 1, 0, 1))
  })

  it('verifyPlan reads the same plan the builder read', async () => {
    // The whole point: the shape is stated once. If verify carried its own copy
    // of the design, the two could disagree — which is the defect this replaces.
    const fences = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8')).join('\n')
    expect(fences).toContain('async function verifyPlan')
    expect(fences, 'verify must go through the same planAt as the builder').toMatch(
      /verifyPlan[\s\S]{0,1200}planAt\(/,
    )
  })

  it("verifyPlan reports the diff in the plan's own characters", async () => {
    // A diff you can lay over the plan you wrote is readable; a list of
    // coordinates is not.
    const blueprint = await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8')
    const flat = blueprint.replace(/\s+/g, ' ')
    expect(flat).toMatch(/same characters|plan's own characters|character grid/i)
  })

  it('only the verify step may announce that a build is finished', async () => {
    // A "done" that never read the world back is how a floor of holes gets
    // reported as a floor.
    const blueprint = await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8')
    for (const [i, fence] of jsFences(blueprint).entries()) {
      const claim = /bot\.chat\([^\n]*(is done|finished|all built|complete)/i
      if (!fence.includes('verifyPlan')) {
        expect(claim.test(fence), `blueprint fence #${i} claims completion without verifying`).toBe(
          false,
        )
      }
    }
  })

  it('verifyPlan reads BASE/PLAN/LEGEND as globals, matching buildPlan\'s convention', async () => {
    // Task 2 pinned buildPlan()/partOfTheBuild(p) to reading globals rather
    // than taking parameters, because put/walkTo are copied byte-identical
    // from house.md's global-reading versions. verifyPlan must follow the
    // same convention, or the two engines disagree about how a plan is passed.
    const fences = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8')).join('\n')
    expect(fences, 'verifyPlan must take no arguments').toMatch(/async function verifyPlan\(\s*\)/)
  })

  it('verifyPlan renders the diff in the plan\'s own characters and separates a plan defect from a wrong block', async () => {
    // The text assertions above are not wrong, just insufficient: this actually
    // runs verifyPlan's diff logic against a small synthetic world, the same
    // way the planAt test above executes a pure function extracted from the
    // fence instead of only grepping for it.
    const fences = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8'))
    const verifyFence = fences.find((f) => f.includes('async function verifyPlan'))!
    const start = verifyFence.indexOf('const planAt = ')
    const invocationStart = verifyFence.indexOf('const verdict = await verifyPlan()')
    expect(start, 'verify fence must define planAt').toBeGreaterThan(-1)
    expect(invocationStart, 'verify fence must call verifyPlan()').toBeGreaterThan(-1)
    // Slice out just planAt + verifyPlan, dropping the fence's own hardcoded
    // BASE/PLAN/LEGEND literals so the test can supply its own via closure
    // parameters instead (a `const` of the same name in the same scope as a
    // parameter would be a SyntaxError).
    const engineSrc = verifyFence.slice(start, invocationStart)

    const printed: string[] = []
    const chats: string[] = []
    // Column meaning, left to right ('LXSS. .'):
    //   0 'L' matches            — world holds oak_log, plan wants oak_log
    //   1 'X' plan defect        — no LEGEND entry at all
    //   2 'S' missing            — plan wants stone, world holds nothing
    //   3 'S' wrong solid        — plan wants stone, world holds granite
    //       (a DIFFERENT solid block — the case the old '#' assertion never
    //       exercised, since it only covered an air-wanted cell)
    //   4 '.' wrong non-solid    — plan wants air, world holds a torch. This
    //       is the regression case for the bug: collapsing every non-block
    //       occupant to 'air' before comparing reported a placed torch as
    //       "missing" forever, no matter how many times it was placed.
    //   5 ' ' not mine           — world holds a solid block there too, but
    //       a space must never be reported on at all
    //   6 '.' matches empty      — plan wants air, world is genuinely empty
    const worldBlocks: Record<string, { name: string; boundingBox: string }> = {
      '0,0,0': { name: 'oak_log', boundingBox: 'block' },
      // 2,0,0 deliberately absent: the plan wants 'stone' there — missing
      '3,0,0': { name: 'granite', boundingBox: 'block' },
      '4,0,0': { name: 'torch', boundingBox: 'empty' },
      '5,0,0': { name: 'diamond_block', boundingBox: 'block' }, // must be ignored
      // 6,0,0 deliberately absent: genuinely empty, matches the air the plan wants
    }
    const bot = {
      blockAt: (p: { x: number; y: number; z: number }) =>
        worldBlocks[`${p.x},${p.y},${p.z}`] ?? null,
      chat: (m: string) => chats.push(m),
    }
    const BASE = { offset: (dx: number, dy: number, dz: number) => ({ x: dx, y: dy, z: dz }) }
    const LEGEND = { L: 'oak_log', S: 'stone' } // 'X' below has no entry — a plan defect
    const PLAN = [{ y: 0, rows: ['LXSS. .'] }]

    const run = new Function(
      'bot',
      'print',
      'printJson',
      'BASE',
      'PLAN',
      'LEGEND',
      `${engineSrc}\nreturn verifyPlan()`,
    ) as (
      bot: unknown,
      print: (...a: unknown[]) => void,
      printJson: (v: unknown) => void,
      BASE: unknown,
      PLAN: unknown,
      LEGEND: unknown,
    ) => Promise<{
      ok: number
      total: number
      wrong: Array<{ at: number[]; want: string; got: string }>
      planDefects: Array<{ at: number[]; ch: string }>
    }>

    const result = await run(
      bot,
      (...a: unknown[]) => printed.push(a.map(String).join(' ')),
      () => {},
      BASE,
      PLAN,
      LEGEND,
    )

    // 7 columns; 'X' (defect) and ' ' (not mine) are excluded from total.
    expect(result.total, 'the unresolved character and the space must not be scored').toBe(5)
    expect(result.ok, 'the two matching cells (a real block and real air) count as ok').toBe(2)
    expect(
      result.wrong,
      'missing, wrong-solid, and wrong-non-solid cells are all wrong — three of them',
    ).toHaveLength(3)
    expect(
      result.planDefects,
      'the unresolved character is a plan defect, not a wrong block',
    ).toHaveLength(1)
    expect(result.planDefects[0]!.ch).toBe('X')
    // The cell where the plan wants stone but the world holds granite — a
    // DIFFERENT solid block, not an absence — must show up as wrong.
    expect(
      result.wrong.some((w) => w.want === 'stone' && w.got === 'granite'),
      'a different solid block must report as wrong, not as missing',
    ).toBe(true)
    // The cell where the plan wants air but the world holds a torch: a
    // non-solid block is still a real, named block. Collapsing it to 'air'
    // before comparing (the bug) would make this cell report as a match.
    expect(
      result.wrong.some((w) => w.want === 'air' && w.got === 'torch'),
      'a placed torch must report as wrong, not silently collapse to a match on "air"',
    ).toBe(true)
    // The space column must never appear in wrong or planDefects, however
    // solid the block sitting there — it is not the plan's to judge.
    expect(result.wrong.some((w) => w.at[0] === 5)).toBe(false)
    expect(result.planDefects.some((d) => d.at[0] === 5)).toBe(false)
    // The diff line lays the plan's own characters over the outcome: a
    // matching cell keeps its letter (or '.' for matching air), the
    // unresolved character becomes '?', a missing block becomes '!', a wrong
    // block (solid or not) becomes '#', and a space stays blank.
    expect(
      printed.some((line) => line.includes('L?!## .')),
      `diff line not found in:\n${printed.join('\n')}`,
    ).toBe(true)
    expect(chats, 'an unfinished build must say so, only from verifyPlan').toHaveLength(1)
    expect(chats[0]).toMatch(/not finished/i)
  })

  it("blueprint's build and verify fences state LEGEND, PLAN, BASE and planAt identically", async () => {
    // The article's whole thesis is that build and verify cannot disagree
    // about the shape — but each fence is a self-contained script (pasted
    // into craft_execute_code on its own), so each carries its OWN copy of
    // LEGEND, PLAN, BASE and planAt. Nothing stops an edit to one copy from
    // silently diverging from the other; pin them here the same way
    // 'the engine keeps the house helpers byte-identical...' above pins the
    // movement prelude between house.md and blueprint.md.
    const fences = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8'))
    const build = fences[1]!
    const verify = fences[2]!
    expect(verify, 'the verify fence must define verifyPlan').toContain('async function verifyPlan')

    const extractMatch = (fence: string, re: RegExp, label: string): string => {
      const m = re.exec(fence)
      expect(m, `${label} not found`).not.toBeNull()
      return m![0]
    }
    // LEGEND and PLAN are compared whole (same regexes the worked-example
    // tests above use). BASE's value must match, but its trailing comment is
    // allowed to differ between the two fences (one says "your own site", the
    // other "the same site you built at") — that prose difference is not a
    // drift in the shape.
    const legendRe = /^const LEGEND = \{.*\}$/m
    const planRe = /^const PLAN = \[[\s\S]*?^\]$/m
    const baseRe = /^const BASE = new Vec3\([^)]*\)/m

    expect(
      extractMatch(verify, legendRe, 'LEGEND'),
      'LEGEND has drifted between the build and verify fences',
    ).toBe(extractMatch(build, legendRe, 'LEGEND'))
    expect(
      extractMatch(verify, planRe, 'PLAN'),
      'PLAN has drifted between the build and verify fences',
    ).toBe(extractMatch(build, planRe, 'PLAN'))
    expect(
      extractMatch(verify, baseRe, 'BASE'),
      'BASE has drifted between the build and verify fences',
    ).toBe(extractMatch(build, baseRe, 'BASE'))

    const extractDecl = (fence: string, name: string): string => {
      const re = new RegExp(`const ${name} = `)
      const m = re.exec(fence)
      expect(m, `${name} not found`).not.toBeNull()
      const rest = fence.slice(m!.index)
      const end = rest.indexOf('\n}')
      expect(end, `${name} must be a complete declaration`).toBeGreaterThan(-1)
      return rest.slice(0, end + 2)
    }
    expect(
      extractDecl(verify, 'planAt'),
      'planAt has drifted between the build and verify fences',
    ).toBe(extractDecl(build, 'planAt'))
  })

  it('the index tells the model to author and show a plan before building', async () => {
    const flat = (await readFile(`${RECIPES}/prompt/skill.md`, 'utf8')).replace(/\s+/g, ' ')
    expect(flat, 'the model writes the plan itself').toMatch(/write .{0,60}plan|author .{0,60}plan/i)
    expect(flat, 'and shows it before placing anything').toMatch(/renderPlan|before .{0,40}(build|place)/i)
  })

  it('the engine text is identical wherever it appears', async () => {
    // The sandbox has no imports, so the engine is pasted rather than called.
    // Pasted code drifts — that is exactly how seesFace ended up looser than
    // the runtime's own check. Two other tests already pin specific copies:
    // "the movement prelude exists in exactly one fence" guards blueprint.md
    // against growing a SECOND internal copy of its own helpers, and
    // "humanlike's sight test is the same code the engine uses" pins
    // humanlike.md's one deliberate copy of seesFace. Neither of those
    // catches a copy landing in some OTHER article — building.md,
    // world-queries.md, a future one — and going stale there. This test is
    // the general form: wherever a copy of a named helper turns up outside
    // blueprint.md, it must read byte-identical to blueprint's canonical
    // text. house.md carries neither helper any more (Task 4 turned it into
    // a design guide), so it is exercised here only as "found nowhere,
    // nothing to compare" — the guard still holds if that ever changes back.
    const canonical = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8')).join('\n')
    const body = (src: string, name: string): string | null => {
      const at = src.indexOf(name)
      if (at < 0) return null
      const rest = src.slice(at)
      return rest.slice(0, rest.indexOf('\n}') + 2)
    }
    for (const { path, text } of await allArticles()) {
      if (path === 'skill/blueprint.md') continue
      for (const name of ['function seesFace', 'async function standBeside']) {
        const found = body(text, name)
        if (found) expect(found, `${name} has drifted in ${path}`).toBe(body(canonical, name))
      }
    }
  })

  it('buildPlan clears a `.` cell of any occupant, not just a full block', async () => {
    // The format says a '.' cell "must be empty — the engine digs anything
    // standing there", but the air-branch only used to clear cells whose
    // occupant had boundingBox 'block'. A torch, carpet, button, pressure
    // plate or tall grass sitting in a '.' cell was reported "already clear"
    // and never touched — while verifyPlan (which judges by name, not by
    // boundingBox) correctly kept reporting the same cell wrong. That was an
    // endless "fix it" loop with no way out. Extract planAt/digAt/buildPlan
    // from the article and run them against a synthetic world, the same way
    // verifyPlan is exercised elsewhere in this file.
    //
    // What this test does NOT prove: standBeside is stubbed below as
    // unconditionally true, so this exercises the branch logic — "is this
    // treated as occupied, and does the code attempt to clear it" — with
    // sight and reachability assumed away. Whether a real, zero-collision-
    // shape occupant like an actual torch can be SEEN and dug by the live
    // runtime is a different question this synthetic harness cannot answer:
    // the runtime's own dig gate ray-casts against the same empty collision
    // shape standBeside's seesBlockCentre would ray-cast against, and for a
    // torch/button/tall-grass/etc. that ray-cast finds nothing to hit from
    // any angle, so bot.dig is refused in the live world regardless of what
    // this test shows. See the '.' cell exception documented where the
    // format defines '.', and the comment on digAt itself.
    const fences = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8'))
    const buildFence = fences.find((f) => f.includes('async function buildPlan'))!
    const bodyOf = (name: string): string => {
      const at = buildFence.indexOf(name)
      expect(at, `${name} not found in the build fence`).toBeGreaterThan(-1)
      const rest = buildFence.slice(at)
      return rest.slice(0, rest.indexOf('\n}') + 2)
    }
    const planAtSrc = bodyOf('const planAt = ')
    const digAtSrc = bodyOf('async function digAt')
    const buildPlanSrc = bodyOf('async function buildPlan')

    // x=0: a wrong SOLID block sits where the plan wants empty (must still
    // be cleared — this is the case that already worked).
    // x=1: a non-solid occupant (a torch) sits where the plan wants empty —
    // the regression case for the bug.
    // x=2: genuinely empty already (absent from the world) — must not be
    // "dug" at all.
    // x=3: a MATERIAL cell (wants cobblestone) holds a different, non-solid
    // occupant (a wall_torch) — the symmetric hole in the material branch,
    // which used to gate on boundingBox === 'block' and so never attempted
    // to clear a non-solid wrong-occupant before placing.
    const worldBlocks: Record<string, { name: string; boundingBox: string }> = {
      '0,0,0': { name: 'stone', boundingBox: 'block' },
      '1,0,0': { name: 'torch', boundingBox: 'empty' },
      '3,0,0': { name: 'wall_torch', boundingBox: 'empty' },
    }
    const dug: string[] = []
    const bot = {
      blockAt: (p: { x: number; y: number; z: number }) => worldBlocks[`${p.x},${p.y},${p.z}`] ?? null,
      dig: async (b: { name: string }) => {
        dug.push(b.name)
        const key = Object.keys(worldBlocks).find((k) => worldBlocks[k]!.name === b.name)
        if (key) delete worldBlocks[key]
      },
    }
    const tally: Record<string, number> = {}
    const bump = (r: string) => {
      tally[r] = (tally[r] ?? 0) + 1
      return r
    }
    const note = () => {}
    const standBeside = async () => true // always able to stand beside, for this test
    const sleep = async () => {}
    const printed: string[] = []
    const print = (...a: unknown[]) => printed.push(a.map(String).join(' '))
    const BASE = { offset: (dx: number, dy: number, dz: number) => ({ x: dx, y: dy, z: dz }) }
    const LEGEND = { M: 'cobblestone' } // '.' never consults the legend; M is the material cell
    const PLAN = [{ y: 0, rows: ['...M'] }]
    const pillars: unknown[] = []
    const partOfTheBuild = () => false
    const placed = 0

    const errors: Record<string, number> = {}
    const stalls = 0
    const putCalls: Array<{ dx: number; dy: number; dz: number; mat: string }> = []
    const put = async (dx: number, dy: number, dz: number, mat: string) => {
      putCalls.push({ dx, dy, dz, mat })
    }
    const run = new Function(
      'bot',
      'standBeside',
      'bump',
      'note',
      'sleep',
      'print',
      'BASE',
      'PLAN',
      'LEGEND',
      'pillars',
      'partOfTheBuild',
      'placed',
      'tally',
      'errors',
      'stalls',
      'put',
      `${planAtSrc}\n${digAtSrc}\n${buildPlanSrc}\nreturn buildPlan()`,
    ) as (
      bot: unknown,
      standBeside: unknown,
      bump: unknown,
      note: unknown,
      sleep: unknown,
      print: unknown,
      BASE: unknown,
      PLAN: unknown,
      LEGEND: unknown,
      pillars: unknown,
      partOfTheBuild: unknown,
      placed: unknown,
      tally: unknown,
      errors: unknown,
      stalls: unknown,
      put: unknown,
    ) => Promise<{ placed: number; tally: Record<string, number> }>

    await run(
      bot,
      standBeside,
      bump,
      note,
      sleep,
      print,
      BASE,
      PLAN,
      LEGEND,
      pillars,
      partOfTheBuild,
      placed,
      tally,
      errors,
      stalls,
      put,
    )

    expect(dug, 'the wrong solid block must still be cleared').toContain('stone')
    expect(dug, 'a non-solid occupant of a "." cell must be cleared too').toContain('torch')
    expect(worldBlocks['2,0,0'], 'genuine air must never be "dug"').toBeUndefined()
    expect(tally['already clear'] ?? 0, 'the genuinely empty cell counts as already clear').toBe(1)
    expect(
      dug,
      'a non-solid WRONG occupant of a material cell must be cleared too, not silently skipped to put()',
    ).toContain('wall_torch')
    expect(
      putCalls,
      'the material cell must still get its real material placed after the wrong occupant is cleared',
    ).toContainEqual({ dx: 3, dy: 0, dz: 0, mat: 'cobblestone' })
  })
})
