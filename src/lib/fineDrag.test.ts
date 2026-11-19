import { describe, expect, it } from "vitest"
import { fineValueAt, leftSpot, snapToStep, valueAt, wentUp } from "./fineDrag"

const r = { min: 0, max: 100, step: 1 }
const track = { left: 50, width: 200 }

describe("slider fine drag", () => {
  it("puts the value under the finger, on the slider's steps", () => {
    expect(valueAt(150, track, r)).toBe(50)
    expect(valueAt(0, track, r)).toBe(0)
    expect(valueAt(400, track, r)).toBe(100)
    expect(snapToStep(0.30000000000000004, { min: 0, max: 1, step: 0.1 })).toBe(0.3)
  })

  it("moves at a tenth of the finger's speed in the precise mode", () => {
    // 200 px span 100: 1 px is 0.5, so 20 px precise is 1.
    expect(fineValueAt(170, { x: 150, value: 50 }, track.width, r)).toBe(51)
    expect(fineValueAt(110, { x: 150, value: 50 }, track.width, r)).toBe(48)
    expect(fineValueAt(-9999, { x: 150, value: 50 }, track.width, r)).toBe(0)
  })

  it("switches when the finger goes up, or stays (almost) still", () => {
    expect(wentUp(300, 290)).toBe(false)
    expect(wentUp(300, 270)).toBe(true)
    // Going down doesn't.
    expect(wentUp(300, 400)).toBe(false)
    expect(leftSpot({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(false)
    expect(leftSpot({ x: 0, y: 0 }, { x: 6, y: 4 })).toBe(true)
  })
})
