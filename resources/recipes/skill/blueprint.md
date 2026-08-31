# Blueprint: the plan format, and showing it before you build

A plan is data, not a script. State the shape once, as `LEGEND` and `PLAN`,
and everything downstream — building, verifying, showing progress — reads
that same data. There is no second copy to drift out of sync with the first.

`LEGEND` is an object mapping a single character to a block name — the
character `L` might mean `oak_log`, `C` might mean `cobblestone`, and so on.

`PLAN` is an array of layers, each `{ y, rows }`, **listed bottom-up** (the
first entry is the lowest layer). `y` is a **height offset from BASE**, not
a world Y coordinate — layer 0 sits on BASE, layer 1 sits one block above it,
and so on. `rows` is an array of strings; `rows[z]` is the row at depth `z`,
and within that string, the character at index `x` is the cell at that `x`
offset from BASE. **Every row in every layer must be the same length, and
every layer must have the same number of rows** — a ragged plan cannot be
addressed by a single `(x, y, z)` triple.

Each character in a row means exactly one of three things:

- **A legend character means the block belongs here.** Look it up in
  `LEGEND` to get the block name, and place (or expect) that block at this
  cell.
- **`.` means this cell must be empty.** Nothing goes here — if the build
  finds a block occupying it, that is a defect to clear, not a cell to skip.
- **A space means not mine — leave whatever is there and do not report on
  it.** A blank cell is outside the plan's authority: do not place into it,
  do not dig it out, and do not flag it as wrong during verification. This
  is how a plan describes a partial shape (an L-shaped floor, a doorway gap
  cut into an otherwise full wall) without claiming the whole bounding box.

Because the whole grammar is three symbols, showing the plan back — before
touching a single block — should be enough for a human or the model itself to
catch a mistake by eye. `renderPlan` below does exactly that: it prints every
layer as an elevation, prints the legend it resolved, and warns about any
character it cannot resolve or about a ragged grid, before anything is built.

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
  const used = Array.from(new Set(plan.flatMap((l) => l.rows.join('').split(''))))
    .filter((c) => c !== '.' && c !== ' ')
    .sort()
  print(`legend: ${used.map((c) => `${c}=${legend[String(c)] ?? '???'}`).join('  ')}`)
  if (unknown.size) print(`WARNING: no legend entry for ${[...unknown].join(', ')} — those cells cannot be built`)
  const widths = new Set(plan.flatMap((l) => l.rows.map((r) => r.length)))
  const depths = new Set(plan.map((l) => l.rows.length))
  if (widths.size > 1 || depths.size > 1)
    print(`WARNING: ragged plan — row lengths ${[...widths].join('/')}, layer depths ${[...depths].join('/')}`)
}

renderPlan(PLAN, LEGEND)
```
