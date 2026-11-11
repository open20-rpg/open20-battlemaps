import { describe, expect, it } from "vitest"
import {
  argbToHex,
  GodotParseError,
  parsePoolBytes,
  parsePoolInt,
  parsePoolVec2,
  parseVec2,
} from "./godot"

describe("godot literals", () => {
  it("parses Vector2 and pooled arrays", () => {
    expect(parseVec2("Vector2( 2855.54, 3377.9 )")).toEqual({ x: 2855.54, y: 3377.9 })
    expect(parsePoolVec2("PoolVector2Array( 1, 2, 3, 4 )")).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ])
    expect(parsePoolVec2("PoolVector2Array( )")).toEqual([])
    expect(parsePoolInt("PoolIntArray( -1, 73 )")).toEqual([-1, 73])
    expect([...parsePoolBytes("PoolByteArray( 0, 12, 255 )")]).toEqual([0, 12, 255])
  })

  it("rejects malformed literals", () => {
    expect(() => parseVec2("Vector3( 1, 2, 3 )")).toThrow(GodotParseError)
    expect(() => parseVec2(42)).toThrow(GodotParseError)
    expect(() => parsePoolVec2("PoolVector2Array( 1, 2, 3 )")).toThrow(GodotParseError)
    expect(() => parsePoolInt("PoolIntArray( 1, x )")).toThrow(GodotParseError)
  })

  it("converts ARGB hex to CSS hex", () => {
    expect(argbToHex("ffeccd8b")).toBe("#eccd8b")
    expect(argbToHex("18ffffff")).toBe("#ffffff18")
    expect(argbToHex(undefined, "#000000")).toBe("#000000")
    expect(argbToHex("nope")).toBe("#ffffff")
  })
})
