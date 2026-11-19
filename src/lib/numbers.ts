/**
 * `v` rounded to at most `digits` decimals, without trailing zeros: for
 * numbers shown to people (a 1.3333… screen scale reads 1.33).
 */
export function roundTo(v: number, digits = 2): number {
  const k = 10 ** digits
  return Math.round(v * k) / k
}
