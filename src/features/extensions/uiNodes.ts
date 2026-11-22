/**
 * Helpers for extensions' declarative UI: keys for nodes (trees arrive as
 * plain data with no ids) and calling their callbacks without letting a
 * failure reach the app.
 */

const keys = new WeakMap<object, string>()
let next = 0

/** A key per node object: the same object keeps its key across renders. */
export function nodeKey(node: object): string {
  let key = keys.get(node)
  if (!key) {
    key = `n${++next}`
    keys.set(node, key)
  }
  return key
}

export function callSafely(fn: unknown, ...args: unknown[]): void {
  if (typeof fn === "function") void Promise.resolve(fn(...args)).catch(() => {})
}
