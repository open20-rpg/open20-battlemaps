/**
 * Minimal ZIP reading and writing for `.otbx` packages (an extension is a
 * zip with `manifest.json` at its root). Reading supports stored and
 * deflated entries (any zip tool's output); writing deflates when
 * `CompressionStream` is available. No zip64, encryption or spanning:
 * extensions are small.
 */

export interface ZipEntry {
  path: string
  bytes: Uint8Array
}

/** Limits that keep a hostile package from exhausting memory. */
export const ZIP_LIMITS = { maxEntries: 2000, maxTotalBytes: 200 * 1024 * 1024 }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function pipe(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>) {
  const writer = stream.writable.getWriter()
  void writer.write(bytes).then(() => writer.close())
  const chunks: Uint8Array[] = []
  const reader = stream.readable.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

const inflate = (b: Uint8Array) =>
  pipe(
    b,
    new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>,
  )
const deflate = (b: Uint8Array) =>
  pipe(
    b,
    new CompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>,
  )

/** Read every file of a zip (directories are skipped). Throws on a malformed or oversized one. */
export async function readZip(data: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  // End of central directory: last 22+ bytes, signature 0x06054b50.
  let eocd = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error("not a zip file")
  const count = view.getUint16(eocd + 10, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  if (count > ZIP_LIMITS.maxEntries) throw new Error("too many files")
  const decoder = new TextDecoder()
  const pending: Promise<ZipEntry>[] = []
  let total = 0
  let p = cdOffset
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("bad central directory")
    const method = view.getUint16(p + 10, true)
    const crc = view.getUint32(p + 16, true)
    const compSize = view.getUint32(p + 20, true)
    const size = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const path = decoder.decode(data.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (path.endsWith("/")) continue
    total += size
    if (total > ZIP_LIMITS.maxTotalBytes) throw new Error("package too big")
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error("bad local header")
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const raw = data.subarray(start, start + compSize)
    if (method !== 0 && method !== 8) throw new Error(`unsupported compression in ${path}`)
    // Entries are independent: they inflate together.
    pending.push(
      (method === 0 ? Promise.resolve(raw.slice()) : inflate(raw)).then((bytes) => {
        if (bytes.length !== size || crc32(bytes) !== crc) throw new Error(`corrupt file ${path}`)
        return { path, bytes }
      }),
    )
  }
  return Promise.all(pending)
}

/** Write a zip (deflated when it helps). */
export async function writeZip(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const canDeflate = typeof CompressionStream !== "undefined"
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  // Each entry deflated (in parallel) only when that makes it smaller.
  const packed = await Promise.all(
    entries.map(async (e) => {
      if (!canDeflate || e.bytes.length <= 64) return { data: e.bytes, method: 0 }
      const d = await deflate(e.bytes)
      return d.length < e.bytes.length ? { data: d, method: 8 } : { data: e.bytes, method: 0 }
    }),
  )
  entries.forEach((e, i) => {
    const name = encoder.encode(e.path)
    const crc = crc32(e.bytes)
    const { data, method } = packed[i]
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // UTF-8 names
    lv.setUint16(8, method, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, e.bytes.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, method, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, e.bytes.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  })
  const cdSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  const parts = [...locals, ...centrals, end]
  const out = new Uint8Array(parts.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const part of parts) {
    out.set(part, o)
    o += part.length
  }
  return out
}
