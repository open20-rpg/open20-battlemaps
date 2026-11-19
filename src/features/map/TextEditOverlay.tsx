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

/** The editor while nothing is being edited: a hidden 1 px input. */
const HIDDEN = {
  input: { left: "0", top: "0", w: "1px", h: "1px", opacity: 0, pointerEvents: "none" },
  box: null,
} as const

/**
 * Where and how the editor shows over the label (its corner at `corner`,
 * screen px) at `k` screen px per font px: the box drawn behind, and a
 * transparent input over all that's drawn — the box and the text, which a
 * negative padding lets stick out of it — with the text where the label has it.
 */
function editorLook(
  edit: TextEditState | null,
  style: TextStyle,
  corner: { x: number; y: number } | null,
  k: number,
) {
  if (!edit || !corner) return HIDDEN
  const frame = frameOf(style)
  const m = measureText(style.font, style.size, edit.value)
  const box = layoutTextBox(m, frame)
  const area = box.bounds
  const textTop = box.baseline - m.ascent - area.y
  const lineH = m.ascent + m.descent
  // At least room for a few letters while it's empty.
  const w = Math.max(area.w, box.textX - area.x + style.size * 3)
  return {
    input: {
      left: `${corner.x + area.x * k}px`,
      top: `${corner.y + area.y * k}px`,
      w: `${w * k}px`,
      h: `${area.h * k}px`,
      pl: `${(box.textX - area.x) * k}px`,
      // A line as tall as the font's, where the label has it.
      pt: `${textTop * k}px`,
      pb: `${Math.max(0, area.h - textTop - lineH) * k}px`,
      boxShadow: style.box ? undefined : "0 0 0 1px var(--chakra-colors-brand-fg)",
      style: {
        font: cssFont(style.font, style.size * k),
        lineHeight: `${lineH * k}px`,
        color: style.color,
      },
    },
    box: style.box
      ? {
          left: `${corner.x}px`,
          top: `${corner.y}px`,
          w: `${box.w * k}px`,
          h: `${box.h * k}px`,
          borderWidth: `${frame.border * k}px`,
          borderRadius: `${boxRadius(style, box) * k}px`,
          style: { background: style.background, borderColor: style.borderColor },
        }
      : null,
  }
}

/**
 * The inline editor the Text tool opens over the canvas: a one-line input
 * standing where the label is drawn (the label hides meanwhile), in its font,
 * color and size at the current zoom, over its box. Enter or clicking away
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
    <>
      {look.box && (
        <chakra.div
          position="absolute"
          zIndex="overlay"
          borderStyle="solid"
          pointerEvents="none"
          {...look.box}
        />
      )}
      <chakra.input
        ref={ref}
        aria-hidden={edit ? undefined : true}
        tabIndex={edit ? 0 : -1}
        position="absolute"
        p="0"
        m="0"
        zIndex="overlay"
        outline="none"
        border="0"
        bg="transparent"
        {...look.input}
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
    </>
  )
}
