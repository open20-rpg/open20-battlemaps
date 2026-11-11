import { describe, expect, it } from "vitest"
import { DEFAULT_POST_PROCESS, applyPostProcess, isNeutral, type PostProcess } from "./postProcess"

const pp = (patch: Partial<PostProcess>): PostProcess => ({ ...DEFAULT_POST_PROCESS, ...patch })
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 3))

describe("post-processing", () => {
  it("leaves colors alone by default", () => {
    expect(isNeutral(DEFAULT_POST_PROCESS)).toBe(true)
    close(applyPostProcess([0.2, 0.5, 0.8], DEFAULT_POST_PROCESS), [0.2, 0.5, 0.8])
  })

  it("adjusts brightness and contrast, clamped", () => {
    close(applyPostProcess([0.2, 0.5, 0.95], pp({ brightness: 0.1 })), [0.3, 0.6, 1])
    close(applyPostProcess([0.25, 0.5, 0.75], pp({ contrast: 1 })), [0, 0.5, 1])
    close(applyPostProcess([0.25, 0.5, 0.75], pp({ contrast: -1 })), [0.5, 0.5, 0.5])
  })

  it("desaturates and filters", () => {
    const [r, g, b] = applyPostProcess([1, 0, 0], pp({ saturation: -1 }))
    expect(r).toBeCloseTo(g)
    expect(g).toBeCloseTo(b)
    close(applyPostProcess([0.2, 0.4, 0.6], pp({ filter: "invert" })), [0.8, 0.6, 0.4])
  })

  it("thresholds to pure black and white for printing", () => {
    expect(applyPostProcess([0.7, 0.7, 0.7], pp({ filter: "threshold" }))).toEqual([1, 1, 1])
    expect(applyPostProcess([0.3, 0.3, 0.3], pp({ filter: "threshold" }))).toEqual([0, 0, 0])
    expect(applyPostProcess([0.3, 0.3, 0.3], pp({ filter: "threshold", threshold: 0.2 }))).toEqual([
      1, 1, 1,
    ])
    expect(isNeutral(pp({ filter: "threshold" }))).toBe(false)
  })
})
