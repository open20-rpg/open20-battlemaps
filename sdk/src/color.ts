/** Color helpers on `#rrggbb` strings (the format every API uses). */

export interface Rgb {
  r: number
  g: number
  b: number
}

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1]
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

export const toHex = ({ r, g, b }: Rgb): string =>
  "#" + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")

export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a) ?? { r: 0, g: 0, b: 0 }
  const y = parseHex(b) ?? { r: 0, g: 0, b: 0 }
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t })
}

/** HSL (h 0–360, s and l 0–1) to `#rrggbb`. */
export function hsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return toHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 })
}

export function toHsl(hex: string): { h: number; s: number; l: number } {
  const c = parseHex(hex) ?? { r: 0, g: 0, b: 0 }
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60
  return { h, s, l }
}

/** Relative luminance (0 dark … 1 light). */
export function luminance(hex: string): number {
  const c = parseHex(hex) ?? { r: 0, g: 0, b: 0 }
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

/** `count` colors evenly spaced around the hue wheel. */
export function palette(count: number, saturation = 0.6, lightness = 0.5, offset = 0): string[] {
  return Array.from({ length: count }, (_, i) =>
    hsl((offset + (360 / count) * i) % 360, saturation, lightness),
  )
}
