import { deflateSync } from 'node:zlib'

// PNG needs a CRC32 over each chunk's type+data. Building the table once at
// module load costs nothing and keeps the hot loop a single xor and shift.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Encode a truecolour 8-bit PNG. `rgb` is row-major, three bytes per pixel.
 *
 * Every scanline uses filter 0 (none). Filtering exists to help compression,
 * and these images are flat colour fields that deflate well already — the
 * simplicity is worth more here than the handful of bytes.
 */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const expected = width * height * 3
  if (rgb.length !== expected)
    throw new Error(`encodePng: expected ${expected} bytes for ${width}x${height}, got ${rgb.length}`)

  const stride = 1 + width * 3
  const raw = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    Buffer.from(rgb.subarray(y * width * 3, (y + 1) * width * 3)).copy(raw, y * stride + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  ihdr[10] = 0 // compression: deflate
  ihdr[11] = 0 // filter method: adaptive
  ihdr[12] = 0 // interlace: none

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
