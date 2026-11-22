import { useEffect, useEffectEvent } from "react"
import { type Contribution } from "@open20/battlemaps-sdk"
import { useExtensionsStore, type LiveContribution } from "../../stores/extensionsStore"
import { useModalStackStore } from "../../stores/modalStackStore"
import { useSettingsStore } from "../../stores/settingsStore"
import { matchesBinding } from "../../lib/keybindings"
import { typingIn } from "../../lib/dom"
import { runCommand } from "./actions"

export type Command = LiveContribution<Extract<Contribution, { type: "command" }>>

/** The action id an extension command's binding is saved under (with the app's shortcuts). */
export const commandActionId = (c: Command): string => `ext:${c.key}`

/** A command's key combos: the user's, else the one it declares. */
export function commandBindings(c: Command, overrides: Record<string, string[]>): string[] {
  return overrides[commandActionId(c)] ?? (c.contribution.shortcut ? [c.contribution.shortcut] : [])
}

/** Extensions' command shortcuts (and Ctrl+Shift+P for the palette), app-wide. */
export function useExtensionShortcuts(openPalette: () => void): void {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (typingIn(e.target) || useModalStackStore.getState().stack.length > 0) return
    if (matchesBinding(e, "Ctrl+Shift+P")) {
      e.preventDefault()
      openPalette()
      return
    }
    const overrides = useSettingsStore.getState().shortcutOverrides
    const commands = useExtensionsStore
      .getState()
      .contributions.filter((c): c is Command => c.contribution.type === "command")
    const hit = commands.find((c) =>
      commandBindings(c, overrides).some((b) => matchesBinding(e, b)),
    )
    if (hit) {
      e.preventDefault()
      void runCommand(hit)
    }
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])
}
