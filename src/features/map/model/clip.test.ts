import { describe, expect, it } from "vitest"
import { bridgeHoles, subtractPolygon } from "./clip"
import { pointInPolygon, rectPolygon } from "./geometry"

const square = (x: number, y: number, size: number) =>
  rectPolygon({ x, y }, { x: x + size, y: y + size })

describe("polygon subtraction", () => {
  it("cuts a notch, splits, empties, or leaves alone", () => {
    const room = square(0, 0, 4)
    expect(subtractPolygon(room, square(10, 10, 1))).toBeNull()
    expect(subtractPolygon(room, square(-1, -1, 6))).toEqual([])
    const [notched] = subtractPolygon(room, square(2, 2, 4)) ?? []
    expect(notched.outer).toHaveLength(6)
    expect(notched.holes).toEqual([])
    const halves = subtractPolygon(room, rectPolygon({ x: 1, y: -1 }, { x: 2, y: 5 }))
    expect(halves).toHaveLength(2)
  })

  it("a cut inside leaves a hole, bridged into one ring that fills around it", () => {
    const [ring] = subtractPolygon(square(0, 0, 4), square(1, 1, 2)) ?? []
    expect(ring.holes).toHaveLength(1)
    const keyhole = bridgeHoles(ring)
    expect(keyhole).toHaveLength(4 + 4 + 2)
    expect(pointInPolygon({ x: 0.5, y: 2 }, keyhole)).toBe(true)
    expect(pointInPolygon({ x: 2, y: 2 }, keyhole)).toBe(false)
    expect(pointInPolygon({ x: 3.5, y: 3.5 }, keyhole)).toBe(true)
  })
})
