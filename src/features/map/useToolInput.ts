import { useEffect, type RefObject } from "react"
import { useEditorStore } from "../../stores/editorStore"
import { useMapStore } from "../../stores/mapStore"
import { selectActiveTool, useToolsStore } from "../../stores/toolsStore"
import { useViewStore } from "../../stores/viewStore"
import { buildToolCtx } from "../tools/behaviors/context"
import { getToolBehavior } from "../tools/behaviors"
import { type PointerInfo } from "../tools/behaviors/types"
import { runShortcut } from "./shortcuts"
import { screenToMap } from "./render/viewport"

/** Whether keyboard input is aimed at a text field (shortcuts must not fire). */
function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
}

/**
 * Feeds the canvas' pointer events (left/right button; middle is panning in
 * useViewportGestures) and keyboard to the active tool's behavior, in map
 * coordinates. Keys the tool doesn't handle fall through to the global editor
 * shortcuts (undo/redo, delete, copy/paste…). Also tells a tool when it's
 * being switched away from, so it can finish its draft.
 */
export function useToolInput(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const toMap = (e: MouseEvent, button: number): PointerInfo | null => {
      const map = useMapStore.getState().map
      if (!map) return null
      const rect = el.getBoundingClientRect()
      const { zoom, panX, panY } = useViewStore.getState()
      const p = screenToMap(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        rect.width,
        rect.height,
        map.width,
        map.height,
        zoom,
        { x: panX, y: panY },
      )
      return {
        x: p.x,
        y: p.y,
        button,
        buttons: e.buttons,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey || e.metaKey,
      }
    }

    const active = () => {
      const tool = selectActiveTool(useToolsStore.getState())
      if (!tool) return null
      const behavior = getToolBehavior(tool.id)
      const ctx = buildToolCtx(tool.id)
      return behavior && ctx ? { behavior, ctx } : null
    }

    let pressedButton: number | null = null

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return
      if (e.pointerType === "touch" && !e.isPrimary) return
      const info = toMap(e, e.button)
      const a = active()
      if (!info || !a) return
      pressedButton = e.button
      el.setPointerCapture(e.pointerId)
      a.behavior.onPointerDown?.(a.ctx, info)
    }
    const onPointerMove = (e: PointerEvent) => {
      const info = toMap(e, pressedButton ?? -1)
      if (!info) return
      useEditorStore.getState().setPointer({ x: info.x, y: info.y })
      const a = active()
      if (!a) return
      // Only the button that started the gesture counts as "dragging".
      a.behavior.onPointerMove?.(a.ctx, pressedButton === null ? { ...info, buttons: 0 } : info)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (pressedButton === null || e.button !== pressedButton) return
      const info = toMap(e, pressedButton)
      pressedButton = null
      const a = active()
      if (info && a) a.behavior.onPointerUp?.(a.ctx, info)
    }
    const onPointerLeave = () => useEditorStore.getState().setPointer(null)
    const onDoubleClick = (e: MouseEvent) => {
      const info = toMap(e, 0)
      const a = active()
      if (info && a) a.behavior.onDoubleClick?.(a.ctx, info)
    }
    // Right-click is a tool action (finish a polyline, erase), not a menu.
    const onContextMenu = (e: MouseEvent) => e.preventDefault()

    const onKeyDown = (e: KeyboardEvent) => {
      if (typingIn(e.target)) return
      const a = active()
      if (a?.behavior.onKeyDown?.(a.ctx, e)) {
        e.preventDefault()
        return
      }
      if (runShortcut(e)) e.preventDefault()
    }

    // Let the previous tool wrap up when the selection changes.
    let previous = selectActiveTool(useToolsStore.getState())?.id ?? null
    const unsubTools = useToolsStore.subscribe((s) => {
      const id = selectActiveTool(s)?.id ?? null
      if (id === previous) return
      const ctx = previous ? buildToolCtx(previous) : null
      if (previous && ctx) getToolBehavior(previous)?.onDeactivate?.(ctx)
      useEditorStore.getState().setDraft([])
      previous = id
      const next = id ? buildToolCtx(id) : null
      if (id && next) getToolBehavior(id)?.onActivate?.(next)
    })

    el.addEventListener("pointerdown", onPointerDown)
    el.addEventListener("pointermove", onPointerMove)
    el.addEventListener("pointerup", onPointerUp)
    el.addEventListener("pointercancel", onPointerUp)
    el.addEventListener("pointerleave", onPointerLeave)
    el.addEventListener("dblclick", onDoubleClick)
    el.addEventListener("contextmenu", onContextMenu)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      unsubTools()
      el.removeEventListener("pointerdown", onPointerDown)
      el.removeEventListener("pointermove", onPointerMove)
      el.removeEventListener("pointerup", onPointerUp)
      el.removeEventListener("pointercancel", onPointerUp)
      el.removeEventListener("pointerleave", onPointerLeave)
      el.removeEventListener("dblclick", onDoubleClick)
      el.removeEventListener("contextmenu", onContextMenu)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [ref])
}
