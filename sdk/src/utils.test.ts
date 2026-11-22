import { describe, expect, it } from "vitest"
import {
  area,
  bounds,
  centroid,
  pointInPolygon,
  regularPolygon,
  resample,
  rotate,
  simplify,
  smooth,
} from "./geometry"
import { fbm, hashSeed, poissonDisk, rng, simplex2 } from "./random"
import { hsl, luminance, mix, palette, parseHex, toHex, toHsl } from "./color"
import { readZip, writeZip, crc32 } from "./zip"
import { checkFiles, readPackage, writePackage } from "./package"

const square = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
]

describe("geometry", () => {
  it("measures polygons", () => {
    expect(area(square)).toBe(4)
    expect(centroid(square)).toEqual({ x: 1, y: 1 })
    expect(bounds(square)).toEqual({ x: 0, y: 0, w: 2, h: 2 })
    expect(pointInPolygon({ x: 1, y: 1 }, square)).toBe(true)
    expect(pointInPolygon({ x: 3, y: 1 }, square)).toBe(false)
  })

  it("rotates around a pivot", () => {
    const p = rotate({ x: 1, y: 0 }, 90)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(1)
  })

  it("simplifies, resamples and smooths lines", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 1, y: 0.01 },
      { x: 2, y: 0 },
    ]
    expect(simplify(line, 0.1)).toHaveLength(2)
    expect(
      resample(
        [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
        ],
        1,
      ),
    ).toHaveLength(4)
    expect(smooth(square, 1, true)).toHaveLength(8)
    expect(regularPolygon({ x: 0, y: 0 }, 1, 6)).toHaveLength(6)
  })
})

describe("random", () => {
  it("is deterministic per seed", () => {
    const a = rng(42)
    const b = rng(42)
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()])
    expect(rng(1).next()).not.toEqual(rng(2).next())
    expect(hashSeed("mapa")).toBe(hashSeed("mapa"))
    const r = rng(7)
    for (let i = 0; i < 100; i++) {
      const n = r.int(1, 6)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(6)
    }
  })

  it("spreads Poisson points apart", () => {
    const pts = poissonDisk({ x: 0, y: 0, w: 10, h: 10 }, 1, 3)
    expect(pts.length).toBeGreaterThan(20)
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThanOrEqual(0.999)
  })

  it("makes bounded, seeded noise", () => {
    const n = fbm(simplex2(5))
    const v = n(1.3, 2.7)
    expect(v).toBe(fbm(simplex2(5))(1.3, 2.7))
    for (let i = 0; i < 50; i++) expect(Math.abs(n(i * 0.37, i * 0.11))).toBeLessThanOrEqual(1)
  })
})

describe("color", () => {
  it("converts and mixes", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHex("nope")).toBeNull()
    expect(toHex({ r: 167, g: 9, b: 9 })).toBe("#a70909")
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080")
    expect(hsl(0, 1, 0.5)).toBe("#ff0000")
    expect(toHsl("#ff0000").h).toBe(0)
    expect(luminance("#ffffff")).toBeCloseTo(1)
    expect(palette(4)).toHaveLength(4)
  })
})

describe("zip and packages", () => {
  const enc = new TextEncoder()
  it("round-trips files (stored and deflated)", async () => {
    const big = enc.encode("abc".repeat(1000))
    const zip = await writeZip([
      { path: "a.txt", bytes: enc.encode("hola") },
      { path: "dir/big.txt", bytes: big },
    ])
    const files = await readZip(zip)
    expect(files.map((f) => f.path)).toEqual(["a.txt", "dir/big.txt"])
    expect(new TextDecoder().decode(files[0].bytes)).toBe("hola")
    expect(files[1].bytes).toEqual(big)
    expect(zip.length).toBeLessThan(big.length)
  })

  it("rejects garbage and corrupt data", async () => {
    await expect(readZip(new Uint8Array(30))).rejects.toThrow()
    const zip = await writeZip([{ path: "a.txt", bytes: enc.encode("hola") }])
    zip[30 + 5] ^= 0xff // flip a byte of the stored data
    await expect(readZip(zip)).rejects.toThrow(/corrupt/)
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926)
  })

  it("reads a package and checks the files its manifest names", async () => {
    const manifest = {
      manifestVersion: 1,
      id: "open20.paquete",
      name: "Paquete",
      version: "1.0.0",
      author: { name: "x" },
      engines: { battlemaps: "^1.0.0" },
      main: "main.js",
      contributes: { locales: { es: "locales/es.json" } },
    }
    const files = new Map([
      ["manifest.json", enc.encode(JSON.stringify(manifest))],
      ["main.js", enc.encode("1")],
    ])
    const missing = checkFiles(files)
    expect(missing.ok).toBe(false)
    files.set("locales/es.json", enc.encode("{}"))
    const bytes = await writePackage({ manifest: manifest as never, files })
    const r = await readPackage(bytes)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.pkg.manifest.id).toBe("open20.paquete")
    expect((await readPackage(new Uint8Array([1, 2, 3]))).ok).toBe(false)
  })
})
