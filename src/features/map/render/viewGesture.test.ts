import { describe, expect, it } from "vitest"
import {
  beginViewGesture,
  endViewGesture,
  subscribeViewGesture,
  viewGestureActive,
} from "./viewGesture"

describe("view gestures", () => {
  it("is active while any gesture is, telling only at the start and end", () => {
    const seen: boolean[] = []
    const off = subscribeViewGesture((on) => seen.push(on))
    beginViewGesture()
    beginViewGesture()
    expect(viewGestureActive()).toBe(true)
    endViewGesture()
    expect(viewGestureActive()).toBe(true)
    endViewGesture()
    endViewGesture()
    expect(viewGestureActive()).toBe(false)
    expect(seen).toEqual([true, false])
    off()
  })
})
