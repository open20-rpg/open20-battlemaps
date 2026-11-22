import {
  Box,
  Button,
  Flex,
  Heading,
  Icon,
  Image,
  Progress,
  Separator,
  Stack,
  Text,
} from "@chakra-ui/react"
import { type UiNode } from "@open20/battlemaps-sdk"
import { extensionBridge } from "../../map/render/extensionRender"
import { extensionIcon } from "../icons"
import { ParamField } from "./ParamField"

/** Images an extension may show: its own assets or inline data images (never a remote URL). */
function imageSrc(src: string): string | null {
  if (/^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+/=]+$/.test(src)) return src
  if (src.startsWith("ext:")) return extensionBridge()?.imageUrl(src) ?? null
  return null
}

const call = (fn: unknown, ...args: unknown[]) => {
  if (typeof fn === "function") void Promise.resolve(fn(...args)).catch(() => {})
}

/**
 * An extension's declarative UI drawn with the app's components (theme,
 * accessibility and phone layout come for free). Events call back into the
 * extension; it answers by sending a new tree.
 */
export function UiNodeView({
  extId,
  node,
  depth = 0,
}: {
  extId: string
  node: UiNode
  depth?: number
}) {
  if (!node || depth > 20) return null
  switch (node.type) {
    case "column":
    case "row": {
      const children = (Array.isArray(node.children) ? node.children : []).slice(0, 200)
      const Dir = node.type === "row" ? Flex : Stack
      return (
        <Dir
          gap={node.gap ?? 2}
          wrap={node.type === "row" ? "wrap" : undefined}
          align={node.type === "row" ? "center" : "stretch"}
        >
          {children.map((c, i) => (
            <UiNodeView key={i} extId={extId} node={c} depth={depth + 1} />
          ))}
        </Dir>
      )
    }
    case "text":
      return (
        <Text
          fontSize={node.size ?? "sm"}
          color={node.tone === "muted" ? "fg.muted" : node.tone === "danger" ? "danger.fg" : "fg"}
        >
          {String(node.text).slice(0, 2000)}
        </Text>
      )
    case "heading":
      return <Heading size="sm">{String(node.text).slice(0, 200)}</Heading>
    case "markdown":
      return (
        <Stack gap="1.5">
          {String(node.text)
            .slice(0, 8000)
            .split(/\n{2,}/)
            .map((para, i) => (
              <Text key={i} fontSize="sm" whiteSpace="pre-wrap">
                {para.replace(/[*_`#]/g, "")}
              </Text>
            ))}
        </Stack>
      )
    case "button": {
      return (
        <Button
          size="xs"
          variant={node.variant ?? "outline"}
          colorPalette={node.variant === "solid" ? "brand" : undefined}
          disabled={node.disabled}
          onClick={() => call(node.onClick)}
        >
          {node.icon && <Icon as={extensionIcon(node.icon)} />}
          {String(node.label).slice(0, 80)}
        </Button>
      )
    }
    case "field":
      return (
        <Box mx="-3">
          <ParamField
            extId={extId}
            spec={node.spec}
            value={node.value}
            onChange={(v) => call(node.onChange, v)}
          />
        </Box>
      )
    case "list":
      return (
        <Stack gap="0.5" role="listbox">
          {(node.items ?? []).slice(0, 500).map((item) => {
            const selected = item.id === node.selected
            return (
              <Button
                key={item.id}
                role="option"
                aria-selected={selected}
                size="xs"
                variant={selected ? "subtle" : "ghost"}
                justifyContent="flex-start"
                onClick={() => call(node.onSelect, item.id)}
              >
                {item.icon && <Icon as={extensionIcon(item.icon)} />}
                <Text truncate>{item.label}</Text>
                {item.detail && (
                  <Text ms="auto" color="fg.muted" fontSize="xs">
                    {item.detail}
                  </Text>
                )}
              </Button>
            )
          })}
        </Stack>
      )
    case "image": {
      const src = imageSrc(String(node.src))
      return src ? (
        <Image src={src} alt={node.alt} w={node.width ? `${node.width}px` : "full"} />
      ) : null
    }
    case "progress":
      return (
        <Progress.Root
          value={node.value === null ? null : Math.max(0, Math.min(100, node.value))}
          size="xs"
          colorPalette="brand"
        >
          <Progress.Track>
            <Progress.Range />
          </Progress.Track>
        </Progress.Root>
      )
    case "divider":
      return <Separator />
  }
  return null
}
