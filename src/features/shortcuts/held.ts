import { keyName } from "../../lib/keybindings"
import { currentBindings } from "./bindings"

/**
 * What's being held down right now, for hold actions (pan with Space or the
 * middle button, invert with Alt): the keys by chord name, plus
 * "MouseMiddle". Cleared when the window loses focus (a key released
 * elsewhere would otherwise stay "held").
 */
const down = new Set<string>()

export function pressKey(key: string): void {
  down.add(keyName(key))
}
export function releaseKey(key: string): void {
  down.delete(keyName(key))
}
export function setMouseMiddle(held: boolean): void {
  if (held) down.add("MouseMiddle")
  else down.delete("MouseMiddle")
}
export function releaseAll(): void {
  down.clear()
}

/** Whether a key (by chord name: "Z", "Space"…) is held right now. */
export const isKeyHeld = (key: string): boolean => down.has(key)

/** Whether hold action `actionId` is active (one of its bindings held). */
export function isHeld(actionId: string): boolean {
  return (currentBindings()[actionId] ?? []).some((b) => down.has(b))
}
