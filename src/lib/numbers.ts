/**
 * `v` rounded to at most `digits` decimals, without trailing zeros: for
 * numbers shown to people (a 1.3333… screen scale reads 1.33).
 */
export function roundTo(v: number, digits = 2): number {
  const k = 10 ** digits
  return Math.round(v * k) / k
}

/** Decimals a slider step shows (0.01 → 2, 5 → 0). */
export function stepDecimals(step: number): number {
  const text = String(step)
  const exp = /e-(\d+)$/.exec(text)
  if (exp) return Number(exp[1])
  return text.includes(".") ? text.split(".")[1].length : 0
}

/** A slider's value as shown: rounded to its step's decimals (a scaled 1.18723… reads 1.19). */
export function formatStep(value: number, step: number): string {
  return String(roundTo(value, stepDecimals(step)))
}
