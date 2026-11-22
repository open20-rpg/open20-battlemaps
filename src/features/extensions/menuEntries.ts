import { type IconType } from "react-icons"
import {
  LuChartBar,
  LuCommand,
  LuDices,
  LuDownload,
  LuEye,
  LuGraduationCap,
  LuMap,
  LuMousePointerClick,
  LuPanelRight,
  LuSettings2,
  LuUpload,
  LuWand,
} from "react-icons/lu"
import { localize, type Contribution, type LocalizedText } from "@open20/battlemaps-sdk"
import { scopedKey, useExtensionsStore, type LiveContribution } from "../../stores/extensionsStore"
import { createMap } from "../map/commands"
import { runCommand, runContextItem, runImport, runSelectionMode } from "./actions"
import { extensionIcon } from "./icons"

type Of<T extends Contribution["type"]> = LiveContribution<Extract<Contribution, { type: T }>>

/** A dialog the menu opens (forms need the user before running). */
export type MenuDialog =
  | { kind: "generator"; c: Of<"generator">; newMap?: { width: number; height: number } }
  | { kind: "export"; c: Of<"exportFormat"> }
  | { kind: "stats" }

export interface MenuEntry {
  key: string
  icon: IconType
  label: string
  shortcut?: string
  disabled?: boolean
  run: () => void
}

interface Deps {
  contributions: readonly LiveContribution[]
  lang: string
  hasMap: boolean
  t: (key: string, vars?: Record<string, string>) => string
  onManage: () => void
  onPalette: () => void
  openDialog: (d: MenuDialog) => void
}

/**
 * The Extensions menu as data: sections of entries (separated in the UI),
 * from what the extensions contribute. Kept out of the component so the
 * menu stays a plain list render.
 */
export function menuSections(d: Deps): MenuEntry[][] {
  const of = <T extends Contribution["type"]>(type: T) =>
    d.contributions.filter((c) => c.contribution.type === type) as Of<T>[]
  const text = (v: LocalizedText) => localize(v, d.lang)
  const openPanel = (extId: string, id: string) =>
    useExtensionsStore.getState().setPanel(scopedKey(extId, id), { open: true })
  const noMap = !d.hasMap
  const generators = of("generator")

  return [
    [
      { key: "manage", icon: LuSettings2, label: d.t("extensions.manage"), run: d.onManage },
      {
        key: "palette",
        icon: LuCommand,
        label: d.t("extensions.palette"),
        shortcut: "Ctrl+Shift+P",
        run: d.onPalette,
      },
    ],
    of("command")
      .filter((c) => (c.contribution.menu ?? "extensions") === "extensions")
      .map((c) => ({
        key: c.key,
        icon: c.contribution.icon ? extensionIcon(c.contribution.icon) : LuWand,
        label: text(c.contribution.title),
        shortcut: c.contribution.shortcut,
        run: () => void runCommand(c),
      })),
    [...of("panel"), ...of("iframePanel")].map((c) => ({
      key: c.key,
      icon: LuPanelRight,
      label: text(c.contribution.title),
      run: () => openPanel(c.extId, c.contribution.id),
    })),
    [
      ...generators
        .filter((g) => g.contribution.scope.some((s) => s !== "newMap"))
        .map((g) => ({
          key: g.key,
          icon: LuDices,
          label: d.t("extensions.generate", { name: text(g.contribution.name) }),
          disabled: noMap,
          run: () => d.openDialog({ kind: "generator", c: g }),
        })),
      ...of("newMapPreset").map((p) => {
        const gen = generators.find(
          (g) => g.extId === p.extId && g.contribution.id === p.contribution.generator,
        )
        const size = { width: p.contribution.width, height: p.contribution.height }
        return {
          key: p.key,
          icon: LuMap,
          label: d.t("extensions.newMapWith", { name: text(p.contribution.name) }),
          run: () =>
            gen
              ? d.openDialog({ kind: "generator", c: gen, newMap: size })
              : createMap(size.width, size.height),
        }
      }),
    ],
    [
      ...of("importFormat").map((f) => ({
        key: f.key,
        icon: LuDownload,
        label: d.t("extensions.importWith", { name: text(f.contribution.name) }),
        run: () => void runImport(f),
      })),
      ...of("exportFormat").map((f) => ({
        key: f.key,
        icon: LuUpload,
        label: d.t("extensions.exportAs", { name: text(f.contribution.name) }),
        disabled: noMap,
        run: () => d.openDialog({ kind: "export", c: f }),
      })),
    ],
    [
      ...of("contextMenu").map((c) => ({
        key: c.key,
        icon: LuMousePointerClick,
        label: text(c.contribution.title),
        disabled: noMap,
        run: () => void runContextItem(c),
      })),
      ...of("selectionMode").map((c) => ({
        key: c.key,
        icon: LuMousePointerClick,
        label: d.t("extensions.selectWith", { name: text(c.contribution.name) }),
        disabled: noMap,
        run: () => void runSelectionMode(c),
      })),
    ],
    [
      ...(of("stats").length
        ? [
            {
              key: "stats",
              icon: LuChartBar,
              label: d.t("extensions.statsTitle"),
              disabled: noMap,
              run: () => d.openDialog({ kind: "stats" }),
            },
          ]
        : []),
      ...of("tour").map((c) => ({
        key: c.key,
        icon: LuGraduationCap,
        label: text(c.contribution.title),
        run: () => useExtensionsStore.getState().setTour({ key: c.key, step: 0 }),
      })),
      ...of("view").map((c) => ({
        key: c.key,
        icon: LuEye,
        label: text(c.contribution.title),
        disabled: noMap,
        run: () => openPanel(c.extId, `view:${c.contribution.id}`),
      })),
    ],
  ].filter((section) => section.length > 0)
}
