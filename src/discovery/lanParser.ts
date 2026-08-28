// Minecraft clients that pressed "Open to LAN" broadcast this payload to
// 224.0.2.60:4445 roughly every 1.5 s. Pure function over that payload.
const LAN_RE = /\[MOTD\](.*)\[\/MOTD\]\[AD\](\d{1,5})\[\/AD\]/s

export function parseLanAnnouncement(payload: string): { motd: string; port: number } | null {
  const m = LAN_RE.exec(payload)
  if (!m) return null
  const port = Number(m[2])
  if (port < 1 || port > 65535) return null
  return { motd: m[1]!, port }
}
