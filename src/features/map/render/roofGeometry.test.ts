import { describe, expect, it } from "vitest"
import { quickboxRoof, roofFaceShade, roofGeometry, slopeUv } from "./roofGeometry"

const R = [
  { x: 0, y: 2 },
  { x: 6, y: 2 },
]

describe("roof geometry (ridge line and width)", () => {
  it("gable: two slopes from the ridge to the eaves, a closed edge", () => {
    const g = roofGeometry(R, 2, "gable")
    expect(g?.slopes).toHaveLength(2)
    expect(g?.tips).toEqual([])
    expect(g?.ridge).toEqual(R)
    // Left of +x (y down) is −y: the left eave runs at y = 0.
    expect(g?.slopes[0].points).toEqual([R[0], R[1], { x: 6, y: 0 }, { x: 0, y: 0 }])
    expect(g?.slopes[0].normal).toEqual({ x: 0, y: -1 })
    expect(g?.edge).toHaveLength(4)
    expect(g?.edgeClosed).toBe(true)
  })

  it("hip: the ridge shortened by the width at both ends, tip triangles and hip lines", () => {
    const g = roofGeometry(R, 2, "hip")
    expect(g?.ridge).toEqual([
      { x: 2, y: 2 },
      { x: 4, y: 2 },
    ])
    expect(g?.tips).toHaveLength(2)
    expect(g?.tips[1].points).toEqual([
      { x: 6, y: 0 },
      { x: 4, y: 2 },
      { x: 6, y: 4 },
    ])
    expect(g?.tips[1].normal).toEqual({ x: 1, y: 0 })
    expect(g?.hips).toHaveLength(2)
  })

  it("dormer: hip at the far end only, its edge left open", () => {
    const g = roofGeometry(R, 2, "dormer")
    expect(g?.ridge[0]).toEqual(R[0])
    expect(g?.ridge[1]).toEqual({ x: 4, y: 2 })
    expect(g?.tips).toHaveLength(1)
    expect(g?.edgeClosed).toBe(false)
  })

  it("miters the eaves at the ridge's bends", () => {
    const L = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ]
    const g = roofGeometry(L, 1, "gable")
    // The outer eave corner of the bend.
    expect(g?.edge).toContainEqual({ x: 5, y: -1 })
  })

  it("quickbox: the ridge down the long side's middle, width half the short side", () => {
    expect(quickboxRoof({ x: 0, y: 0 }, { x: 6, y: 4 })).toEqual({ ridge: R, width: 2 })
    expect(quickboxRoof({ x: 0, y: 0 }, { x: 2, y: 8 }).width).toBe(1)
  })

  it("shades faces toward the sun and lays tiles along the ridge", () => {
    expect(roofFaceShade({ x: 1, y: 0 }, 0, 0.4)).toBeCloseTo(1)
    expect(roofFaceShade({ x: -1, y: 0 }, 0, 0.4)).toBeCloseTo(0.6)
    // A slope facing +y: no turn, uv = world px / texture size.
    const uv = slopeUv({ x: 1, y: 1 }, { x: 0, y: 1 }, 256, 512, 512)
    expect(uv.x).toBeCloseTo(0.5)
    expect(uv.y).toBeCloseTo(0.5)
  })
})
