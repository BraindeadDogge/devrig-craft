const snake = (k: string) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())

export function toWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toWire)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [snake(k), toWire(v)]))
  }
  return value
}
