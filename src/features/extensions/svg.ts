/**
 * Extension icons are SVG text from the extension. They're only ever drawn
 * as images (a CSS mask), where SVG can't run scripts or load anything; on
 * top of that this rebuilds the markup from an allowlist of shapes and
 * presentation attributes, so nothing else survives.
 */

const TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
])
const ATTRS = new Set([
  "viewbox",
  "width",
  "height",
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "fill-rule",
  "clip-rule",
  "opacity",
  "transform",
])
const SAFE_VALUE = /^[\w\s.,#%()+-]*$/

/** The SVG rebuilt from allowed tags and attributes, or null if it isn't one. */
export function sanitizeSvg(input: string): string | null {
  if (typeof input !== "string" || input.length > 8000 || !/^\s*<svg[\s>]/i.test(input)) return null
  const out: string[] = []
  const stack: string[] = []
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(input))) {
    const [, closing, rawName, rawAttrs, selfClosing] = m
    const name = rawName.toLowerCase()
    if (!TAGS.has(name)) continue
    if (closing) {
      if (stack[stack.length - 1] === name) {
        stack.pop()
        out.push(`</${name}>`)
      }
      continue
    }
    const attrs: string[] = name === "svg" ? ['xmlns="http://www.w3.org/2000/svg"'] : []
    const attrRe = /([a-zA-Z][\w:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g
    let a: RegExpExecArray | null
    while ((a = attrRe.exec(rawAttrs))) {
      const key = a[1].toLowerCase()
      const value = a[3] ?? a[4] ?? ""
      if (!ATTRS.has(key) || !SAFE_VALUE.test(value) || /url\s*\(/i.test(value)) continue
      attrs.push(`${key === "viewbox" ? "viewBox" : key}="${value}"`)
    }
    out.push(`<${name}${attrs.length ? " " + attrs.join(" ") : ""}${selfClosing ? "/" : ""}>`)
    if (!selfClosing) stack.push(name)
  }
  while (stack.length) out.push(`</${stack.pop()}>`)
  return out.length ? out.join("") : null
}
