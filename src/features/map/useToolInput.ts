import { useEffect, type RefObject } from "react"
import { useEditorStore } from "../../stores/editorStore"
import { useModalStackStore } from "../../stores/modalStackStore"
import { useMapStore } from "../../stores/mapStore"
import { selectActiveTool, useToolsStore } from "../../stores/toolsStore"
import { useViewStore } from "../../stores/viewStore"
import { buildToolCtx } from "../tools/behaviors/context"
import { getToolBehavior } from "../tools/behaviors"
import { type PointerInfo } from "../tools/behaviors/types"
import { nudgeBrush, runShortcut } from "./shortcuts"

/** Wheel delta (px) that counts as one notch. */
const WHEEL_NOTCH = 40
import { typingIn } from "../../lib/dom"
import { isHeld } from "../shortcuts/held"
import { screenToMap } from "./render/viewport"

/**
 * Feeds the canvas' pointer events (left/right button; middle is panning in
 * useViewportGestures) and keyboard to the active tool's behavior, in map
 * coordinates. Keys the tool doesn't handle fall through to the global editor
 * shortcuts (undo/redo, delete, copy/paste…). Also tells a tool when it's
 * being switched away from, so it can finish its draft.
 */
/** How long a touch press must stay still to act as a right-click, in ms. */
const LONG_PRESS_MS = 550
/** How far (screen px) a touch press may drift and still count as held still. */
const LONG_PRESS_SLOP_PX = 10

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
    /**
     * A touch press held still: after LONG_PRESS_MS it acts as a right-click
     * (for tools that ask, see ToolBehavior.longPressRightClick) — the left
     * press is released first.
     */
    let longPress: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null
    const cancelLongPress = () => {
      if (longPress) clearTimeout(longPress.timer)
      longPress = null
    }
    /** Where the pointer last hovered the map (null once it left). */
    let hover: PointerInfo | null = null
    /**
     * Re-run the tool's hover at the pointer's last place: after the wheel or
     * a key changes a param (brush size, rotation…), its cursor and preview
     * update at once instead of on the next move. Not mid-drag (a replayed
     * move would paint or drag).
     */
    const refreshHover = () => {
      if (!hover || pressedButton !== null || rulerFrom) return
      const a = active()
      a?.behavior.onPointerMove?.(a.ctx, hover)
    }
    /** Where a ruler measure started (ruler mode drags measure, not use the tool). */
    let rulerFrom: { x: number; y: number } | null = null

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return
      // A left drag while the pan key is held pans the view (useViewportGestures).
      if (e.button === 0 && isHeld("pan")) return
      if (e.pointerType === "touch" && !e.isPrimary) return
      const info = toMap(e, e.button)
      if (info && e.button === 0 && useEditorStore.getState().rulerOn) {
        rulerFrom = { x: info.x, y: info.y }
        useEditorStore.getState().setRuler({ from: rulerFrom, to: rulerFrom })
        el.setPointerCapture(e.pointerId)
        return
      }
      const a = active()
      if (!info || !a) return
      pressedButton = e.button
      el.setPointerCapture(e.pointerId)
      a.behavior.onPointerDown?.(a.ctx, info)
      if (e.pointerType === "touch" && e.button === 0 && a.behavior.longPressRightClick?.(a.ctx)) {
        cancelLongPress()
        const timer = setTimeout(() => {
          longPress = null
          if (pressedButton !== 0) return
          pressedButton = null
          const left = active()
          left?.behavior.onPointerUp?.(left.ctx, info)
          const right = active()
          if (!right) return
          const click = { ...info, button: 2, buttons: 2 }
          right.behavior.onPointerDown?.(right.ctx, click)
          right.behavior.onPointerUp?.(right.ctx, { ...click, buttons: 0 })
        }, LONG_PRESS_MS)
        longPress = { timer, x: e.clientX, y: e.clientY }
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (
        longPress &&
        Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > LONG_PRESS_SLOP_PX
      )
        cancelLongPress()
      const info = toMap(e, pressedButton ?? -1)
      if (!info) return
      useEditorStore.getState().setPointer({ x: info.x, y: info.y })
      hover = { ...info, buttons: 0 }
      if (rulerFrom) {
        useEditorStore.getState().setRuler({ from: rulerFrom, to: { x: info.x, y: info.y } })
        return
      }
      const a = active()
      if (!a) return
      // Only the button that started the gesture counts as "dragging".
      a.behavior.onPointerMove?.(a.ctx, pressedButton === null ? { ...info, buttons: 0 } : info)
    }
    const onPointerUp = (e: PointerEvent) => {
      cancelLongPress()
      if (rulerFrom) {
        rulerFrom = null
        return
      }
      if (pressedButton === null || e.button !== pressedButton) return
      const info = toMap(e, pressedButton)
      pressedButton = null
      const a = active()
      if (info && a) a.behavior.onPointerUp?.(a.ctx, info)
    }
    const onPointerLeave = () => {
      hover = null
      useEditorStore.getState().setPointer(null)
    }
    const onDoubleClick = (e: MouseEvent) => {
      const info = toMap(e, 0)
      const a = active()
      if (info && a) a.behavior.onDoubleClick?.(a.ctx, info)
    }
    // Wheel (no Ctrl: that zooms): the active tool's, else brush size. A
    // trackpad sends many small deltas; they add up to one notch per WHEEL_NOTCH.
    // Notches are applied once per frame: a fast scroll sends dozens of
    // events, and handling each (params, panel, cursor) would stall the UI.
    let wheelAcc = 0
    let wheelFrame = 0
    let wheelNotches: { dir: 1 | -1; horizontal: boolean; info: PointerInfo }[] = []
    const flushWheel = () => {
      wheelFrame = 0
      const notches = wheelNotches
      wheelNotches = []
      const a = active()
      if (!a || notches.length === 0) return
      let unhandled = 0
      for (const n of notches) {
        // Each notch sees the params the previous one left.
        const ctx = buildToolCtx(a.ctx.toolId) ?? a.ctx
        const handled = a.behavior.onWheel?.(ctx, {
          ...n.info,
          buttons: 0,
          dir: n.dir,
          horizontal: n.horizontal,
        })
        if (!handled) unhandled += n.dir
      }
      if (unhandled !== 0) nudgeBrush(unhandled)
      refreshHover()
    }
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return
      e.preventDefault()
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)
      const delta = (horizontal ? e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 40 : 1)
      wheelAcc += delta
      if (Math.abs(wheelAcc) < WHEEL_NOTCH) return
      const dir: 1 | -1 = wheelAcc < 0 ? 1 : -1
      wheelAcc = 0
      const info = toMap(e, -1)
      if (!info) return
      wheelNotches.push({ dir, horizontal, info })
      wheelFrame ||= requestAnimationFrame(flushWheel)
    }
    // Right-click is a tool action (finish a polyline, erase), not a menu.
    const onContextMenu = (e: MouseEvent) => e.preventDefault()

    const onKeyDown = (e: KeyboardEvent) => {
      // Dialogs own the keyboard while open (Escape, typing, recording shortcuts).
      if (typingIn(e.target) || useModalStackStore.getState().stack.length > 0) return
      const a = active()
      if (a?.behavior.onKeyDown?.(a.ctx, e)) {
        e.preventDefault()
        refreshHover()
        return
      }
      if (runShortcut(e)) {
        e.preventDefault()
        refreshHover()
      }
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
    el.addEventListener("wheel", onWheel, { passive: false })
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
      el.removeEventListener("wheel", onWheel)
      window.removeEventListener("keydown", onKeyDown)
      cancelAnimationFrame(wheelFrame)
      cancelLongPress()
    }
  }, [ref])
}
