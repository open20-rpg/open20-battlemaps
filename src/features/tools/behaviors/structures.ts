import { useEditorStore } from "../../../stores/editorStore"
import { useToolsStore } from "../../../stores/toolsStore"
import {
  addEntities,
  beginGesture,
  endGesture,
  removeEntities,
  updateEntities,
} from "../../map/commands"
import {
  closestOnSegment,
  dist,
  joinPolylines,
  newId,
  normalizeDegrees,
  segmentsOf,
} from "../../map/model/geometry"
import { bridgeHoles, subtractPolygon } from "../../map/model/clip"
import { sameOutline } from "../../map/model/links"
import { type MapEntity, type Vec2 } from "../../map/model/types"
import { isHeld } from "../../shortcuts/held"
import { type AssetSelection } from "../params"
import {
  editPointsController,
  makeEntity,
  paramNum,
  polylineController,
  shapeController,
} from "./shared"
import { type ToolBehavior, type ToolCtx } from "./types"

const under = (ctx: ToolCtx) => ctx.params.sorting === "under"
const selection = (v: unknown): AssetSelection =>
  (v as AssetSelection | undefined) ?? { assets: [], color: "#ffffff" }

/** Layer buckets of structural entities (see MAP_LAYERS). */
export const LAYER = { floor: -200, portal: 500, wall: 600, roof: 800 } as const

/**
 * Switch between a drawing behavior and vertex editing based on the tool's
 * `editPoints` param, so each tool only declares what it draws.
 */
function withEditPoints(draw: ToolBehavior, editToolIds: string[]): ToolBehavior {
  const edit = editPointsController(editToolIds)
  const pick = (ctx: ToolCtx): ToolBehavior => (ctx.params.editPoints === true ? edit : draw)
  return {
    onPointerDown: (ctx, e) => pick(ctx).onPointerDown?.(ctx, e),
    onPointerMove: (ctx, e) => pick(ctx).onPointerMove?.(ctx, e),
    onPointerUp: (ctx, e) => pick(ctx).onPointerUp?.(ctx, e),
    onDoubleClick: (ctx, e) => pick(ctx).onDoubleClick?.(ctx, e),
    onKeyDown: (ctx, e) => pick(ctx).onKeyDown?.(ctx, e) ?? false,
    onWheel: (ctx, e) => pick(ctx).onWheel?.(ctx, e) ?? false,
    onDeactivate: (ctx) => {
      draw.onDeactivate?.(ctx)
      edit.onDeactivate(ctx)
    },
    onParamsChange: (ctx, patch) => {
      // Leaving/entering edit mode drops the other mode's draft.
      if ("editPoints" in patch || "shape" in patch) {
        draw.onDeactivate?.(ctx)
        edit.onDeactivate(ctx)
        if (patch.editPoints === true) edit.show(ctx)
      }
    },
    onActivate: (ctx) => {
      if (ctx.params.editPoints === true) edit.show(ctx)
    },
    cursor: (params) => (params.editPoints === true ? "pointer" : "crosshair"),
    // Editing points: a long press on one removes it, like a right-click.
    longPressRightClick: (ctx) => ctx.params.editPoints === true,
  }
}

export function wallEntity(
  ctx: ToolCtx,
  points: Vec2[],
  closed: boolean,
  wall: AssetSelection,
): MapEntity {
  return makeEntity(ctx, {
    toolId: "wall",
    layer: LAYER.wall,
    points,
    closed,
    position: points[0],
    params: {
      wall,
      shadow: ctx.params.shadow !== false,
      bevelCorners: ctx.params.bevelCorners !== false,
    },
  })
}

/**
 * Each tool builds its entities in one place, used both to commit the shape
 * and to preview it (drawn by the real renderers) while it's being drawn.
 */
const wallEntities = (ctx: ToolCtx, points: Vec2[]) => [
  wallEntity(ctx, points, false, selection(ctx.params.wall)),
]

/**
 * Join a new wall run to the open walls of the level that it meets end to
 * end (Ctrl when finishing, as in Dungeondraft): the first one it touches
 * takes the new points, and one touching the other end is merged in too.
 * Returns false when nothing meets it.
 */
export function joinWall(ctx: ToolCtx, points: Vec2[]): boolean {
  const open = ctx.entities.filter((e) => e.toolId === "wall" && !e.closed && e.points?.length)
  const tol = 1e-3
  let target: MapEntity | undefined
  let merged: Vec2[] | null = null
  for (const w of open) {
    merged = joinPolylines(w.points ?? [], points, tol)
    if (merged) {
      target = w
      break
    }
  }
  if (!target || !merged) return false
  let joined = merged
  const absorbed: string[] = []
  for (const w of open) {
    if (w.id === target.id) continue
    const more = joinPolylines(joined, w.points ?? [], tol)
    if (more) {
      joined = more
      absorbed.push(w.id)
      break
    }
  }
  beginGesture()
  updateEntities(new Map([[target.id, { points: joined, position: joined[0] }]]))
  if (absorbed.length) removeEntities(absorbed)
  endGesture()
  return true
}

/**
 * Wall: click out a wall run (double-click/Enter/right-click to finish;
 * with Ctrl, it joins the walls it meets end to end).
 */
export function createWallBehavior(): ToolBehavior {
  return withEditPoints(
    polylineController({
      minPoints: 2,
      closed: false,
      preview: wallEntities,
      commit: (ctx, points, mods) => {
        if (mods.ctrlKey && joinWall(ctx, points)) return
        addEntities(wallEntities(ctx, points), under(ctx))
      },
    }),
    ["wall"],
  )
}

/** A room: the floor polygon plus the wall around it, linked (they move and reshape together). */
const buildEntities = (ctx: ToolCtx, polygon: Vec2[]) => {
  const link = newId()
  return [
    makeEntity(ctx, {
      link,
      toolId: "build",
      layer: LAYER.floor,
      points: polygon,
      closed: true,
      position: polygon[0],
      params: {
        floor: selection(ctx.params.floor),
        bevelCorners: ctx.params.bevelCorners !== false,
        shadow: ctx.params.shadow !== false,
      },
    }),
    { ...wallEntity(ctx, polygon, true, selection(ctx.params.wall)), link },
  ]
}

/**
 * Cut `cut` out of the level's `toolId` polygons (Alt with Build/Pattern),
 * in one undo step: each one touched keeps its first piece (holes bridged
 * into its ring) and copies take the rest. Build's floors bring their walls
 * along: the wall around a floor is rebuilt as one closed wall per outline
 * and hole of what's left.
 */
export function subtractShape(ctx: ToolCtx, toolId: string, cut: Vec2[]): void {
  const patches = new Map<string, Partial<MapEntity>>()
  const added: MapEntity[] = []
  const removed: string[] = []
  const reshape = (e: MapEntity, rings: Vec2[][]) => {
    const [first, ...rest] = rings
    if (!first) return removed.push(e.id)
    patches.set(e.id, { points: first, position: first[0] })
    for (const ring of rest) added.push({ ...e, id: newId(), points: ring, position: ring[0] })
  }
  for (const e of ctx.entities) {
    if (e.toolId !== toolId || !e.closed || !e.points || e.locked) continue
    const pieces = subtractPolygon(e.points, cut)
    if (!pieces) continue
    reshape(e, pieces.map(bridgeHoles))
    const wall =
      toolId === "build"
        ? ctx.entities.find(
            (w) =>
              w.toolId === "wall" &&
              w.closed &&
              ((!!e.link && w.link === e.link) || sameOutline(w.points ?? [], e.points ?? [])),
          )
        : undefined
    if (wall)
      reshape(
        wall,
        pieces.flatMap((p) => [p.outer, ...p.holes]),
      )
  }
  if (patches.size === 0 && removed.length === 0) return
  beginGesture()
  updateEntities(patches)
  if (added.length) addEntities(added)
  if (removed.length) removeEntities(removed)
  endGesture()
}

/** A shape commit that adds `entities`, or with Alt (invert) cuts the shape out of `toolId`. */
const addOrSubtract =
  (toolId: string, entities: (ctx: ToolCtx, polygon: Vec2[]) => MapEntity[]) =>
  (ctx: ToolCtx, polygon: Vec2[]) => {
    if (isHeld("invert")) subtractShape(ctx, toolId, polygon)
    else addEntities(entities(ctx, polygon))
  }

/**
 * Build: a room — a floor polygon plus the wall around it, in one undo step
 * (with Alt, the shape is cut out of the rooms instead).
 */
export function createBuildBehavior(): ToolBehavior {
  return withEditPoints(shapeController(addOrSubtract("build", buildEntities), buildEntities), [
    "build",
    "wall",
  ])
}

const patternEntities = (ctx: ToolCtx, polygon: Vec2[]) => [
  makeEntity(ctx, {
    layer: paramNum(ctx.params.layer, 100),
    points: polygon,
    closed: true,
    position: polygon[0],
    params: {
      pattern: selection(ctx.params.pattern),
      customColor: ctx.params.customColor,
      rotation: paramNum(ctx.params.rotation, 0),
      outline: ctx.params.outline === true,
      shadow: ctx.params.shadow !== false,
    },
  }),
]

/** Pattern: a polygon filled with a tiling texture, tinted by Color (Alt cuts the shape out). */
export function createPatternBehavior(): ToolBehavior {
  return withEditPoints(
    shapeController(addOrSubtract("pattern", patternEntities), patternEntities),
    ["pattern"],
  )
}

const pathEntities = (ctx: ToolCtx, points: Vec2[]) => [
  makeEntity(ctx, {
    layer: paramNum(ctx.params.layer, 100),
    points,
    position: points[0],
    params: {
      asset: ctx.libraryAssets[0] ?? "",
      width: paramNum(ctx.params.width, 1),
      smoothness: paramNum(ctx.params.smoothness, 1),
      blockLight: ctx.params.blockLight === true,
      transitionIn: ctx.params.transitionIn,
      transitionOut: ctx.params.transitionOut,
      shadow: ctx.params.shadow !== false,
    },
  }),
]

/** Path: click out a textured path using the asset picked in the Library. */
export function createPathBehavior(): ToolBehavior {
  return withEditPoints(
    polylineController({
      minPoints: 2,
      closed: false,
      step: 0.5,
      preview: pathEntities,
      commit: (ctx, points) => addEntities(pathEntities(ctx, points), under(ctx)),
    }),
    ["path"],
  )
}

function roofEntity(ctx: ToolCtx, polygon: Vec2[]): MapEntity {
  return makeEntity(ctx, {
    layer: LAYER.roof,
    points: polygon,
    closed: true,
    position: polygon[0],
    params: {
      style: selection(ctx.params.style),
      type: ctx.params.type,
      shade: ctx.params.shade !== false,
      sunDirection: paramNum(ctx.params.sunDirection, 45),
      shadeContrast: paramNum(ctx.params.shadeContrast, 0.3),
      shadow: ctx.params.shadow !== false,
    },
  })
}

/** Roof: Quickbox drags a rectangle; Manual clicks out the outline. */
export function createRoofBehavior(): ToolBehavior {
  const preview = (ctx: ToolCtx, polygon: Vec2[]) => [roofEntity(ctx, polygon)]
  const commit = (ctx: ToolCtx, polygon: Vec2[]) => addEntities(preview(ctx, polygon), under(ctx))
  const quick = shapeController(commit, preview)
  const manual = polylineController({ minPoints: 3, closed: true, commit, preview })
  const pick = (ctx: ToolCtx): ToolBehavior => (ctx.params.mode === "manual" ? manual : quick)
  return {
    onPointerDown: (ctx, e) => pick(ctx).onPointerDown?.(ctx, e),
    onPointerMove: (ctx, e) => pick(ctx).onPointerMove?.(ctx, e),
    onPointerUp: (ctx, e) => pick(ctx).onPointerUp?.(ctx, e),
    onDoubleClick: (ctx, e) => pick(ctx).onDoubleClick?.(ctx, e),
    onKeyDown: (ctx, e) => pick(ctx).onKeyDown?.(ctx, e) ?? false,
    onWheel: (ctx, e) => pick(ctx).onWheel?.(ctx, e) ?? false,
    onDeactivate: (ctx) => {
      quick.onDeactivate(ctx)
      manual.onDeactivate(ctx)
    },
    cursor: () => "crosshair",
  }
}

/** Screen angle (degrees) of a map-space direction — map x is mirrored. */
export function screenAngle(d: Vec2): number {
  return (Math.atan2(d.y, -d.x) * 180) / Math.PI
}

/** Nearest wall segment to `p` on the level, within `maxDist` tiles. */
export function nearestWall(
  entities: readonly MapEntity[],
  p: Vec2,
  maxDist: number,
): { point: Vec2; angle: number } | null {
  let best: { point: Vec2; angle: number; d: number } | null = null
  for (const e of entities) {
    if (e.toolId !== "wall" || !e.points) continue
    for (const [a, b] of segmentsOf(e.points, e.closed)) {
      const { point } = closestOnSegment(p, a, b)
      const d = dist(p, point)
      if (d <= maxDist && (!best || d < best.d)) {
        best = { point, angle: screenAngle({ x: b.x - a.x, y: b.y - a.y }), d }
      }
    }
  }
  return best ? { point: best.point, angle: best.angle } : null
}

/** The portal the Portal tool would place at `p` (snapped onto a wall when anchored). */
export function portalAt(ctx: ToolCtx, p: Vec2): MapEntity | null {
  const asset = selection(ctx.params.style).assets[0]
  if (!asset) return null
  const anchored = ctx.params.anchored !== false
  let position = ctx.snap(p, 0.5)
  let rotation = paramNum(ctx.params.rotation, 0)
  if (anchored) {
    const wall = nearestWall(ctx.entities, p, 1)
    if (!wall) return null
    // Center doors on whole/half tiles along the wall when snapping.
    position = ctx.snapEnabled ? ctx.snap(wall.point, 0.5) : wall.point
    const onWall = nearestWall(ctx.entities, position, 0.01)
    if (!onWall) position = wall.point
    rotation = wall.angle + (ctx.params.rotate180 === true ? 180 : 0)
  }
  return makeEntity(ctx, {
    toolId: "portal",
    layer: LAYER.portal,
    position,
    rotation,
    params: {
      asset,
      blockLight: ctx.params.blockLight === true,
      anchored,
      shadow: ctx.params.shadow !== false,
    },
  })
}

/** Portal: doors/windows. Anchored ones snap onto the nearest wall and align with it. */
export const portalBehavior: ToolBehavior = {
  onPointerMove: (ctx, e) => {
    const ghost = portalAt(ctx, e)
    useEditorStore.getState().setDraft(ghost ? [{ kind: "ghost", entity: ghost }] : [])
  },
  onPointerDown: (ctx, e) => {
    // Freestanding portals: right-click turns 90° (−90° with Shift).
    if (e.button === 2 && ctx.params.anchored === false) {
      const r = paramNum(ctx.params.rotation, 0) + (e.shiftKey ? -90 : 90)
      useToolsStore.getState().setToolParams(ctx.toolId, { rotation: normalizeDegrees(r) })
      portalBehavior.onPointerMove?.(ctx, e)
      return
    }
    if (e.button !== 0) return
    const portal = portalAt(ctx, e)
    if (portal) addEntities([portal])
  },
  // Freestanding portals: wheel turns ±5° (±15° with Shift).
  onWheel: (ctx, e) => {
    if (ctx.params.anchored !== false) return false
    const r = paramNum(ctx.params.rotation, 0) + e.dir * (e.shiftKey ? 15 : 5)
    useToolsStore.getState().setToolParams(ctx.toolId, { rotation: normalizeDegrees(r) })
    portalBehavior.onPointerMove?.(ctx, e)
    return true
  },
  onDeactivate: () => useEditorStore.getState().setDraft([]),
  cursor: () => "crosshair",
}
