import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  pasteClipboard,
  selectAll,
} from "../../map/clipboard"
import { useEditorStore } from "../../../stores/editorStore"
import { beginGesture, endGesture, moveEntities, updateEntities } from "../../map/commands"
import {
  bandTouchesSolid,
  boundsOf,
  dist,
  editablePointsOf,
  nearestVertex,
  entityBounds,
  hitTest,
  rectFromCorners,
  rectsIntersect,
  flipEntity,
  isStretchable,
  newId,
  normalizeDegrees,
  scaleEntity,
  selectionBounds,
  transformEntity,
  transformHandles,
  type Rect,
  type ScaleHandle,
} from "../../map/model/geometry"
import { texturePicker, type TextureHit, type TexturePicker } from "../../map/render/texturePick"
import { expandGroups, hasGroups } from "../../map/model/groups"
import { vertexPatches, withLinked } from "../../map/model/links"
import { elementFilter, isLockedSelection, lockedAlone, selectableBy } from "../selectKinds"
import { screenAngle } from "./structures"
import {
  doubleTapDetector,
  insertVertexAt,
  removeVertex,
  screenTiles,
  wheelDegrees,
} from "./shared"
import { type MapEntity, type Vec2 } from "../../map/model/types"
import { type ToolBehavior, type ToolCtx } from "./types"

/** Rotation step (mouse wheel, Shift-snapped rotate handle). */
const ROTATE_STEP = 15

/** How far past a wall's or path's edge a click still picks it, in screen px. */
const HIT_REACH_PX = 8

/** Grab radius of the transform handles, in screen px. */
const HANDLE_GRAB_PX = 9

/** A scale/rotate drag of the selection's handles. */
type TransformDrag =
  | { kind: "rotate"; center: Vec2; start: Vec2; originals: MapEntity[] }
  | {
      kind: "scale"
      handle: ScaleHandle
      /** Where the grabbed handle was. */
      grab: Vec2
      /**
       * The grabbed side and the fixed side on the selection's geometry
       * (wall/path points, not the box padded by their thickness): what the
       * scale is computed on, so Snap to Grid puts the points on the grid.
       */
      start: Vec2
      anchor: Vec2
      originals: MapEntity[]
    }

/** Smallest scale factor a drag can reach (no collapsing or flipping). */
const MIN_FACTOR = 0.05

/** Which transform handle (if any) is under `p` for the current selection. */
export function handleAt(
  ctx: ToolCtx,
  p: Vec2,
  selected: readonly MapEntity[],
): TransformDrag | null {
  const box = selectionBounds(selected, ctx.sizeOf)
  // Locked: no handles to drag.
  if (!box || isLockedSelection(selected)) return null
  const h = transformHandles(box, screenTiles(1), isStretchable(selected))
  const grab = screenTiles(HANDLE_GRAB_PX)
  const start = { x: p.x, y: p.y }
  // Linked partners (a room's wall with its floor) transform along.
  const ids = new Set(
    withLinked(
      selected.map((e) => e.id),
      ctx.entities,
    ),
  )
  const originals = ctx.entities.filter((e) => ids.has(e.id))
  if (dist(p, h.rotate) <= grab) {
    const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    return { kind: "rotate", center, start, originals }
  }
  const handle = h.scale.find((s) => dist(p, s.at) <= grab)
  if (!handle) return null
  const inner = geometryBox(selected, box)
  return {
    kind: "scale",
    handle,
    grab: handle.at,
    start: remap(handle.at, box, inner),
    anchor: remap(handle.anchor, box, inner),
    originals,
  }
}

/** The selection's own geometry box: its points when it's all polylines/polygons. */
function geometryBox(selected: readonly MapEntity[], box: Rect): Rect {
  const allPoints = selected.every((e) => (e.points?.length ?? 0) > 0)
  return allPoints ? boundsOf(selected.flatMap((e) => e.points ?? [])) : box
}

/** The point at the same relative place of `to` as `v` is in `from`. */
function remap(v: Vec2, from: Rect, to: Rect): Vec2 {
  const rel = (p: number, o: number, size: number) => (size > 0 ? (p - o) / size : 0.5)
  return {
    x: to.x + rel(v.x, from.x, from.w) * to.w,
    y: to.y + rel(v.y, from.y, from.h) * to.h,
  }
}

/** Scale factor along one axis: how far the pointer is from the anchor vs. where the handle began. */
const axisFactor = (p: number, start: number, anchor: number) =>
  start === anchor ? 1 : Math.min(10, Math.max(MIN_FACTOR, (p - anchor) / (start - anchor)))

/**
 * Apply a handle drag at pointer `p`, from the drag's originals. Rotation
 * turns around the selection's center (Shift snaps to 15°); scaling keeps
 * the opposite corner/edge fixed, so the selection grows toward the pointer.
 * With `toGrid` (Snap to Grid) the dragged side lands on the grid; a corner
 * puts its longer side there.
 */
export function applyTransformDrag(
  drag: TransformDrag,
  p: Vec2,
  snap: boolean,
  toGrid?: (p: Vec2) => Vec2,
): Map<string, MapEntity> {
  if (drag.kind === "rotate") {
    const from = screenAngle({ x: drag.start.x - drag.center.x, y: drag.start.y - drag.center.y })
    const to = screenAngle({ x: p.x - drag.center.x, y: p.y - drag.center.y })
    let degrees = to - from
    if (snap) degrees = Math.round(degrees / ROTATE_STEP) * ROTATE_STEP
    return new Map(drag.originals.map((e) => [e.id, transformEntity(e, drag.center, degrees, 1)]))
  }
  const { axis } = drag.handle
  const { anchor, start } = drag
  // Where the grabbed side goes: it follows the pointer from where it was.
  const moved = { x: start.x + p.x - drag.grab.x, y: start.y + p.y - drag.grab.y }
  const target = toGrid ? toGrid(moved) : moved
  let sx = 1
  let sy = 1
  if (axis === "both") {
    // Corners scale uniformly: project on the anchor→corner diagonal, or
    // (on the grid) follow the longer side so it lands on a grid line.
    const d = { x: start.x - anchor.x, y: start.y - anchor.y }
    const len2 = d.x * d.x + d.y * d.y
    let t = len2 > 0 ? ((target.x - anchor.x) * d.x + (target.y - anchor.y) * d.y) / len2 : 1
    if (toGrid && len2 > 0) {
      t = Math.abs(d.x) >= Math.abs(d.y) ? (target.x - anchor.x) / d.x : (target.y - anchor.y) / d.y
    }
    sx = sy = Math.min(10, Math.max(MIN_FACTOR, t))
  } else if (axis === "x") {
    sx = axisFactor(target.x, start.x, anchor.x)
  } else {
    sy = axisFactor(target.y, start.y, anchor.y)
  }
  return new Map(drag.originals.map((e) => [e.id, scaleEntity(e, anchor, sx, sy)]))
}

/**
 * Mirror the selection across its own center (left↔right for `"x"`,
 * top↔bottom for `"y"`): positions reflect, sprites flip in place.
 */
export function flipSelection(ctx: ToolCtx, axis: "x" | "y"): void {
  const ids = new Set(useEditorStore.getState().selection)
  const selected = ctx.entities.filter((e) => ids.has(e.id))
  const box = selectionBounds(selected, ctx.sizeOf)
  if (!box) return
  const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  const flipped = new Set(withLinked([...ids], ctx.entities))
  updateEntities(
    new Map(
      ctx.entities.filter((e) => flipped.has(e.id)).map((e) => [e.id, flipEntity(e, center, axis)]),
    ),
  )
}

/** Join the selection into one group (replacing any groups it had). */
export function groupSelection(ctx: ToolCtx): void {
  const ids = new Set(useEditorStore.getState().selection)
  const selected = ctx.entities.filter((e) => ids.has(e.id))
  if (selected.length < 2) return
  const group = newId()
  updateEntities(new Map(selected.map((e) => [e.id, { group }])))
}

/** Dissolve the groups of the selection; the members stay selected. */
export function ungroupSelection(ctx: ToolCtx): void {
  const ids = new Set(useEditorStore.getState().selection)
  const grouped = ctx.entities.filter((e) => ids.has(e.id) && e.group)
  if (grouped.length === 0) return
  updateEntities(new Map(grouped.map((e) => [e.id, { group: undefined }])))
}

/** Below this alpha a texture's pixel counts as empty (soft, anti-aliased edges). */
const ALPHA_PICK_MIN = 8

/**
 * With the Select tool's "Click through transparency" on (the default), a
 * point picks a textured entity (objects, portals, paths, walls, patterns,
 * floors) only where its texture isn't transparent: elsewhere it goes
 * through to what's under it. Untextured ones (lights, texts, painted
 * strokes, roofs), and any whose texture isn't loaded yet, go by their shape.
 * Each entity's geometry is built once per check (a band samples it many times).
 */
function solidAt(ctx: ToolCtx) {
  const portals = ctx.entities.filter((e) => e.toolId === "portal")
  const pickers = new Map<MapEntity, TexturePicker | undefined>()
  const pickerOf = (e: MapEntity) => {
    if (!pickers.has(e)) pickers.set(e, texturePicker(e, ctx.sizeOf, portals))
    return pickers.get(e)
  }
  const opaque = (hit: TextureHit) => {
    const alpha = ctx.alphaAt(hit.asset, hit.u, hit.v)
    return alpha === undefined || alpha * hit.opacity >= ALPHA_PICK_MIN
  }
  /** Whether `e` is solid at `p` (a click). */
  const at = (e: MapEntity, p: Vec2) => {
    const hit = pickerOf(e)?.at(p)
    return hit === undefined || (hit !== null && opaque(hit))
  }
  /** Whether a band covers some of `e`'s opaque pixels. */
  const inBand = (e: MapEntity, band: Rect, bounds: Rect) => {
    const spread = pickerOf(e)?.spread?.()
    if (!spread) return bandTouchesSolid(band, bounds, (p) => at(e, p))
    return spread.some(({ p, hit }) => pointInRect(p, band) && opaque(hit))
  }
  return { at, inBand }
}

const pointInRect = (p: Vec2, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

/** What clicks and rubber bands may pick: the Select tool's element filter, locked or not. */
const pickable = (ctx: ToolCtx) => selectableBy(elementFilter(ctx.params), "any", ctx.entities)

/** `selection` with `ids` toggled (Shift): those in it leave, the rest join. */
function toggled(selection: readonly string[], ids: readonly string[]): string[] {
  const next = new Set(selection)
  for (const id of ids) {
    if (next.has(id)) next.delete(id)
    else next.add(id)
  }
  return [...next]
}

/** Where a locked selection's unlock button sits: the rotate handle's spot (it can't turn). */
export function unlockHandleAt(ctx: ToolCtx, selected: readonly MapEntity[]): Vec2 | null {
  if (!isLockedSelection(selected)) return null
  const box = selectionBounds(selected, ctx.sizeOf)
  return box ? transformHandles(box, screenTiles(1)).rotate : null
}

/** Lock (or unlock) the selection in place. */
export function lockSelection(ctx: ToolCtx, locked: boolean): void {
  const ids = new Set(useEditorStore.getState().selection)
  const changed = ctx.entities.filter((e) => ids.has(e.id) && !!e.locked !== locked)
  updateEntities(new Map(changed.map((e) => [e.id, { locked: locked || undefined }])))
}

/** Turn the selected sprites (objects, portals, lights…) by `delta` degrees each, in place. */
export function rotateSelection(ctx: ToolCtx, delta: number): void {
  const ids = new Set(useEditorStore.getState().selection)
  const patches = new Map(
    ctx.entities
      .filter((x) => ids.has(x.id) && !x.points && !x.strokes)
      .map((x) => [x.id, { rotation: normalizeDegrees(x.rotation + delta) }]),
  )
  updateEntities(patches)
}

/**
 * Entities whose bounds intersect the rubber band. Locked ones count only
 * when the band caught nothing else.
 */
export function entitiesInRect(ctx: ToolCtx, a: Vec2, b: Vec2): MapEntity[] {
  const band = rectFromCorners(a, b)
  const pick = pickable(ctx)
  // Click through transparency: a band picks a textured entity only where
  // it covers some of its opaque pixels (a click on its transparent part, a
  // band of no size, picks nothing), as a click does.
  const solid = ctx.params.alphaPick === true ? solidAt(ctx) : undefined
  const caught = ctx.entities.filter((e) => {
    if (!pick(e)) return false
    const bounds = entityBounds(e, ctx.sizeOf)
    return solid ? solid.inBand(e, band, bounds) : rectsIntersect(bounds, band)
  })
  const unlocked = caught.filter((e) => !e.locked)
  return unlocked.length > 0 ? unlocked : caught
}

/** Screen px a press may travel and still be a click (not a rubber band). */
const CLICK_SLOP_PX = 4

/**
 * Select: click picks the topmost entity (Shift adds/toggles), dragging a
 * selected entity moves the selection (one undo step), dragging empty space
 * rubber-band selects. The selection box's corner handles scale it uniformly
 * and its edge handles (selections with walls, paths, areas…) stretch it,
 * keeping the opposite corner/edge fixed; the top handle rotates it around
 * its center (Shift snaps to 15°). The flip shortcuts (or the panel buttons) mirror the
 * selection left↔right / top↔bottom. `[`/`]`
 * rotate the selection too; Delete/Ctrl+C/V/X are the global shortcuts.
 * Locked entities are selected only by themselves (a click on one, a band
 * that caught nothing else; Shift adding an unlocked one drops them) and
 * can't be changed: the lock button at their rotate handle's spot unlocks
 * them, the one thing they allow.
 */
export function createSelectBehavior(): ToolBehavior {
  let mode:
    | { kind: "move"; from: Vec2; moved: Vec2 }
    // `tap`: a press on a locked entity, selected if it doesn't become a band.
    | { kind: "band"; from: Vec2; to: Vec2; tap?: string[] }
    | { kind: "transform"; drag: TransformDrag }
    | { kind: "vertex"; id: string; index: number }
    | null = null
  const selectedOf = (ctx: ToolCtx) => {
    const ids = new Set(editor().selection)
    return ctx.entities.filter((x) => ids.has(x.id))
  }
  const editor = () => useEditorStore.getState()
  const isDoubleTap = doubleTapDetector()
  return {
    onPointerDown: (ctx, e) => {
      // Right-click (or a long press on touch) on a point of the selected
      // wall/path/area removes it.
      if (e.button === 2) {
        const lone = editablePointsOf(selectedOf(ctx))
        const at = lone && nearestVertex(lone.points ?? [], e, screenTiles(8))
        if (lone && at !== undefined && at !== null) removeVertex(ctx, lone, at)
        return
      }
      if (e.button !== 0) return
      const doubleTap = isDoubleTap(e)
      // A locked selection's lock button unlocks it.
      const unlock = unlockHandleAt(ctx, selectedOf(ctx))
      if (unlock && dist(e, unlock) <= screenTiles(HANDLE_GRAB_PX)) {
        lockSelection(ctx, false)
        return
      }
      // A lone wall/path/area shows its points: dragging one moves just it.
      const editable = editablePointsOf(selectedOf(ctx))
      const index = editable && nearestVertex(editable.points ?? [], e, screenTiles(8))
      if (editable && index !== null && index !== undefined) {
        beginGesture()
        mode = { kind: "vertex", id: editable.id, index }
        return
      }
      // A double tap on its line adds a point there, already being dragged.
      const inserted = editable && doubleTap ? insertVertexAt(ctx, editable, e) : null
      if (editable && inserted !== null) {
        mode = { kind: "vertex", id: editable.id, index: inserted }
        return
      }
      // Handles win over whatever is underneath them.
      const drag = handleAt(ctx, e, selectedOf(ctx))
      if (drag) {
        beginGesture()
        mode = { kind: "transform", drag }
        return
      }
      // Lines (walls, paths) are picked within a few screen px of their
      // edges, whatever the zoom.
      const reach = Math.max(0.2, screenTiles(HIT_REACH_PX))
      const solid = ctx.params.alphaPick === true ? solidAt(ctx) : undefined
      const hit = hitTest(ctx.entities, e, ctx.sizeOf, pickable(ctx), reach, solid?.at)
      const { selection } = editor()
      const from = { x: e.x, y: e.y }
      if (hit) {
        // A group member picks the whole group.
        const picked = expandGroups([hit.id], ctx.entities)
        // A locked one can't be dragged: a press on it still bands, and
        // selects it if it ends up a click.
        if (hit.locked) {
          if (!e.shiftKey) editor().select([])
          mode = { kind: "band", from, to: from, tap: picked }
          return
        }
        if (e.shiftKey) {
          editor().select(lockedAlone(toggled(selection, picked), ctx.entities))
          return
        }
        if (!selection.includes(hit.id)) editor().select(picked)
        beginGesture()
        mode = { kind: "move", from: ctx.snap(e, 0.5), moved: { x: 0, y: 0 } }
        return
      }
      if (!e.shiftKey) editor().select([])
      mode = { kind: "band", from, to: from }
    },
    onPointerMove: (ctx, e) => {
      if (!mode || !e.buttons) return
      if (mode.kind === "vertex") {
        const { id, index } = mode
        const entity = ctx.entities.find((x) => x.id === id)
        if (!entity?.points) return
        updateEntities(vertexPatches(entity, index, ctx.snap(e, 0.5), ctx.entities))
        return
      }
      if (mode.kind === "transform") {
        // Scaling follows Snap to Grid like moving does; rotation snaps with Shift.
        const toGrid = ctx.snapEnabled ? (p: Vec2) => ctx.snap(p, 0.5) : undefined
        // Alt or Shift snaps the rotate handle to 15° steps.
        updateEntities(applyTransformDrag(mode.drag, e, e.altKey || e.shiftKey, toGrid))
        return
      }
      if (mode.kind === "move") {
        const p = ctx.snap(e, 0.5)
        const total = { x: p.x - mode.from.x, y: p.y - mode.from.y }
        const step = { x: total.x - mode.moved.x, y: total.y - mode.moved.y }
        moveEntities(withLinked(editor().selection, ctx.entities), step)
        mode.moved = total
      } else {
        mode.to = { x: e.x, y: e.y }
        editor().setDraft([{ kind: "rect", a: mode.from, b: mode.to }])
      }
    },
    // Wheel turns the selection ±15° (±5° with Z held).
    onWheel: (ctx, e) => {
      if (editor().selection.length === 0 || isLockedSelection(selectedOf(ctx))) return false
      rotateSelection(ctx, e.dir * wheelDegrees())
      return true
    },
    onPointerUp: (ctx, e) => {
      if (mode?.kind === "move" || mode?.kind === "transform" || mode?.kind === "vertex")
        endGesture()
      if (mode?.kind === "band") {
        const click = dist(mode.from, mode.to) <= screenTiles(CLICK_SLOP_PX)
        const ids =
          click && mode.tap
            ? mode.tap
            : expandGroups(
                entitiesInRect(ctx, mode.from, mode.to).map((x) => x.id),
                ctx.entities,
              )
        const next = e.shiftKey ? toggled(editor().selection, ids) : ids
        editor().select(lockedAlone(next, ctx.entities))
        editor().setDraft([])
      }
      mode = null
    },
    onAction: (ctx, action) => {
      if (action === "delete") deleteSelection()
      if (action === "duplicate") duplicateSelection()
      if (action === "copy") copySelection()
      if (action === "paste") pasteClipboard()
      if (action === "selectAll") selectAll()
      if (action === "deselect") editor().select([])
      if (action === "flipH") flipSelection(ctx, "x")
      if (action === "flipV") flipSelection(ctx, "y")
      if (action === "group") groupSelection(ctx)
      if (action === "ungroup") ungroupSelection(ctx)
      if (action === "lock" || action === "unlock") lockSelection(ctx, action === "lock")
    },
    isActionDisabled: (ctx, action) => {
      if (action === "paste") return editor().clipboard.length === 0
      if (action === "selectAll") return false
      const selected = selectedOf(ctx)
      // Locked: unlocking (or letting go of them) is all they allow.
      if (isLockedSelection(selected)) return action !== "unlock" && action !== "deselect"
      if (action === "group") return selected.length < 2
      if (action === "ungroup") return !hasGroups(selected)
      if (action === "lock") return !selected.some((x) => !x.locked)
      if (action === "unlock") return !selected.some((x) => x.locked)
      return selected.length === 0
    },
    onDeactivate: () => {
      if (mode?.kind === "move" || mode?.kind === "transform") endGesture()
      mode = null
      editor().setDraft([])
    },
    // A long press on a point removes it, like a right-click.
    longPressRightClick: () => true,
    cursor: () => "default",
  }
}
