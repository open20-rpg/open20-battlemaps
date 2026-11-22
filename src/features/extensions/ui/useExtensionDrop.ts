import { useEffect, type RefObject } from "react"
import { useMapStore } from "../../../stores/mapStore"
import { useViewStore } from "../../../stores/viewStore"
import { screenToMap } from "../../map/render/viewport"
import { dropFile } from "../actions"

/** Most bytes of a dropped file handed to an extension. */
const DROP_MAX_BYTES = 50 * 1024 * 1024

/**
 * Files dropped on the map go to the extension that handles their type
 * (`fileHandler.drop`), with the map point they were dropped on.
 */
export function useExtensionDrop(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])]
      const map = useMapStore.getState().map
      if (!files.length || !map) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const { zoom, panX, panY } = useViewStore.getState()
      const at = screenToMap(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        rect.width,
        rect.height,
        map.width,
        map.height,
        zoom,
        { x: panX, y: panY },
      )
      for (const f of files) {
        if (f.size > DROP_MAX_BYTES) continue
        void f
          .arrayBuffer()
          .then((buf) => dropFile({ name: f.name, bytes: new Uint8Array(buf), mime: f.type }, at))
      }
    }
    el.addEventListener("dragover", onOver)
    el.addEventListener("drop", onDrop)
    return () => {
      el.removeEventListener("dragover", onOver)
      el.removeEventListener("drop", onDrop)
    }
  }, [ref])
}
