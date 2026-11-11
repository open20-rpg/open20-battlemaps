/**
 * Single-key keyboard shortcuts (optionally with Shift) declared as data on
 * tools and view controls. Ctrl/Cmd/Alt combos are left to the editor's own
 * commands (undo, copy…) and never match these.
 */
export interface Shortcut {
  /** `KeyboardEvent.key`, lowercase ("b", "g"…). */
  key: string
  shift?: boolean
}

type KeyInfo = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">

export function matchesShortcut(e: KeyInfo, s: Shortcut): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  return e.key.toLowerCase() === s.key && e.shiftKey === (s.shift === true)
}

/** How a shortcut reads in tooltips: "B", "Shift+G". */
export function formatShortcut(s: Shortcut): string {
  return `${s.shift ? "Shift+" : ""}${s.key.toUpperCase()}`
}

/** A label with its shortcut appended, "Wall (W)"; the plain label without one. */
export function withShortcut(label: string, s: Shortcut | undefined): string {
  return s ? `${label} (${formatShortcut(s)})` : label
}
