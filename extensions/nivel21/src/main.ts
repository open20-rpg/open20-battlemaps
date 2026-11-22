import {
  defineExtension,
  type Entity,
  type ExtensionContext,
  type FileData,
} from "@open20/battlemaps-sdk"
import {
  assetLabel,
  imageKey,
  imageSize,
  mapWalls,
  N21_FORMAT,
  N21_VERSION,
  portalKind,
  rotatedSize,
  tilesOf,
  toBase64,
  toImageSpace,
  type N21Map,
  type PortalCut,
} from "./n21map"

/** What becomes a token: placed objects (scattered ones too). */
const OBJECT_KINDS = new Set(["object", "scatter"])

/**
 * The object's image as drawn on the map (turned and mirrored), so Nivel20
 * shows it right without knowing about rotation. Without OffscreenCanvas
 * (tests, old webviews) the image goes as is with its rotation.
 */
async function bake(
  file: FileData,
  rotation: number,
  flipX: boolean,
  flipY: boolean,
): Promise<{ bytes: Uint8Array; mime: string; baked: boolean }> {
  const mime = file.mime ?? "image/png"
  if (
    (!rotation && !flipX && !flipY) ||
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined"
  )
    return { bytes: file.bytes, mime, baked: !rotation }
  const bitmap = await createImageBitmap(new Blob([file.bytes as BlobPart], { type: mime }))
  const size = rotatedSize(bitmap.width, bitmap.height, rotation)
  const canvas = new OffscreenCanvas(Math.ceil(size.w), Math.ceil(size.h))
  const g = canvas.getContext("2d")
  if (!g) return { bytes: file.bytes, mime, baked: false }
  g.translate(canvas.width / 2, canvas.height / 2)
  g.rotate((rotation * Math.PI) / 180)
  g.scale(flipX ? -1 : 1, flipY ? -1 : 1)
  g.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: "image/png", baked: true }
}

/** The open map (its active level) as an N21 map. */
export async function exportN21(
  ctx: ExtensionContext,
  pxPerCell: number,
  name: string,
): Promise<N21Map> {
  const map = await ctx.map.get()
  if (!map) throw new Error("No hay un mapa abierto")
  const entities = await ctx.map.query({ level: "active" })
  const objects = entities.filter((e) => OBJECT_KINDS.has(e.kind) && e.asset)
  const portals = entities.filter((e) => e.kind === "portal")
  const walls = entities.filter((e) => e.kind === "wall")

  // Each asset's image once (objects and portals: their size is their image's).
  const assets = [...new Set([...objects, ...portals].flatMap((e) => (e.asset ? [e.asset] : [])))]
  const files = new Map<string, FileData | null>()
  await Promise.all(
    assets.map(async (id) => files.set(id, await ctx.library.image(id).catch(() => null))),
  )
  const sizeOf = (e: Entity) => {
    const file = e.asset ? files.get(e.asset) : null
    return tilesOf(file ? imageSize(file.bytes) : null, e.scale)
  }

  const cuts: PortalCut[] = portals.map((p) => ({
    position: p.position,
    width: sizeOf(p).w,
    kind: portalKind(p.asset),
  }))
  // The background: everything but the objects (they become tokens).
  const background = await ctx.render.toImage({
    format: "png",
    pxPerTile: pxPerCell,
    hide: [{ kinds: ["object", "scatter"] }],
  })
  const bgPx = imageSize(background.bytes) ?? {
    width: map.width * pxPerCell,
    height: map.height * pxPerCell,
  }

  const images: N21Map["images"] = {}
  const baked = new Map<string, Promise<{ baked: boolean }>>()
  const tokens = await Promise.all(
    objects.map(async (e) => {
      const asset = e.asset!
      const key = imageKey(asset, e.rotation, e.flipX, e.flipY)
      const file = files.get(asset)
      if (file && !baked.has(key))
        baked.set(
          key,
          bake(file, e.rotation, e.flipX, e.flipY).then((b) => {
            images[key] = { name: assetLabel(asset), mime: b.mime, data: toBase64(b.bytes) }
            return b
          }),
        )
      const done = await (baked.get(key) ?? Promise.resolve({ baked: false }))
      const size = sizeOf(e)
      const box = done.baked ? rotatedSize(size.w, size.h, e.rotation) : size
      const at = toImageSpace(e.position, map.width)
      return {
        image: key,
        name: assetLabel(asset),
        x: at.x,
        y: at.y,
        width: box.w,
        height: box.h,
        rotation: done.baked ? 0 : e.rotation,
      }
    }),
  )
  return {
    format: N21_FORMAT,
    version: N21_VERSION,
    name: name.trim() || "Mapa de Battle Maps",
    grid: {
      width: map.width,
      height: map.height,
      pxPerCell,
      cellDistance: map.grid.cellDistance,
      unit: map.grid.unit,
    },
    background: {
      mime: "image/png",
      data: toBase64(background.bytes),
      width: bgPx.width,
      height: bgPx.height,
    },
    images,
    // Objects without an image (a pack that isn't installed) can't be tokens.
    tokens: tokens.filter((t) => images[t.image]),
    walls: mapWalls(walls, cuts, map.width),
  }
}

export default defineExtension({
  async activate(ctx) {
    await ctx.files.exportFormat({
      id: "n21map",
      name: { es: "Nivel20 (con Nivel21)", en: "Nivel20 (with Nivel21)" },
      extension: "n21map",
      options: [
        {
          kind: "text",
          key: "name",
          label: { es: "Nombre de la escena", en: "Scene name" },
          default: "",
          maxLength: 80,
        },
        {
          kind: "slider",
          key: "pxPerCell",
          label: { es: "Píxeles por casilla del fondo", en: "Background pixels per cell" },
          default: 100,
          min: 50,
          max: 200,
          step: 10,
        },
      ],
      export: async ({ options }) => {
        const n21 = await ctx.ui.withProgress("Exportando para Nivel20", async (report) => {
          report(null, "Fondo, tokens y muros")
          return exportN21(ctx, Number(options.pxPerCell ?? 100), String(options.name ?? ""))
        })
        const skipped =
          (await ctx.map.query({ level: "active" })).filter((e) => OBJECT_KINDS.has(e.kind))
            .length - n21.tokens.length
        if (skipped > 0)
          await ctx.ui.notify({
            message: `${skipped} objetos sin imagen no se exportaron como tokens`,
            tone: "warning",
          })
        const file = n21.name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "mapa"
        return {
          name: `${file}.n21map`,
          bytes: new TextEncoder().encode(JSON.stringify(n21)),
          mime: "application/json",
        }
      },
    })
  },
})
