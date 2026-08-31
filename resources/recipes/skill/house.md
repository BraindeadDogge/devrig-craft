# The oak starter house — a design guide, and one worked plan

This is the flagship build: the classic tutorial oak starter house, in the
proportions and the order a person builds it. What it is *not* any more is a
script. The shape of a house is data — a `LEGEND` and a `PLAN`, per
`mcp-craft://skill/blueprint` — and one generic engine shows it, builds it and
verifies it. This article is the part a plan cannot carry: the design
knowledge, the measured facts, and one worked plan for the house itself.

Why the split matters, in one line: a plan can be shown to the human before a
block is placed, varied on request ("make it wider", "two windows at the
back"), and diffed against the world afterwards. A script can do none of the
three.

## What makes it read as a house

These are the decisions, not the code. Change them deliberately; do not lose
them by accident.

- **Footprint 7 × 6, walls three courses high.** Smaller reads as a shed,
  taller as a tower. One block of margin all round is the eave, so the plan
  grid is 7 wide × 8 deep.
- **An embedded foundation.** Log corner posts and a cobblestone plinth set
  INTO the ground, with a real oak-plank floor replacing the grass inside.
  A house standing on turf looks dropped there.
- **Log corners, plank walls.** The corner posts are what make a plank box
  read as built rather than extruded.
- **Windows on every side.** Two in the front wall either side of the door,
  two in the back, one per side wall — all at head height (the middle course).
  A wall with no opening reads as a warehouse, and a room with light from one
  side only looks like a cell.
- **A centred front door.** In the middle of the front wall, bottom course.
  A door is a two-cell block: place the bottom half and the server fills the
  top, which is why the plan carries the same character in both cells — the
  upper one then verifies as "already right" rather than as a miss.
- **An attic deck, then a gable roof that narrows along z with a one-block
  eave.** Deck across the whole footprint plus the eave rows; then a course
  four rows deep; then a two-row ridge. That is the pitch: it steps in by one
  row per course, so from the side it reads as a roof rather than as a lid.
  The eave is what casts the shadow line under it.
- **An interior a player would actually sleep in.** Bed against the back wall,
  chest and crafting table along the side wall by the front, and **wall
  torches at head height, never torches spammed on the floor**. Two more on
  the front wall either side of the door, so the entrance is lit from outside.

## Step 1 — pick the lot (and clean it like a person would)

`BASE` is the **ground course**: layer 0 of the plan sits ON `BASE` and
replaces what is there, so this is the block layer the grass is in, not the
first layer of air above it.

```js
// Find a clear lot near the human (7x8 plan footprint + working margin).
// A few stray blocks are fine — the engine clears them; a real ruin means move on.
const human = bot.nearestEntity((e) => e.type === 'player')
const anchor = (human ? human.position : bot.entity.position).floored()
function lotAt(gx, gz) {
  let groundY = null
  for (let y = anchor.y + 2; y > anchor.y - 6; y--) {
    const b = bot.blockAt(new Vec3(gx, y, gz))
    if (b && b.boundingBox === 'block') { groundY = y; break }
  }
  if (groundY === null) return null
  const litter = []
  for (let dx = -2; dx < 9; dx++)
    for (let dz = -2; dz < 10; dz++)
      for (let dy = 1; dy <= 7; dy++) {
        const b = bot.blockAt(new Vec3(gx + dx, groundY + dy, gz + dz))
        if (b && b.boundingBox === 'block') litter.push(b.position)
      }
  return { groundY, litter }
}
let pick = null
outer:
for (const [ox, oz] of [[4, -3], [4, 4], [-11, -3], [-11, 4], [4, -13], [-11, -13]]) {
  const gx = anchor.x + ox, gz = anchor.z + oz
  const lot = lotAt(gx, gz)
  if (lot && lot.litter.length <= 8) { pick = { gx, gz, ...lot }; break outer }
}
if (!pick) {
  print('no clean-enough lot near the human — move somewhere open and re-run')
} else {
  printJson({ BASE: `new Vec3(${pick.gx}, ${pick.groundY}, ${pick.gz})`, litter: pick.litter.length })
  print('copy that BASE into the plan below — the engine finds and clears the strays itself')
}
```

## Step 2 — the plan

Read it as elevations, bottom-up. `L` log, `C` cobble, `P` planks, `o` glass
pane, `D` door; `.` is a cell that must be **empty**, and a space is a cell
the plan does not speak for — see `mcp-craft://skill/blueprint` for the
grammar, and vary this freely once you can read it.

Two things in the grid are worth understanding before you copy it:

- **The interior is `.`, so the engine keeps the room hollow** — anything
  standing in there is cleared, not skipped.
- **Except the six cells the furniture occupies, which are spaces.** The bed,
  chest, crafting table and the three wall torches are placed by hand in
  Step 4, and the plan must not claim their cells: if it marked them `.`, the
  verify step would report the bed you just placed as a defect and the build
  loop would try to dig it out again, forever. A space is how a plan says
  "not mine".

```js
// The oak starter house as data. Paste this at the TOP of each engine fence
// from mcp-craft://skill/blueprint, in place of that article's own
// LEGEND/PLAN/BASE — the engine functions take no arguments and read these
// three names from the script around them.
const LEGEND = { L: 'oak_log', C: 'cobblestone', P: 'oak_planks', o: 'glass_pane', D: 'oak_door' }
const PLAN = [
  // y+0 — the ground course itself: log corner posts, a cobble plinth under
  // every wall, planks where the grass was. The eave rows (z=0, z=7) are not
  // the plan's at this height.
  {
    y: 0,
    rows: [
      '       ',
      'LCCCCCL',
      'CPPPPPC',
      'CPPPPPC',
      'CPPPPPC',
      'CPPPPPC',
      'LCCCCCL',
      '       ',
    ],
  },
  // y+1 — first wall course, door bottom half. The four spaces are the bed
  // (x=1) and the work corner (x=5); the plan leaves those cells alone.
  {
    y: 1,
    rows: [
      '       ',
      'LPPDPPL',
      'P.....P',
      'P.....P',
      'P ... P',
      'P ... P',
      'LPPPPPL',
      '       ',
    ],
  },
  // y+2 — head height: windows on all four sides, door top half.
  {
    y: 2,
    rows: [
      '       ',
      'LoPDPoL',
      'P.....P',
      'o.....o',
      'o.....o',
      'P.....P',
      'LPoPoPL',
      '       ',
    ],
  },
  // y+3 — top course. The three spaces are where the wall torches hang.
  {
    y: 3,
    rows: [
      '       ',
      'LPPPPPL',
      'P... .P',
      'P.....P',
      'P.... P',
      'P ....P',
      'LPPPPPL',
      '       ',
    ],
  },
  // y+4 — attic deck across the whole footprint, and the one-block eave
  // overhang front and back (rows z=0 and z=7).
  {
    y: 4,
    rows: [
      'PPPPPPP',
      'PPPPPPP',
      'PPPPPPP',
      'PPPPPPP',
      'PPPPPPP',
      'PPPPPPP',
      'PPPPPPP',
      'PPPPPPP',
    ],
  },
  // y+5 — the roof steps in by one row on each side.
  {
    y: 5,
    rows: [
      '.......',
      '.......',
      'PPPPPPP',
      'PPPPPPP',
      'PPPPPPP',
      'PPPPPPP',
      '.......',
      '.......',
    ],
  },
  // y+6 — the ridge, two rows wide.
  {
    y: 6,
    rows: [
      '.......',
      '.......',
      '.......',
      'PPPPPPP',
      'PPPPPPP',
      '.......',
      '.......',
      '.......',
    ],
  },
]
const BASE = new Vec3(100, -61, 100) // ← the BASE Step 1 printed (y = the ground course)
print(`${PLAN.length} layers, ${PLAN[0].rows[0].length} wide x ${PLAN[0].rows.length} deep`)
```

## Step 3 — show it, build it, verify it

Three calls, in this order, each one a fence from
`mcp-craft://skill/blueprint` with the block above pasted in place of its own
`LEGEND`/`PLAN`/`BASE`:

1. **`renderPlan(PLAN, LEGEND)`** — print the elevations and say what you are
   about to build, in chat, before a block moves. A plan you have looked at is
   one you can be wrong about out loud.
2. **`buildPlan()`** — walks the layers bottom-up so every block has a
   neighbour beneath it to click, and prints `tally`, `errors` and `stalls`.
   **Read them.** `out of reach` or `no face` means it placed from the wrong
   spot; a non-zero `stalls` means a walk timed out and everything after it
   happened from the wrong place; `errors` carries the runtime's own refusals
   verbatim. Fix what they name and re-run — never re-send a fence unchanged.
3. **`verifyPlan()`** — reads the world back through the same plan and prints
   the diff in the plan's own characters. It is the only step allowed to say
   the build is finished, because it is the only step that looked.

Both build and verify are idempotent: a cell that is already right reports
`already right` and costs nothing, so a timeout is resumable — re-run the same
fence. Your own half-built house at this `BASE` is never debris.

## Step 4 — the things a plan cannot say

Furniture after the shell, before the verify. None of it fits the grid: a bed
is two cells with a facing, and a torch hangs on the *face* of a wall rather
than filling a cell of its own.

- **The bed cannot be seated by `placeBlock` on 1.21.4.** Measured from four
  different positions and facings: the server drops the packet every time and
  mineflayer reports only the silence ("Event blockUpdate did not fire within
  5000ms"). Say so in chat and set it directly instead — do not report "bed
  refused" and leave the house without a bed. With cheats on
  (`mcp-craft://skill/building-with-commands`), for a `BASE` of `x y z` and
  the bed against the back wall at plan cell `x+1, y+1, z+4`:

```text
/setblock <x+1> <y+1> <z+4> red_bed[facing=south,part=foot]
/setblock <x+1> <y+1> <z+5> red_bed[facing=south,part=head]
```

- **Chest and crafting table** go in the work corner — plan cells `x+5` at
  `z+4` and `z+5`, on the floor. Those are ordinary placements: stand in the
  room, click the floor's top face.
- **Wall torches, at head height, on the inside faces.** Click the wall block
  at plan y+3 with the face pointing INTO the room, and the torch hangs on the
  wall the way a person's would: over the bed, over the work corner, and one
  beside the door. Torches dropped on the floor are the single clearest tell
  that a bot built the room.
- **Two porch torches** on the outside of the front wall, either side of the
  door, so the entrance is lit from the approach.
- The plan already leaves every one of those cells blank, so `verifyPlan` will
  not judge them. Look at them yourself instead: `craft_take_screenshot` from
  the four sides and an isometric, and say whether it reads as a house.

## What it costs

**About one second per placed block**, and this plan places roughly 200 of
them: the runtime paces clicks to 2–3 per second with human jitter, and walking
between columns costs more than the clicks do. So a single call will not finish
the house. Split it by layers — build `PLAN.slice(0, 4)` (ground course through
the top wall course) in one call and `PLAN.slice(4)` (deck, roof, ridge) in the
next, each with `timeout: 420` — or hand the engine the whole plan twice and
let the second run fill in what the first ran out of time for.

If the verify diff shows misses, fix exactly those cells rather than rebuilding
a phase: `buildPlan` will re-place only what is wrong on the next run.
