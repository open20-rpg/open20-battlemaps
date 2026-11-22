import { createElement, type ComponentType } from "react"
import { type IconType } from "react-icons"
import {
  LuBlocks,
  LuBrush,
  LuCircle,
  LuCompass,
  LuDices,
  LuDoorOpen,
  LuEye,
  LuFlame,
  LuGrid3X3,
  LuHexagon,
  LuMap,
  LuMapPin,
  LuMountain,
  LuPalette,
  LuPencil,
  LuRuler,
  LuShapes,
  LuSparkles,
  LuSquare,
  LuStamp,
  LuStar,
  LuSwords,
  LuTrees,
  LuWand,
} from "react-icons/lu"
import { sanitizeSvg } from "./svg"

/** Core icons an extension can name instead of shipping an SVG. */
const NAMED_ICONS: Record<string, IconType> = {
  LuBlocks,
  LuBrush,
  LuCircle,
  LuCompass,
  LuDices,
  LuDoorOpen,
  LuEye,
  LuFlame,
  LuGrid3X3,
  LuHexagon,
  LuMap,
  LuMapPin,
  LuMountain,
  LuPalette,
  LuPencil,
  LuRuler,
  LuShapes,
  LuSparkles,
  LuSquare,
  LuStamp,
  LuStar,
  LuSwords,
  LuTrees,
  LuWand,
}

const iconCache = new Map<string, IconType>()

/**
 * An icon from a core name or the extension's SVG. The SVG is sanitized and
 * drawn as a CSS mask (never as markup in the page): it can't run anything,
 * and takes the text color like the app's own icons.
 */
export function extensionIcon(icon: string): IconType {
  const named = NAMED_ICONS[icon]
  if (named) return named
  const cached = iconCache.get(icon)
  if (cached) return cached
  const svg = sanitizeSvg(icon)
  if (!svg) return LuBlocks
  const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
  const Comp: ComponentType<{ size?: string | number }> = ({ size = "1em" }) =>
    createElement("span", {
      "aria-hidden": true,
      style: {
        display: "inline-block",
        width: size,
        height: size,
        background: "currentColor",
        WebkitMask: `${url} center / contain no-repeat`,
        mask: `${url} center / contain no-repeat`,
      },
    })
  iconCache.set(icon, Comp as IconType)
  return Comp as IconType
}
