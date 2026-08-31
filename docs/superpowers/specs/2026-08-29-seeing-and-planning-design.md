# Seeing the build, and planning it first

Design for two changes that belong together: giving the agent a way to LOOK at
what it built, and replacing the hardcoded house script with a plan the model
authors itself.

Status: approved in brainstorming, not yet implemented.

## Why

Two failures from the 2026-08-29 sessions motivate this.

**The agent cannot see.** Every defect found today — the floor of holes, the
walls the watchdog punched through, the scaffolding left in the living room —
was found by a human looking at the world in first person and saying so. The
agent's own verification is a `bot.blockAt` sweep against a hardcoded predicate,
which answers "does it match the spec" and never answers "does it look right".
`craft_take_screenshot` exists but ships as an error branch only (design.md
§13): headless-gl was flaky and the success path was descoped.

**The house is a script, not a design.** `house.md` is ~1400 lines across four
fences, and the building it describes lives in predicates (`isRing`,
`isWindow`, `wantAt`) rather than in anything a person can look at. The model
cannot vary it, cannot show its intent before building, and cannot diff what it
built against what it meant. Worse, the shape is stated twice — once in the
build predicates, once in the verify sweep — which is the same
two-copies-that-drift defect that cost a full day when `seesFace` diverged from
the runtime's own check.

## Decisions

Both reverse or refine a written decision, so they are recorded explicitly.

1. **The screenshot success path ships, but renders from block data, not GL.**
   design.md §13 descoped it because headless-gl proved unreliable on this
   platform. That reasoning stands — so this design does not use GL at all. An
   orthographic projection computed from `bot.blockAt` and encoded as PNG by
   hand needs no native dependency, is deterministic, and cannot flake. It also
   shows the whole building rather than one wall, which is what the question
   "how did it come out" actually needs.

2. **design.md §6 "verify via the API, not pixels" is refined, not dropped.**
   Correctness verification stays an API sweep — pixels must never be how we
   decide whether a block landed. Pixels are added for a question the API
   cannot answer: whether the result looks like a house. The distinction is
   *correctness* (API) versus *appearance* (render).

## Part 1 — Block-data screenshots

### Interface

`craft_take_screenshot` gains inputs and a success path:

| input | meaning |
|---|---|
| `world_name`, `task_id`, `reason` | unchanged |
| `center` | `{x, y, z}` — what to look at |
| `radius` | half-extent of the box to render (bounded) |
| `views` | any of `north`, `south`, `east`, `west`, `iso`, `top` |
| `size` | pixels per block (bounded) |

Returns MCP `image` content, one per requested view, PNG.

### Implementation

Two pure modules, both unit-testable with no world and no bot:

- `src/render/png.ts` — minimal PNG encoder over `node:zlib`. Input: width,
  height, RGB pixel buffer. Output: PNG bytes. No dependencies.
- `src/render/blockView.ts` — projection. Input: a block-name grid (a plain
  3-D array), a view, pixels-per-block. Output: an RGB buffer. Flat colour per
  block name from a small palette, with per-face shading so edges read.

The server collects the grid from `bot.blockAt` over the requested box, calls
these, and wraps the result as image content. Every bound (radius, size, view
count) is a zod `.max()` — an agent will eventually ask for a 4000-block box.

### Non-goals

No textures, no lighting model, no arbitrary camera angles, no
`prismarine-viewer`, no GL. Six fixed views is the whole surface.

## Part 2 — The plan is the data

### Format

The model writes two literals and nothing else about the shape:

```js
const LEGEND = { L: 'oak_log', P: 'oak_planks', o: 'glass_pane', C: 'cobblestone' }
const PLAN = [
  { y: 0, rows: ['LCCCCCL', 'CPPPPPC', ...] },   // rows[z] is a string indexed by x
  { y: 1, rows: ['LPPDPPL', 'P.....P', ...] },
]
```

- a legend character means "this block belongs here"
- `.` means "this must be empty"
- a space means "not mine — leave whatever is there"

### Engine

One article, `mcp-craft://skill/blueprint`, carries three functions:

- `renderPlan(PLAN, LEGEND)` — prints the plan as elevations, for the human and
  the model to look at BEFORE anything is placed.
- `buildPlan(BASE, PLAN, LEGEND)` — builds it. Bottom-up so every block has a
  neighbour to click; picks a visible face; flies or pillars for height; never
  stands in the cell it is filling; digs only what the plan says must be empty.
- `verifyPlan(BASE, PLAN, LEGEND)` — reads the world back and returns the diff
  in the SAME character form, so a wrong block is visible as a changed
  character in the same grid the model authored.

Build and verify read one plan. They cannot disagree about the shape.

### What happens to house.md

It stops being a script and becomes a guide to a good house: proportions, where
the door goes, windows on every side, roof pitch, what an interior needs, how
to light it — plus one worked `PLAN` for the oak starter house as an example to
adapt or discard. `humanlike.md` and `building.md` are already principles and
stay as they are.

### Workflow the model follows

1. read the principles
2. pick a lot
3. **author a PLAN and print it** — intent stated before any block is placed
4. `buildPlan`
5. `verifyPlan` — correctness, from the world
6. **photograph four elevations and the isometric — and look at them**
7. say plainly whether it is right; if not, name the cause and fix it

## Part 3 — The prompt

`prompt/skill.md` gains the closing step: after building, take the elevations,
look at them, compare against the plan, and report honestly. A verdict of "it
is done" that was not looked at does not count.

## Testing

| unit | test |
|---|---|
| PNG encoder | golden bytes for a known small grid; decodes to the pixels put in |
| projection | synthetic 3x3x3 grid, assert colours at known pixel coordinates |
| view bounds | oversized radius/size rejected at the schema |
| plan engine | every legend character used by the worked example is defined; plan rows are rectangular |
| recipe fences | existing compile-against-the-scope test covers the new article |
| prompt | asserts the photograph-and-judge step is present |

## Sequencing

Screenshots first: self-contained, testable without a world, and it immediately
gives the human the thing they asked for. The recipe restructure second, since
its final step depends on the render existing.

These are two implementation plans, not one. Part 1 touches `src/` and the tool
schema and can ship on its own; Part 2 rewrites the recipe corpus and is only
worth starting once there is something to photograph with. Writing them as a
single plan would couple two changes that have no reason to land together.

## Open questions

- The colour palette is a judgement call; start with a dozen common building
  blocks and a fallback grey, extend when something reads badly.
- Whether `verifyPlan`'s diff should also be rendered as an image (a
  "differences" view) is deferred until the text diff proves insufficient.
- Concrete ceilings for `radius`, `size` and view count are left to
  implementation, but they are not optional: unbounded model-supplied input is
  banned outright by CLAUDE.md, and a render box scales cubically.
