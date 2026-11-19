import { useEffect, useRef, useState } from "react"
import { Box, Flex, Spinner, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { type AssetCategory } from "../../../lib/categories"
import { PX_PER_CELL, cellsOf, targetSize, type Adjust } from "../userAssets"

/** Categories shown repeated, as they're drawn on the map: floors tile both ways, strips along. */
const TILING: Partial<Record<AssetCategory, "both" | "x">> = {
  tilesets: "both",
  terrain: "both",
  materials: "both",
  walls: "x",
  paths: "x",
}

export interface PreviewImage {
  /** URL of the image to show (a small preview, or a pack texture). */
  url: string
  /** Size of the real image in px (the preview may be smaller). */
  width: number
  height: number
  /** Opaque content in real px (x, y, w, h), for trimming. */
  bounds?: readonly [number, number, number, number] | null
}

/**
 * An image as it will be on the map: on the grid (one square = one cell),
 * at its final size after the adjustments, repeated when its category
 * tiles. Drawn on a canvas from the small preview image (an effect paints
 * it — nothing per pixel lives in React).
 */
export function AssetPreview({
  image,
  adjust,
  category,
  loading = false,
}: {
  image: PreviewImage | null
  adjust: Adjust
  category: AssetCategory
  loading?: boolean
}) {
  const { t } = useTranslation()
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [img, setImg] = useState<{ url: string; el: HTMLImageElement } | null>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setBox({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const url = image?.url ?? null
  useEffect(() => {
    if (!url) return
    let alive = true
    const el = new Image()
    el.onload = () => {
      if (alive) setImg({ url, el })
    }
    el.src = url
    return () => {
      alive = false
    }
  }, [url])

  const final = image ? targetSize(image.width, image.height, adjust, image.bounds) : null
  const tiling = TILING[category]
  const fw = final?.w ?? 0
  const fh = final?.h ?? 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image || fw === 0 || img?.url !== image.url || box.w === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = box.w * dpr
    canvas.height = box.h * dpr
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, box.w, box.h)

    // Zoom so the asset fits with a margin (a repeated one shows ~2.5 times).
    const margin = 24
    const fitW = (box.w - margin * 2) / (tiling ? fw * 2.5 : fw)
    const fitH = (box.h - margin * 2) / (tiling === "both" ? fh * 2.5 : fh)
    const zoom = Math.max(0.02, Math.min(fitW, fitH, 4))
    const cell = PX_PER_CELL * zoom
    const w = fw * zoom
    const h = fh * zoom

    // The image with its adjustments, at display size, on its own canvas.
    const tile = document.createElement("canvas")
    tile.width = Math.max(1, Math.round(w))
    tile.height = Math.max(1, Math.round(h))
    const tctx = tile.getContext("2d")
    if (!tctx) return
    const k = img.el.naturalWidth / image.width
    const [sx, sy, sw, sh] =
      adjust.trim && image.bounds
        ? image.bounds.map((v) => v * k)
        : [0, 0, img.el.naturalWidth, img.el.naturalHeight]
    tctx.imageSmoothingQuality = "high"
    tctx.translate(tile.width / 2, tile.height / 2)
    tctx.rotate((adjust.rotate % 4) * (Math.PI / 2))
    tctx.scale(adjust.flipH ? -1 : 1, adjust.flipV ? -1 : 1)
    const [dw, dh] = adjust.rotate % 2 === 1 ? [tile.height, tile.width] : [tile.width, tile.height]
    tctx.drawImage(img.el, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh)

    const x0 = Math.round((box.w - w) / 2)
    const y0 = Math.round((box.h - h) / 2)
    if (tiling) {
      const pattern = ctx.createPattern(tile, tiling === "both" ? "repeat" : "repeat-x")
      if (pattern) {
        pattern.setTransform(new DOMMatrix().translate(x0, y0))
        ctx.fillStyle = pattern
        if (tiling === "both") ctx.fillRect(0, 0, box.w, box.h)
        else ctx.fillRect(0, y0, box.w, h)
      }
    } else {
      ctx.drawImage(tile, x0, y0)
    }

    // Grid lines, one per cell, anchored at the asset's corner.
    ctx.strokeStyle = "rgba(255,255,255,0.22)"
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = x0 % cell; x <= box.w; x += cell) {
      ctx.moveTo(Math.round(x) + 0.5, 0)
      ctx.lineTo(Math.round(x) + 0.5, box.h)
    }
    for (let y = y0 % cell; y <= box.h; y += cell) {
      ctx.moveTo(0, Math.round(y) + 0.5)
      ctx.lineTo(box.w, Math.round(y) + 0.5)
    }
    ctx.stroke()
    // The asset's own outline (one repetition when tiled).
    ctx.strokeStyle = "rgba(224,83,78,0.9)"
    ctx.setLineDash([5, 4])
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1)
  }, [image, fw, fh, img, box, adjust, tiling])

  return (
    <Flex direction="column" flex="1" minH="0" minW="0">
      <Box
        ref={boxRef}
        flex="1"
        minH="160px"
        position="relative"
        bg="black/40"
        backgroundImage="repeating-conic-gradient(rgba(255,255,255,0.05) 0 25%, transparent 0 50%)"
        backgroundSize="16px 16px"
        overflow="hidden"
      >
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          aria-label={t("userPacks.previewLabel")}
          role="img"
        />
        {(loading || (image && img?.url !== image.url)) && (
          <Flex position="absolute" inset="0" align="center" justify="center">
            <Spinner color="brand.fg" />
          </Flex>
        )}
      </Box>
      {final && (
        <Text fontSize="xs" color="fg.muted" px="3" py="1.5" textAlign="center">
          {t("userPacks.finalSize", {
            w: cellsOf(final.w),
            h: cellsOf(final.h),
            pw: final.w,
            ph: final.h,
          })}
        </Text>
      )}
    </Flex>
  )
}
