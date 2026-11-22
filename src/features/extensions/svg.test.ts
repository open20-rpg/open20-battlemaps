import { describe, expect, it } from "vitest"
import { sanitizeSvg } from "./svg"

describe("sanitizeSvg", () => {
  it("keeps shapes and presentation attributes", () => {
    const svg = sanitizeSvg(
      '<svg viewBox="0 0 24 24"><path d="M0 0L24 24" stroke="currentColor"/></svg>',
    )
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0L24 24" stroke="currentColor"/></svg>',
    )
  })

  it("drops scripts, handlers, links and external references", () => {
    const svg = sanitizeSvg(
      '<svg onload="alert(1)"><script>alert(1)</script><a href="javascript:x"><circle r="2" fill="url(https://evil/x)" style="x"/></a><image href="https://evil"/></svg>',
    )
    expect(svg).not.toMatch(/onload|script|href|url|style|image|<a/)
    expect(svg).toContain('<circle r="2"/>')
  })

  it("rejects what isn't an SVG", () => {
    expect(sanitizeSvg("<div>x</div>")).toBeNull()
    expect(sanitizeSvg("x".repeat(9000))).toBeNull()
  })
})
