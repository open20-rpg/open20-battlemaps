import { useEffect, useState, type RefObject } from "react"
import { chakra } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useEditorStore } from "../../stores/editorStore"
import { useMapStore } from "../../stores/mapStore"
import { useViewStore } from "../../stores/viewStore"
import { getToolParams } from "../../stores/toolsStore"
import { cancelTextEdit, commitTextEdit } from "../tools/behaviors/text"
import { cssFont } from "../fonts/catalog"
import { borderOf, FONT_PX_PER_TILE, layoutTextBox, measureText, textStyle } from "../fonts/metrics"
import { mapToScreen, tileSizeForZoom } from "./render/viewport"

/**
 * The inline editor the Text tool opens over the canvas: a one-line input
 * standing where the label is drawn (the label hides meanwhile), in its font,
 * color and size at the current zoom, inside its box. Enter or clicking away
 * commits (an empty label is deleted), Escape cancels.
 */
export function TextEditOverlay({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation()
  const edit = useEditorStore((s) => s.textEdit)
  const setTextEdit = useEditorStore((s) => s.setTextEdit)
  const map = useMapStore((s) => s.map)
  const zoom = useViewStore((s) => s.zoom)
  const panX = useViewStore((s) => s.panX)
  const panY = useViewStore((s) => s.panY)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  if (!edit || !map) return null
  const entity = edit.entityId ? map.entities.find((e) => e.id === edit.entityId) : undefined
  const style = textStyle(entity?.params ?? getToolParams("text"))
  // Screen px per font px.
  const k = tileSizeForZoom(zoom) / FONT_PX_PER_TILE
  const box = layoutTextBox(measureText(style.font, style.size, edit.value), borderOf(style))
  const corner = mapToScreen(edit.position, size.w, size.h, map.width, map.height, zoom, {
    x: panX,
    y: panY,
  })
  const boxed = style.box !== "none"
  const bw = borderOf(style) * k

  return (
    <chakra.input
      autoFocus
      position="absolute"
      left={`${corner.x}px`}
      top={`${corner.y}px`}
      // At least room for a few letters while it's empty.
      w={`${Math.max(box.w, style.size * 3) * k}px`}
      h={`${box.h * k}px`}
      p="0"
      // The text's inset from the box edge, less the border drawn before it.
      pl={`${(box.textX - borderOf(style)) * k}px`}
      m="0"
      zIndex="overlay"
      outline="none"
      borderStyle="solid"
      borderWidth={boxed ? `${bw}px` : "0"}
      borderRadius={style.box === "pill" ? `${(Math.min(box.w, box.h) / 2) * k}px` : "0"}
      boxShadow={boxed ? undefined : "0 0 0 1px var(--chakra-colors-brand-fg)"}
      style={{
        font: cssFont(style.font, style.size * k),
        lineHeight: `${(box.h - 2 * borderOf(style)) * k}px`,
        color: style.color,
        background: boxed ? style.background : "transparent",
        borderColor: style.borderColor,
      }}
      placeholder={t("tools.textPlaceholder")}
      value={edit.value}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setTextEdit({ ...edit, value: e.currentTarget.value })}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault()
          commitTextEdit()
        } else if (e.key === "Escape") cancelTextEdit()
      }}
      onBlur={commitTextEdit}
    />
  )
}
