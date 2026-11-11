import { create } from "zustand"
import { type MapEntity, type Vec2 } from "../features/map/model/types"

/**
 * Transient shapes a tool draws while it's being used (not part of the
 * document): the polyline being clicked out, a rubber-band rect, the brush
 * cursor, a semi-transparent preview of what will be placed…
 */
export type DraftShape =
  | { kind: "polyline"; points: Vec2[]; closed?: boolean }
  | { kind: "rect"; a: Vec2; b: Vec2 }
  | { kind: "polygon"; points: Vec2[] }
  | { kind: "circle"; center: Vec2; radius: number }
  /** A not-yet-placed entity, drawn by its real renderer at reduced opacity. */
  | { kind: "ghost"; entity: MapEntity }
  /** Draggable vertex handles (edit-points mode). */
  | { kind: "handles"; points: Vec2[] }

/** Inline text editor open over the canvas (Text tool). */
export interface TextEditState {
  /** Entity being edited, or null when creating a new text at `position`. */
  entityId: string | null
  position: Vec2
  value: string
}

/**
 * Editor session state: what's selected, which level is being edited, and
 * the active tool's in-progress drafts. It's UI state around the document —
 * never part of it — so it lives outside undo/redo and isn't persisted.
 */
interface EditorState {
  selection: string[]
  /** Level being edited/drawn on top (null when no map is open). */
  activeLevel: string | null
  draft: DraftShape[]
  textEdit: TextEditState | null
  /** Last pointer position over the map, in tiles (status bar readout). */
  pointer: Vec2 | null
  /** Copied entities (Ctrl+C), pasted with fresh ids. */
  clipboard: MapEntity[]
  select: (ids: string[]) => void
  /** Add to (or toggle within) the selection. */
  toggleSelect: (ids: string[]) => void
  deselect: (ids: readonly string[]) => void
  setActiveLevel: (id: string | null) => void
  setDraft: (draft: DraftShape[]) => void
  setTextEdit: (edit: TextEditState | null) => void
  setPointer: (p: Vec2 | null) => void
  setClipboard: (entities: MapEntity[]) => void
  /** Clear the whole session (map created/opened/closed). */
  reset: (activeLevel: string | null) => void
}

export const useEditorStore = create<EditorState>()((set) => ({
  selection: [],
  activeLevel: null,
  draft: [],
  textEdit: null,
  pointer: null,
  clipboard: [],
  select: (ids) => set({ selection: ids }),
  toggleSelect: (ids) =>
    set((s) => {
      const next = new Set(s.selection)
      for (const id of ids) {
        if (next.has(id)) next.delete(id)
        else next.add(id)
      }
      return { selection: [...next] }
    }),
  deselect: (ids) =>
    set((s) => {
      const drop = new Set(ids)
      const selection = s.selection.filter((id) => !drop.has(id))
      return selection.length === s.selection.length ? s : { selection }
    }),
  setActiveLevel: (activeLevel) => set({ activeLevel, selection: [] }),
  setDraft: (draft) => set({ draft }),
  setTextEdit: (textEdit) => set({ textEdit }),
  setPointer: (pointer) => set({ pointer }),
  setClipboard: (clipboard) => set({ clipboard }),
  reset: (activeLevel) =>
    set({ selection: [], activeLevel, draft: [], textEdit: null, pointer: null }),
}))
