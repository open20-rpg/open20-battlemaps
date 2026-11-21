/**
 * The leading JSON object/array of `raw` when other text follows it, or null
 * when there's no such split (nothing after it, or no complete value).
 *
 * An overwrite that doesn't truncate (Android SAF in "w" mode) leaves the tail
 * of the previous, longer file after the new document: the new one is intact
 * and comes first, so it can be recovered whole. This only finds where the
 * first value ends (tracking strings and escapes); the caller still parses it.
 */
export function leadingJsonValue(raw: string): string | null {
  let i = 0
  while (i < raw.length && /\s/.test(raw[i])) i++
  if (raw[i] !== "{" && raw[i] !== "[") return null
  const start = i
  let depth = 0
  let inString = false
  for (; i < raw.length; i++) {
    const c = raw[i]
    if (inString) {
      if (c === "\\") i++
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
    } else if (c === "{" || c === "[") {
      depth++
    } else if (c === "}" || c === "]") {
      depth--
      if (depth === 0) {
        const rest = raw.slice(i + 1)
        return rest.trim() === "" ? null : raw.slice(start, i + 1)
      }
    }
  }
  return null
}
