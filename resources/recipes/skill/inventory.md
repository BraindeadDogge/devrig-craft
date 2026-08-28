# Inventory: stock, count, craft, equip

Materials come from three places: creative self-service, `/give` when cheats
are on (see `mcp-craft://skill/building-with-commands`), or survival
gathering/crafting. Always end by *counting* — inventory operations fail
silently more often than they throw.

## Creative: fill your own hotbar

Slots 36–44 are the hotbar (36 = slot 0, the one in hand after
`setQuickBarSlot(0)`). `Item` is in scope bound to the world's version.

```js
// Stock three hotbar slots and prove it.
if (bot.game.gameMode !== 'creative') {
  print(`game mode is ${bot.game.gameMode} — creative self-service unavailable`)
} else {
  await bot.creative.setInventorySlot(36, new Item(mcData.itemsByName.stone.id, 64))
  await bot.creative.setInventorySlot(37, new Item(mcData.itemsByName.oak_planks.id, 64))
  await bot.creative.setInventorySlot(38, new Item(mcData.itemsByName.torch.id, 16))
  bot.setQuickBarSlot(0)
  print(bot.inventory.slots.slice(36, 39).map((s) => (s ? `${s.name} x${s.count}` : 'empty')).join(', '))
}
```

## Count what you have

```js
// Aggregate the whole inventory by item name.
const counts = {}
for (const item of bot.inventory.items()) counts[item.name] = (counts[item.name] ?? 0) + item.count
printJson(counts)
```

## Survival crafting

`bot.recipesFor(itemId, metadata, minResultCount, craftingTable)` returns only
recipes the bot can craft *right now* with what it holds — an empty array means
"missing materials", not "no such recipe".

```js
// Craft sticks from planks and verify the count moved.
const stick = mcData.itemsByName.stick
const before = bot.inventory.items().filter((i) => i.name === 'stick').reduce((n, i) => n + i.count, 0)
const recipes = bot.recipesFor(stick.id, null, 1, null)
if (recipes.length === 0) {
  print('cannot craft sticks right now — need planks in the inventory first')
} else {
  await bot.craft(recipes[0], 1)
  const after = bot.inventory.items().filter((i) => i.name === 'stick').reduce((n, i) => n + i.count, 0)
  print(after > before ? `crafted ${after - before} sticks` : 'craft reported done but the count did not move')
}
```

Recipes that need a crafting table take it as the last argument: find one with
`bot.findBlock({ matching: mcData.blocksByName.crafting_table.id, maxDistance: 8 })`
and pass that block in; stand within reach of it first.

## Equip

```js
// Put a specific item in hand before placing or fighting.
const torch = bot.inventory.items().find((i) => i.name === 'torch')
if (!torch) {
  print('no torches in the inventory — stock up first')
} else {
  await bot.equip(torch, 'hand')
  print(`holding: ${bot.heldItem ? bot.heldItem.name : 'nothing'}`)
}
```

`bot.placeBlock` places whatever is in hand — equip the right item first, or
you will build a wall out of torches.
