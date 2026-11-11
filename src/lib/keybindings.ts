/**
 * Keyboard/mouse bindings as plain strings ("Ctrl+Z", "Alt+Enter", "Space",
 * "Alt", "MouseMiddle"), so they persist, display and compare trivially.
 *
 * A chord is its modifiers in a fixed order (Ctrl, Alt, Shift) plus one key.
 * A binding that is only a modifier ("Alt") is a hold: it's active while
 * held. Shift is ignored for symbol keys whose character already depends on
 * it ("{", "+"…), so a binding works whatever the keyboard layout needs to
 * type that character.
 */

const NAMED: Record<string, string> = {
  " ": "Space",
  Spacebar: "Space",
  Del: "Delete",
  Esc: "Escape",
  Control: "Ctrl",
  Meta: "Ctrl",
  OS: "Ctrl",
}

/** The key part of a chord for a KeyboardEvent.key. */
export function keyName(key: string): string {
  if (NAMED[key]) return NAMED[key]
  if (key.length === 1) return key.toUpperCase()
  return key
}

const MODIFIERS = ["Ctrl", "Alt", "Shift"] as const
const isModifier = (k: string) => (MODIFIERS as readonly string[]).includes(k)
/** A single printable non-letter character: its Shift is part of the character. */
const isSymbol = (k: string) => k.length === 1 && !/[A-Z0-9]/.test(k)

type KeyInfo = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">

/** The chord a key event produces ("Ctrl+Shift+S", "Alt", "{"). */
export function chordOf(e: KeyInfo): string {
  const key = keyName(e.key)
  const mods: string[] = []
  if ((e.ctrlKey || e.metaKey) && key !== "Ctrl") mods.push("Ctrl")
  if (e.altKey && key !== "Alt") mods.push("Alt")
  if (e.shiftKey && key !== "Shift" && !isSymbol(key)) mods.push("Shift")
  return [...mods, key].join("+")
}

/** Normalize a typed/stored binding to the canonical chord form. */
export function normalizeChord(binding: string): string {
  if (binding === "MouseMiddle") return binding
  const canon = (p: string) => MODIFIERS.find((m) => m.toLowerCase() === p.toLowerCase()) ?? p
  const parts = binding.split("+").filter(Boolean).map(canon)
  // "Ctrl++": a trailing empty part is the "+" key itself.
  if (binding.endsWith("++")) parts.push("+")
  const key = keyName(parts.filter((p) => !isModifier(p)).pop() ?? parts.at(-1) ?? "")
  const mods = MODIFIERS.filter(
    (m) => parts.includes(m) && m !== key && !(m === "Shift" && isSymbol(key)),
  )
  return [...mods, key].join("+")
}

/** Whether a binding is held rather than pressed (a lone modifier, Space, a mouse button). */
export function isHoldBinding(binding: string): boolean {
  return isModifier(binding) || binding === "Space" || binding === "MouseMiddle"
}

/** Whether key event `e` triggers `binding`. */
export function matchesBinding(e: KeyInfo, binding: string): boolean {
  return chordOf(e) === normalizeChord(binding)
}

/**
 * Bindings used by more than one action: chord → the action ids sharing it.
 * `fixed` are chords the app reserves (copy, paste…), reported as owned by
 * the pseudo-action "fixed".
 */
export function findConflicts(
  bindings: Record<string, readonly string[]>,
  fixed: readonly string[] = [],
): Map<string, string[]> {
  const owners = new Map<string, string[]>()
  const add = (chord: string, id: string) => {
    const key = normalizeChord(chord)
    const list = owners.get(key) ?? []
    if (!list.includes(id)) list.push(id)
    owners.set(key, list)
  }
  for (const chord of fixed) add(chord, "fixed")
  for (const [id, list] of Object.entries(bindings)) for (const chord of list) add(chord, id)
  return new Map([...owners].filter(([, ids]) => ids.length > 1))
}
