import { useEffect, useState, type RefObject } from "react"
import { Textarea } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useEditorStore } from "../../stores/editorStore"
import { useMapStore } from "../../stores/mapStore"
import { useViewStore } from "../../stores/viewStore"
import { cancelTextEdit, commitTextEdit } from "../tools/behaviors/text"
import { mapToScreen } from "./render/viewport"

/**
 * The inline editor the Text tool opens over the canvas. Enter commits
 * (Shift+Enter adds a line), Escape cancels, clicking away commits. It's
 * editor chrome positioned over the map — the text itself is a document
 * entity drawn by the canvas.
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
  const p = mapToScreen(edit.position, size.w, size.h, map.width, map.height, zoom, {
    x: panX,
    y: panY,
  })

  return (
    <Textarea
      autoFocus
      position="absolute"
      left={`${p.x}px`}
      top={`${p.y}px`}
      transform="translate(-50%, -50%)"
      w="240px"
      rows={2}
      size="sm"
      bg="panel.solid"
      borderColor="brand.fg"
      zIndex="overlay"
      placeholder={t("tools.textPlaceholder")}
      value={edit.value}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setTextEdit({ ...edit, value: e.currentTarget.value })}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          commitTextEdit()
        } else if (e.key === "Escape") cancelTextEdit()
      }}
      onBlur={commitTextEdit}
    />
  )
}
