/**
 * Every remappable shortcut, as data: what it does (an action id, handled in
 * map/shortcuts.ts and app-level handlers), how the list groups it, and its
 * bindings per preset. Bindings are chords (lib/keybindings.ts); hold
 * actions (pan, invert) are active while one of theirs is held.
 *
 * The classic preset holds the long-standing default keys; ours on top of it
 * (tool keys, flips, groups…) use keys the classic preset leaves free.
 */

export type ShortcutGroup = "file" | "edit" | "view" | "tools"

export interface ShortcutAction {
  id: string
  group: ShortcutGroup
  /** i18n key of its name in the shortcuts list. */
  labelKey: string
  /** Active while held (rather than fired on press). */
  hold?: boolean
}

export const PRESETS = ["classic"] as const
export type PresetId = (typeof PRESETS)[number]

/**
 * A saved preset id, or the default one when it's no longer offered (e.g. a
 * preset renamed since the settings were saved).
 */
export function knownPreset(id: unknown): PresetId {
  return (PRESETS as readonly unknown[]).includes(id) ? (id as PresetId) : PRESETS[0]
}

/** Tools that get a "select tool" shortcut, with their classic-preset key. */
const TOOL_KEYS: Record<string, string[]> = {
  build: ["B"],
  wall: ["W"],
  portal: ["D"],
  cave: ["V"],
  pattern: ["Shift+P"],
  roof: ["Shift+R"],
  terrainBrush: ["U"],
  water: ["Q"],
  material: ["M"],
  path: ["P"],
  object: ["O"],
  scatter: ["Y"],
  light: ["I"],
  text: ["K"],
  prefabs: ["Shift+B"],
}

const action = (
  id: string,
  group: ShortcutGroup,
  hold = false,
  labelKey = `shortcuts.action_${id}`,
): ShortcutAction => ({ id, group, labelKey, hold })

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  action("newMap", "file"),
  action("open", "file"),
  action("save", "file"),
  action("saveAs", "file"),
  action("export", "file"),
  action("undo", "edit"),
  action("redo", "edit"),
  action("delete", "edit"),
  action("group", "edit"),
  action("ungroup", "edit"),
  action("lock", "edit"),
  action("unlock", "edit"),
  action("flipH", "edit"),
  action("flipV", "edit"),
  action("pan", "view", true),
  action("zoomIn", "view"),
  action("zoomOut", "view"),
  action("fullscreen", "view"),
  action("grid", "view"),
  action("snap", "view"),
  action("lighting", "view"),
  action("shadows", "view"),
  action("outside", "view"),
  action("guide", "view"),
  action("ruler", "view"),
  action("reference", "view"),
  action("compareLevels", "view"),
  action("levelUp", "view"),
  action("levelDown", "view"),
  action("invert", "tools", true),
  action("brushSmaller", "tools"),
  action("brushBigger", "tools"),
  action("selectTool", "tools"),
  ...Object.keys(TOOL_KEYS).map((t) => action(`tool:${t}`, "tools", false, `tools.${t}`)),
]

export const ACTION_BY_ID = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a]))

export const PRESET_BINDINGS: Record<PresetId, Record<string, string[]>> = {
  classic: {
    newMap: ["Ctrl+N"],
    open: ["Ctrl+O"],
    save: ["Ctrl+S"],
    saveAs: ["Ctrl+Shift+S"],
    export: ["Ctrl+E"],
    undo: ["Ctrl+Z"],
    redo: ["Ctrl+Y"],
    delete: ["Delete", "Backspace"],
    group: ["Ctrl+G"],
    ungroup: ["Ctrl+Shift+G"],
    // The classic preset has no lock shortcuts; these keys are free in it.
    lock: ["Ctrl+L"],
    unlock: ["Ctrl+Shift+L"],
    flipH: ["F"],
    flipV: ["Shift+F"],
    pan: ["Space", "MouseMiddle"],
    zoomIn: ["Ctrl+=", "Ctrl++"],
    zoomOut: ["Ctrl+-"],
    fullscreen: ["Alt+Enter"],
    grid: ["G"],
    snap: ["S"],
    lighting: ["L"],
    shadows: ["Shift+L"],
    outside: ["Shift+O"],
    guide: ["H"],
    ruler: ["R"],
    reference: ["T"],
    compareLevels: ["C"],
    levelUp: ["PageUp"],
    levelDown: ["PageDown"],
    invert: ["Alt"],
    // The classic preset binds the keys that type { and } (unshifted on Latin
    // American layouts); [ and ] are the same keys on US layouts.
    brushSmaller: ["{", "["],
    brushBigger: ["}", "]"],
    selectTool: ["X"],
    ...Object.fromEntries(Object.entries(TOOL_KEYS).map(([t, keys]) => [`tool:${t}`, keys])),
  },
}

/**
 * Chords the app keeps for itself (not remappable): clipboard, select all,
 * Escape, the quick layer keys. Shown as conflicts if an action reuses one.
 */
export const FIXED_CHORDS = [
  "Ctrl+C",
  "Ctrl+X",
  "Ctrl+V",
  "Ctrl+A",
  "Escape",
  "Enter",
  "1",
  "2",
  "3",
  "4",
  "7",
  "9",
  "Alt+1",
  "Alt+4",
]

/** The bindings in effect: the preset's, with the user's changes on top. */
export function effectiveBindings(
  preset: PresetId,
  overrides: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const a of SHORTCUT_ACTIONS) {
    out[a.id] = [...(overrides[a.id] ?? PRESET_BINDINGS[preset][a.id] ?? [])]
  }
  return out
}
