import { chordOf, isHoldBinding, normalizeChord } from "../../lib/keybindings"
import { useSettingsStore } from "../../stores/settingsStore"
import { ACTION_BY_ID, effectiveBindings } from "./actions"

/** The bindings in effect right now (preset + the user's changes). */
export function currentBindings(): Record<string, string[]> {
  const s = useSettingsStore.getState()
  return effectiveBindings(s.shortcutPreset, s.shortcutOverrides)
}

/** The press (non-hold) action `e` triggers under `bindings`, if any. */
export function actionForKey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  bindings: Record<string, readonly string[]>,
): string | null {
  const chord = chordOf(e)
  for (const [id, list] of Object.entries(bindings)) {
    if (ACTION_BY_ID.get(id)?.hold) continue
    if (list.some((b) => !isHoldBinding(b) && normalizeChord(b) === chord)) return id
  }
  return null
}

/** The first binding of an action, for tooltips ("Wall (W)"); reactive. */
export function useActionBinding(actionId: string): string | undefined {
  const preset = useSettingsStore((s) => s.shortcutPreset)
  const override = useSettingsStore((s) => s.shortcutOverrides[actionId])
  return (override ?? effectiveBindings(preset, {})[actionId])?.[0]
}

/** A label with its shortcut appended ("Wall (W)"); the plain label without one. */
export const withBinding = (label: string, binding: string | undefined): string =>
  binding ? `${label} (${binding})` : label
