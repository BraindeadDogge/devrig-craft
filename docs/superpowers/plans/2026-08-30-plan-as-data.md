# The build plan as data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded house script with a plan the model authors itself — ASCII layers plus a legend — that one generic engine both builds from and verifies against.

**Architecture:** A new article, `mcp-craft://skill/blueprint`, carries the format and one canonical engine: `renderPlan` (show the intent), `buildPlan` (build it), `verifyPlan` (diff the world against the same plan). `house.md` stops being a script and becomes a guide to a good house plus one worked example `PLAN`. The engine's movement and placement machinery is not new code — it is the prelude already proven in `house.md`, generalised from fixed predicates to a data-driven plan.

**Tech Stack:** Markdown recipe articles whose ```js fences compile against the `craft_execute_code` scope; vitest for the corpus tests.

**Spec:** `docs/superpowers/specs/2026-08-29-seeing-and-planning-design.md` (Part 2)

## Global Constraints

- **The sandbox has no `require` and no `import`.** `docs/design.md` §6 fixes the scope at ten names: `bot`, `Vec3`, `mcData`, `goals`, `Movements`, `Item`, `print`, `printJson`, `sleep`, `waitFor`. Every fence must compile against exactly those — `test/recipes.test.ts` enforces it.
- **`design.md:112` bans a wrapper layer.** The engine is a recipe the model pastes, never a module the runtime provides. Do not add names to the scope and do not add `craft_*` tools.
- **Duplication is tolerated; divergence is not.** Where the same helper appears twice, a test must pin the copies byte-identical. `test/recipes.test.ts` already does this for ten helpers across `house.md`'s two fences — extend that mechanism, never weaken it.
- **No empty catch** in any fence: every catch logs via `print` or rethrows.
- **Never claim a build is done without reading the world back.** Only the verify step may announce completion.
- **Never remove, disable, or weaken a failing test.**
- Commit messages say what and why. **Never mention AI, never add an AI co-author** — check `git log -1 --format=%B` after every commit; the tooling appends a trailer on its own.
- `npx tsc --noEmit` and `npm test` must both pass at the end of every task.

## The format, fixed here so every task agrees

```js
const LEGEND = { L: 'oak_log', P: 'oak_planks', o: 'glass_pane', C: 'cobblestone', D: 'oak_door' }
const PLAN = [
  { y: 0, rows: ['LCCCCCL', 'CPPPPPC'] },   // y is an offset from BASE.y
  { y: 1, rows: ['LPPDPPL', 'P.....P'] },   // rows[z] is a string indexed by x
]
```

- a legend character means **this block belongs here**
- `.` means **this must be empty** — the engine digs anything standing there
- a space means **not mine** — leave whatever is there, and do not report on it

Layers are listed bottom-up. Rows within a layer are `z` ascending. All rows in
a plan must be the same length; all layers must have the same number of rows.

---

### Task 1: The plan format and `renderPlan`

**Files:**
- Create: `resources/recipes/skill/blueprint.md`
- Modify: `resources/recipes/prompt/skill.md` — add the article to the index table
- Test: `test/recipes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the article at `mcp-craft://skill/blueprint`, and in its first ```js fence a function `renderPlan(PLAN, LEGEND)` that prints the plan as elevations and returns nothing.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('recipe corpus', …)` in `test/recipes.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/recipes.test.ts`
Expected: FAIL — `skill/blueprint.md` does not exist.

- [ ] **Step 3: Write the article's opening and `renderPlan`**

Create `resources/recipes/skill/blueprint.md`. Open with prose that states the
format exactly as the "The format" section of this plan gives it — the three
characters, bottom-up layers, `rows[z]` indexed by `x`, and the rule that all
rows are the same length. Then this fence:

```js
// A plan is data: a legend from character to block name, and one string grid
// per layer. Everything downstream — building, verifying, showing — reads THIS,
// so the shape can never be stated twice and drift.
const LEGEND = { L: 'oak_log', P: 'oak_planks', o: 'glass_pane', C: 'cobblestone', D: 'oak_door' }
const PLAN = [
  { y: 0, rows: ['LCCCCCL', 'CPPPPPC', 'CPPPPPC', 'LCCCCCL'] },
  { y: 1, rows: ['LPPDPPL', 'P.....P', 'P.....P', 'LPPPPPL'] },
]

// Show the intent BEFORE placing anything. A plan you have looked at is a plan
// you can be wrong about out loud; a plan you only executed is one you discover
// was wrong afterwards, in blocks.
function renderPlan(plan, legend) {
  const unknown = new Set()
  for (const layer of plan)
    for (const row of layer.rows)
      for (const ch of row)
        if (ch !== '.' && ch !== ' ' && !legend[ch]) unknown.add(ch)
  for (const layer of plan) {
    print(`--- y+${layer.y} ---`)
    for (const [z, row] of layer.rows.entries()) print(`z=${String(z).padStart(2)} ${row}`)
  }
  const used = [...new Set(plan.flatMap((l) => l.rows.join('').split('')))]
    .filter((c) => c !== '.' && c !== ' ')
    .sort()
  print(`legend: ${used.map((c) => `${c}=${legend[c] ?? '???'}`).join('  ')}`)
  if (unknown.size) print(`WARNING: no legend entry for ${[...unknown].join(', ')} — those cells cannot be built`)
  const widths = new Set(plan.flatMap((l) => l.rows.map((r) => r.length)))
  const depths = new Set(plan.map((l) => l.rows.length))
  if (widths.size > 1 || depths.size > 1)
    print(`WARNING: ragged plan — row lengths ${[...widths].join('/')}, layer depths ${[...depths].join('/')}`)
}

renderPlan(PLAN, LEGEND)
```

Then add the row to the index table in `resources/recipes/prompt/skill.md`,
in the same style as the rows already there, pointing at
`mcp-craft://skill/blueprint` and describing it as the plan format and the
engine that builds and verifies from it.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS. The fence-compile test now compiles the new article too.

- [ ] **Step 5: Commit**

```bash
git add resources/recipes/skill/blueprint.md resources/recipes/prompt/skill.md test/recipes.test.ts
git commit -m "Add the blueprint format, and a way to show a plan before building it

The house recipe states its shape twice — once in build predicates, once in
the verify sweep — which is the same two-copies-that-drift defect that cost a
day when seesFace diverged from the runtime check. A plan as data can only be
stated once.

renderPlan comes first because the point is to be wrong out loud: a plan you
have looked at can be corrected before it is blocks."
git log -1 --format=%B
```

---

### Task 2: `buildPlan`

**Files:**
- Modify: `resources/recipes/skill/blueprint.md`
- Test: `test/recipes.test.ts`

**Interfaces:**
- Consumes: `renderPlan` from Task 1, and the movement/placement prelude named below.
- Produces: `buildPlan(BASE, PLAN, LEGEND)` returning `{ placed, tally, errors, stalls }`.

**Where the engine's machinery comes from.** Do not write new movement code.
`resources/recipes/skill/house.md` already carries a prelude that is proven
against a live world and pinned byte-identical across its two fences by the
test `'the helpers shared by both build fences are byte-identical'`. Copy these
verbatim from `house.md`'s Step 2a fence: `land`, `flyLeg`, `flyClear`,
`raiseTo`, `walkTo`, `stepAside`, `standWhereVisible`, `standBeside`, `digAt`,
`seesFace`, `seesBlockCentre`, `chooseFaces`, `chooseFace`, `whereAmI`,
`climbOutOfPit`, plus the `tally`/`errors`/`bump`/`note` diagnostics, `eyes`,
`inReach`, `FACES`, and the `canFly`/`flying` pair.

Two of those must be **generalised**, because they currently read the house's
fixed predicates:

- `partOfTheHouse(p)` uses `wantAt`. Replace it with a plan-driven version:
  a position is the build's own if the plan has a non-space character for it.
- `put(dx, dy, dz, mat)` keeps its logic but takes the material from the plan.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/recipes.test.ts`
Expected: FAIL — `buildPlan` is not defined in the article.

- [ ] **Step 3: Write `buildPlan`**

Add a second fence to `blueprint.md` containing the copied prelude with the two
generalisations, then this driver:

```js
// A cell's material comes from the plan. Absent character, or a space, means
// the cell is not ours and we neither build nor judge it.
const planAt = (plan, legend, dx, dy, dz) => {
  const layer = plan.find((l) => l.y === dy)
  const ch = layer?.rows[dz]?.[dx]
  if (ch === undefined || ch === ' ') return undefined // not mine
  if (ch === '.') return 'air'
  return legend[ch]
}
// Anything the plan speaks for is the build's own — the stuck-walk watchdog
// must never tunnel out through it. This is what `partOfTheHouse` did with
// hardcoded predicates; now it reads the plan, so it is right for any shape.
const partOfTheBuild = (BASE, plan, legend, p) => {
  const want = planAt(plan, legend, p.x - BASE.x, p.y - BASE.y, p.z - BASE.z)
  return want !== undefined && want !== 'air'
}

// Build bottom-up: every block then has a neighbour beneath it to click.
async function buildPlan(BASE, plan, legend) {
  const layers = [...plan].sort((a, b) => a.y - b.y)
  for (const layer of layers) {
    for (const [dz, row] of layer.rows.entries()) {
      for (let dx = 0; dx < row.length; dx++) {
        const want = planAt(plan, legend, dx, layer.y, dz)
        if (want === undefined) continue
        const at = BASE.offset(dx, layer.y, dz)
        const there = bot.blockAt(at)
        if (want === 'air') {
          if (!there || there.boundingBox !== 'block') { bump('already clear'); continue }
          if (!(await digAt(at))) bump('could not clear a cell the plan wants empty')
          continue
        }
        if (there?.name === want) { bump('already right'); continue }
        await put(dx, layer.y, dz, want)
      }
    }
    print(`layer y+${layer.y} done — ${placed} placed so far`)
  }
  return { placed, tally, errors, stalls }
}
```

`put` and `digAt` are the copied helpers; `put`'s signature already takes a
material. Keep the diagnostics (`tally`, `errors`, `stalls`) exactly as
`house.md` reports them — the tally names are how a failed run is read.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS, including the fence-compile test.

- [ ] **Step 5: Commit**

```bash
git add resources/recipes/skill/blueprint.md test/recipes.test.ts
git commit -m "Build from the plan, with the movement the house recipe paid for

The machinery is not new: it is the prelude already proven live and pinned
byte-identical across the house fences. What changes is where the shape comes
from — the fixed isRing/isWindow/wantAt predicates are gone, and the two
helpers that read them now read the plan instead.

That matters most for the stuck-walk watchdog: it used to know the house's
shape from hardcode, so it only worked for that one house. Reading the plan,
it refuses to tunnel through any build."
git log -1 --format=%B
```

---

### Task 3: `verifyPlan`

**Files:**
- Modify: `resources/recipes/skill/blueprint.md`
- Test: `test/recipes.test.ts`

**Interfaces:**
- Consumes: `planAt` from Task 2.
- Produces: `verifyPlan(BASE, PLAN, LEGEND)` returning `{ ok, wrong, total }` and printing a per-layer diff in the plan's own character form.

- [ ] **Step 1: Write the failing tests**

```ts
it('verifyPlan reads the same plan the builder read', async () => {
  // The whole point: the shape is stated once. If verify carried its own copy
  // of the design, the two could disagree — which is the defect this replaces.
  const fences = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8')).join('\n')
  expect(fences).toContain('async function verifyPlan')
  expect(fences, 'verify must go through the same planAt as the builder').toMatch(
    /verifyPlan[\s\S]{0,1200}planAt\(/,
  )
})

it('verifyPlan reports the diff in the plan\'s own characters', async () => {
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
    if (!fence.includes('verifyPlan')) 
      expect(claim.test(fence), `blueprint fence #${i} claims completion without verifying`).toBe(false)
  }
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/recipes.test.ts`
Expected: FAIL — `verifyPlan` is not defined.

- [ ] **Step 3: Write `verifyPlan`**

```js
// Read the world back and lay it over the plan. Same characters, same grid —
// a wrong block shows up as a changed letter in the shape you drew, not as a
// coordinate you have to picture.
async function verifyPlan(BASE, plan, legend) {
  const nameToChar = {}
  for (const [ch, name] of Object.entries(legend)) if (!(name in nameToChar)) nameToChar[name] = ch
  let ok = 0, total = 0
  const wrong = []
  for (const layer of [...plan].sort((a, b) => a.y - b.y)) {
    const lines = []
    for (const [dz, row] of layer.rows.entries()) {
      let line = ''
      for (let dx = 0; dx < row.length; dx++) {
        const want = planAt(plan, legend, dx, layer.y, dz)
        if (want === undefined) { line += ' '; continue }
        const block = bot.blockAt(BASE.offset(dx, layer.y, dz))
        const got = block && block.boundingBox === 'block' ? block.name : 'air'
        total++
        if (got === want) { ok++; line += want === 'air' ? '.' : (nameToChar[want] ?? '?') }
        else {
          wrong.push({ at: [dx, layer.y, dz], want, got })
          line += got === 'air' ? '!' : '#' // ! = missing, # = something else
        }
      }
      lines.push(`z=${String(dz).padStart(2)} ${line}`)
    }
    print(`--- y+${layer.y} ---\n${lines.join('\n')}`)
  }
  print(`${ok}/${total} cells match the plan. ! = nothing there, # = wrong block.`)
  if (wrong.length) printJson({ wrong: wrong.slice(0, 40), moreNotShown: Math.max(0, wrong.length - 40) })
  return { ok, wrong, total }
}
```

Add prose above the fence saying the diff uses the plan's own characters, with
`!` for a missing block and `#` for the wrong one.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add resources/recipes/skill/blueprint.md test/recipes.test.ts
git commit -m "Verify against the same plan that built it

Build and verify now read one plan through one planAt, so they cannot
disagree about the shape. The diff comes back as the plan's own character
grid with ! for a missing block and # for a wrong one, which can be laid
over what you wrote — a list of coordinates cannot."
git log -1 --format=%B
```

---

### Task 4: `house.md` becomes a design guide

**Files:**
- Modify: `resources/recipes/skill/house.md` — replace the script with a guide plus a worked `PLAN`
- Modify: `resources/recipes/prompt/skill.md` — the house row now points at a guide, and the workflow says author-a-plan-first
- Test: `test/recipes.test.ts`

**Interfaces:**
- Consumes: the format and engine from Tasks 1-3.
- Produces: a `house.md` whose fences are a `LEGEND` + `PLAN` for the oak starter house, and instructions to paste the engine.

**Keep what the current `house.md` teaches that a plan cannot express:** where a
door goes, windows on every side, roof pitch, what an interior needs, wall
torches rather than floor spam, and the measured facts (a bed cannot be seated
by `placeBlock` on 1.21.4; ~1 second per placed block). Those are design and
domain knowledge; they survive as prose.

- [ ] **Step 1: Write the failing tests**

```ts
it('house.md is a design guide with a worked plan, not a script', async () => {
  const house = await readFile(`${RECIPES}/skill/house.md`, 'utf8')
  const fences = jsFences(house)
  expect(fences.join('\n'), 'the house is expressed as a plan').toContain('const PLAN')
  expect(fences.join('\n'), 'with a legend').toContain('const LEGEND')
  for (const dead of ['isRing', 'isCorner', 'isWindow', 'wantAt'])
    expect(fences.join('\n'), `${dead} was the old hardcoded shape`).not.toContain(dead)
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/recipes.test.ts`
Expected: FAIL — `house.md` still contains `isRing` and has no `PLAN`.

- [ ] **Step 3: Rewrite `house.md`**

Structure: the design principles as prose, then one fence holding `LEGEND` and
`PLAN` for the oak starter house, then instructions to paste the engine fences
from `mcp-craft://skill/blueprint` and call `renderPlan`, `buildPlan`,
`verifyPlan` in that order.

Derive the `PLAN` from the house this repo actually built and photographed —
7 wide, 6 deep, log corners, plank walls, glass panes on all four sides, a
centred door, an attic deck, a gable roof narrowing along z with a one-block
eave. The read-back grids in `TODO.md`'s 2026-08-30 entry are that house; use
them so the worked example is a building known to stand.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add resources/recipes/skill/house.md resources/recipes/prompt/skill.md test/recipes.test.ts
git commit -m "Turn the house recipe into a design guide with a worked plan

It was 1400 lines of script whose shape lived in predicates, so a model could
not vary it, could not show its intent before building, and could not diff
what it built against what it meant.

What a plan cannot carry stays as prose: where a door goes, windows on every
side, wall torches rather than floor spam, and the measured facts — a bed
will not seat by hand on 1.21.4, and a placed block costs about a second."
git log -1 --format=%B
```

---

### Task 5: The model authors the plan, and pins the engine against drift

**Files:**
- Modify: `resources/recipes/prompt/skill.md` — the workflow rule
- Test: `test/recipes.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no code; a rule and a drift guard.

- [ ] **Step 1: Write the failing tests**

```ts
it('the index tells the model to author and show a plan before building', async () => {
  const flat = (await readFile(`${RECIPES}/prompt/skill.md`, 'utf8')).replace(/\s+/g, ' ')
  expect(flat, 'the model writes the plan itself').toMatch(/write .{0,60}plan|author .{0,60}plan/i)
  expect(flat, 'and shows it before placing anything').toMatch(/renderPlan|before .{0,40}(build|place)/i)
})

it('the engine text is identical wherever it appears', async () => {
  // The sandbox has no imports, so the engine is pasted rather than called.
  // Pasted code drifts — that is exactly how seesFace ended up looser than
  // the runtime's own check. Pin every copy against the blueprint's.
  const canonical = jsFences(await readFile(`${RECIPES}/skill/blueprint.md`, 'utf8')).join('\n')
  const body = (src: string, name: string): string | null => {
    const at = src.indexOf(name)
    if (at < 0) return null
    const rest = src.slice(at)
    return rest.slice(0, rest.indexOf('\n}') + 2)
  }
  for (const article of ['house.md', 'humanlike.md']) {
    const other = (await readFile(`${RECIPES}/skill/${article}`, 'utf8'))
    for (const name of ['function seesFace', 'async function standBeside']) {
      const a = body(canonical, name)
      const b = body(other, name)
      if (a && b) expect(b, `${name} has drifted in ${article}`).toBe(a)
    }
  }
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/recipes.test.ts`
Expected: FAIL on at least the first.

- [ ] **Step 3: Add the rule, and reconcile any drift the second test finds**

Add to the numbered rules in `resources/recipes/prompt/skill.md`, in the style
of the rules already there: before building anything, write the `LEGEND` and
`PLAN`, call `renderPlan`, and look at what it prints. If the printed shape is
not the building you meant, fix the plan — not the blocks. Then build, then
verify against the same plan.

If the drift test fails, make the copies identical to the blueprint's.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add resources/recipes/prompt/skill.md resources/recipes/skill test/recipes.test.ts
git commit -m "Make the model draw the building before it builds it

A plan printed and looked at can be corrected in seconds; a plan discovered
to be wrong after the fact is corrected in blocks, from a bot that has to
walk there.

The drift guard exists because the sandbox has no imports: the engine is
pasted, and pasted code drifts. seesFace already did exactly that once,
ending up looser than the check the runtime enforces."
git log -1 --format=%B
```

---

## Verification

After Task 5:

```bash
npx tsc --noEmit     # clean
npm test             # green, fence-compile included
npm run build        # dist rebuilt
```

Then, against a live world (the MCP server must be restarted first — it loads
from `dist/`, so `/mcp` → reconnect):

1. Author a small plan by hand — a 5x4 hut, three layers — call `renderPlan`,
   and check the printed elevations are the hut you meant.
2. `buildPlan` it on clear ground, then `verifyPlan`. The diff grid should come
   back all matching characters.
3. Deliberately break one cell (dig a block out), re-run `verifyPlan`, and
   confirm it reports `!` at exactly that cell and nowhere else.
4. `craft_take_screenshot` the result and look at it.

## Notes for the implementer

- The MCP server runs from `dist/`; recipe articles are read from
  `resources/recipes` on every fetch, so **recipe edits are live without a
  restart** — only `src/` changes need one.
- `test/recipes.test.ts` compiles every ```js fence against the ten-name scope.
  A fence that references anything else fails the build, which is the point.
- The existing test `'the helpers shared by both build fences are byte-identical'`
  refers to `house.md`'s two fences. Task 4 removes those fences; update or
  replace that test rather than deleting it — the guarantee it provides is the
  one Task 5 extends.
