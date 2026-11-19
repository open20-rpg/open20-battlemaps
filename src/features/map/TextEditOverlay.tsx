import { useEffect, useState, type RefObject } from "react"
import { chakra } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useEditorStore, type TextEditState } from "../../stores/editorStore"
import { useMapStore } from "../../stores/mapStore"
import { useViewStore } from "../../stores/viewStore"
import { getToolParams } from "../../stores/toolsStore"
import { cancelTextEdit, commitTextEdit, registerTextEditorInput } from "../tools/behaviors/text"
import { cssFont } from "../fonts/catalog"
import {
  boxRadius,
  frameOf,
  FONT_PX_PER_TILE,
  layoutTextBox,
  measureText,
  textStyle,
  type TextStyle,
} from "../fonts/metrics"
import { mapToScreen, tileSizeForZoom } from "./render/viewport"

/**
 * Where and how the editor shows: over the label (its corner at `corner`,
 * screen px), in its font, color and box at `k` screen px per font px —
 * or a hidden 1 px input while nothing is being edited.
 */
function editorLook(
  edit: TextEditState | null,
  style: TextStyle,
  corner: { x: number; y: number } | null,
  k: number,
) {
  if (!edit || !corner) {
    return { left: "0", top: "0", w: "1px", h: "1px", opacity: 0, pointerEvents: "none" } as const
  }
  const frame = frameOf(style)
  const bw = frame.border
  const m = measureText(style.font, style.size, edit.value)
  const box = layoutTextBox(m, frame)
  const boxed = style.box
  // CSS has no negative padding: the editor keeps the text inside its box.
  const top = Math.max(0, frame.top)
  const bottom = Math.max(0, frame.bottom)
  return {
    left: `${corner.x}px`,
    top: `${corner.y}px`,
    // At least room for a few letters while it's empty.
    w: `${Math.max(box.w, style.size * 3) * k}px`,
    h: `${box.h * k}px`,
    // The text's inset from the box edge, less the border drawn before it.
    pl: `${Math.max(0, box.textX - bw) * k}px`,
    pt: `${top * k}px`,
    pb: `${bottom * k}px`,
    borderWidth: boxed ? `${bw * k}px` : "0",
    borderRadius: `${boxRadius(style, box) * k}px`,
    boxShadow: boxed ? undefined : "0 0 0 1px var(--chakra-colors-brand-fg)",
    style: {
      font: cssFont(style.font, style.size * k),
      lineHeight: `${Math.max(1, box.h - 2 * bw - top - bottom) * k}px`,
      color: style.color,
      background: boxed ? style.background : "transparent",
      borderColor: style.borderColor,
    },
  }
}

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

  if (!map) return null
  // One input, kept mounted (hidden) while no label is being edited: the
  // Text tool focuses it within the tap that opens it, which is what brings
  // up the on-screen keyboard on phones and tablets.
  const ref = (input: HTMLInputElement | null) => {
    registerTextEditorInput(input)
    return () => registerTextEditorInput(null)
  }
  const entity = edit?.entityId ? map.entities.find((e) => e.id === edit.entityId) : undefined
  const look = editorLook(
    edit,
    textStyle(entity?.params ?? getToolParams("text")),
    edit
      ? mapToScreen(edit.position, size.w, size.h, map.width, map.height, zoom, {
          x: panX,
          y: panY,
        })
      : null,
    tileSizeForZoom(zoom) / FONT_PX_PER_TILE,
  )

  return (
    <chakra.input
      ref={ref}
      aria-hidden={edit ? undefined : true}
      tabIndex={edit ? 0 : -1}
      position="absolute"
      p="0"
      m="0"
      zIndex="overlay"
      outline="none"
      borderStyle="solid"
      {...look}
      placeholder={t("tools.textPlaceholder")}
      value={edit?.value ?? ""}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        if (edit) setTextEdit({ ...edit, value: e.currentTarget.value })
      }}
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
