// The world_name routing key: lowercase kebab, ASCII-only (spec §13 — the demo
// is English-only), deduplicated with -2, -3, … Mirrors devrig's project_name
// rule. Slug *stability across snapshots* is the snapshot builder's job: it
// feeds display names in a deterministic order.
export function worldSlug(displayName: string, taken: Set<string>): string {
  const base =
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'world'
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
}
