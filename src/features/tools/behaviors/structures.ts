import { useEditorStore } from "../../../stores/editorStore"
import { addEntities } from "../../map/commands"
import { closestOnSegment, dist, segmentsOf } from "../../map/model/geometry"
import { type MapEntity, type Vec2 } from "../../map/model/types"
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

/** Wall: click out a wall run (double-click/Enter/right-click to finish). */
export function createWallBehavior(): ToolBehavior {
  return withEditPoints(
    polylineController({
      minPoints: 2,
      closed: false,
      preview: wallEntities,
      commit: (ctx, points) => addEntities(wallEntities(ctx, points), under(ctx)),
    }),
    ["wall"],
  )
}

/** A room: the floor polygon plus the wall around it. */
const buildEntities = (ctx: ToolCtx, polygon: Vec2[]) => [
  makeEntity(ctx, {
    toolId: "build",
    layer: LAYER.floor,
    points: polygon,
    closed: true,
    position: polygon[0],
    params: {
      floor: selection(ctx.params.floor),
      bevelCorners: ctx.params.bevelCorners !== false,
    },
  }),
  wallEntity(ctx, polygon, true, selection(ctx.params.wall)),
]

/** Build: a room — a floor polygon plus the wall around it, in one undo step. */
export function createBuildBehavior(): ToolBehavior {
  return withEditPoints(
    shapeController((ctx, polygon) => addEntities(buildEntities(ctx, polygon)), buildEntities),
    ["build", "wall"],
  )
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
    },
  }),
]

/** Pattern: a polygon filled with a tiling texture, tinted by Color. */
export function createPatternBehavior(): ToolBehavior {
  return withEditPoints(
    shapeController((ctx, polygon) => addEntities(patternEntities(ctx, polygon)), patternEntities),
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
    params: { asset, blockLight: ctx.params.blockLight === true, anchored },
  })
}

/** Portal: doors/windows. Anchored ones snap onto the nearest wall and align with it. */
export const portalBehavior: ToolBehavior = {
  onPointerMove: (ctx, e) => {
    const ghost = portalAt(ctx, e)
    useEditorStore.getState().setDraft(ghost ? [{ kind: "ghost", entity: ghost }] : [])
  },
  onPointerDown: (ctx, e) => {
    if (e.button !== 0) return
    const portal = portalAt(ctx, e)
    if (portal) addEntities([portal])
  },
  onDeactivate: () => useEditorStore.getState().setDraft([]),
  cursor: () => "crosshair",
}
