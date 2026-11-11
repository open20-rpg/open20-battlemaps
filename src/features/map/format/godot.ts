/**
 * Parsers for the Godot variant literals Dungeondraft embeds in its JSON as
 * strings: `"Vector2( x, y )"`, `"PoolVector2Array( … )"`,
 * `"PoolIntArray( … )"` and `"PoolByteArray( … )"`
 * (see docs/dungeondraft-map-format.md).
 */

export class GodotParseError extends Error {}

/** "Prefix( a, b, … )" → numbers (empty body → []). */
function parseNumbers(literal: unknown, prefix: string): number[] {
  if (typeof literal !== "string") throw new GodotParseError(`Expected a ${prefix} literal`)
  const trimmed = literal.trim()
  if (!trimmed.startsWith(`${prefix}(`) || !trimmed.endsWith(")")) {
    throw new GodotParseError(`Not a ${prefix} literal: ${trimmed.slice(0, 40)}`)
  }
  const body = trimmed.slice(prefix.length + 1, -1).trim()
  if (body.length === 0) return []
  return body.split(",").map((token) => {
    const value = Number(token)
    if (Number.isNaN(value))
      throw new GodotParseError(`Invalid number "${token.trim()}" in ${prefix}`)
    return value
  })
}

export function parseVec2(literal: unknown): { x: number; y: number } {
  const n = parseNumbers(literal, "Vector2")
  if (n.length !== 2) throw new GodotParseError("Vector2 needs 2 components")
  return { x: n[0], y: n[1] }
}

/** Flat x,y pairs → points. */
export function parsePoolVec2(literal: unknown): { x: number; y: number }[] {
  const n = parseNumbers(literal, "PoolVector2Array")
  if (n.length % 2 !== 0) throw new GodotParseError("PoolVector2Array needs an even count")
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] })
  return out
}

export function parsePoolInt(literal: unknown): number[] {
  return parseNumbers(literal, "PoolIntArray")
}

export function parsePoolBytes(literal: unknown): Uint8Array {
  return Uint8Array.from(parseNumbers(literal, "PoolByteArray"))
}

/** ARGB hex ("ffeccd8b") → CSS hex ("#eccd8b", or "#rrggbbaa" when not opaque). */
export function argbToHex(argb: unknown, fallback = "#ffffff"): string {
  if (typeof argb !== "string" || !/^[0-9a-fA-F]{8}$/.test(argb)) return fallback
  const a = argb.slice(0, 2).toLowerCase()
  const rgb = argb.slice(2).toLowerCase()
  return a === "ff" ? `#${rgb}` : `#${rgb}${a}`
}
