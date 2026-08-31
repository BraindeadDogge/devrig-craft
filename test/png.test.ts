import { describe, it, expect } from 'vitest'
import { inflateSync } from 'node:zlib'
import { encodePng } from '../src/render/png.js'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** An independent CRC32, so the test does not trust the encoder's own table. */
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Walk the chunk list so the test reads the file the way a decoder would —
 * including the trailing CRC, which a decoder rejects the file over.
 */
function chunks(png: Buffer): Array<{ type: string; data: Buffer; crc: number }> {
  const out: Array<{ type: string; data: Buffer; crc: number }> = []
  let at = SIGNATURE.length
  while (at < png.length) {
    const len = png.readUInt32BE(at)
    out.push({
      type: png.subarray(at + 4, at + 8).toString('ascii'),
      data: png.subarray(at + 8, at + 8 + len),
      crc: png.readUInt32BE(at + 8 + len),
    })
    at += 12 + len
  }
  return out
}

/** Every chunk carries a CRC32 over its type and data bytes. */
function expectCrcs(png: Buffer): void {
  for (const c of chunks(png))
    expect(c.crc, `CRC of the ${c.type} chunk`).toBe(crc32(Buffer.concat([Buffer.from(c.type, 'ascii'), c.data])))
}

describe('png encoder', () => {
  it('writes a decodable truecolour PNG with the pixels it was given', () => {
    // two pixels side by side: red, then green
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0])
    const png = encodePng(2, 1, rgb)

    expect(png.subarray(0, 8)).toEqual(SIGNATURE)
    const parts = chunks(png)
    expect(parts.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    expectCrcs(png)
    // The empty IEND chunk has the same CRC in every valid PNG ever written.
    expect(parts[2]!.crc).toBe(0xae426082)

    const ihdr = parts[0]!.data
    expect(ihdr.readUInt32BE(0)).toBe(2) // width
    expect(ihdr.readUInt32BE(4)).toBe(1) // height
    expect(ihdr[8]).toBe(8) // bit depth
    expect(ihdr[9]).toBe(2) // colour type: truecolour

    // one scanline: a leading filter byte, then the pixels, unchanged
    const raw = inflateSync(parts[1]!.data)
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0])
  })

  it('refuses a buffer that is not width * height * 3', () => {
    expect(() => encodePng(2, 2, new Uint8Array(3))).toThrow(/expected 12 bytes/)
  })

  it('round-trips a larger image without corrupting any row', () => {
    const w = 17, h = 9 // deliberately not a power of two
    const rgb = new Uint8Array(w * h * 3)
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 7) % 256
    const png = encodePng(w, h, rgb)
    expectCrcs(png)
    const raw = inflateSync(chunks(png)[1]!.data)
    for (let y = 0; y < h; y++) {
      const row = raw.subarray(y * (1 + w * 3), (y + 1) * (1 + w * 3))
      expect(row[0], `row ${y} must use filter 0`).toBe(0)
      expect([...row.subarray(1)]).toEqual([...rgb.subarray(y * w * 3, (y + 1) * w * 3)])
    }
  })
})
