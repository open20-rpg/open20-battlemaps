import { type ReactNode } from "react"
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
import { callSafely, nodeKey } from "../uiNodes"
import { ParamField } from "./ParamField"

/** Images an extension may show: its own assets or inline data images (never a remote URL). */
function imageSrc(src: string): string | null {
  if (/^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+/=]+$/.test(src)) return src
  if (src.startsWith("ext:")) return extensionBridge()?.imageUrl(src) ?? null
  return null
}

type Of<T extends UiNode["type"]> = Extract<UiNode, { type: T }>
interface ViewProps<T extends UiNode["type"]> {
  extId: string
  node: Of<T>
  depth: number
}

const toneColor = (tone?: string) =>
  tone === "muted" ? "fg.muted" : tone === "danger" ? "danger.fg" : "fg"

/** One small view per node type (a mapped type: a new type without its view doesn't compile). */
const VIEWS: { [T in UiNode["type"]]: (p: ViewProps<T>) => ReactNode } = {
  column: ({ extId, node, depth }) => (
    <Stack gap={node.gap ?? 2} align="stretch">
      <Children extId={extId} list={node.children} depth={depth} />
    </Stack>
  ),
  row: ({ extId, node, depth }) => (
    <Flex gap={node.gap ?? 2} wrap="wrap" align="center">
      <Children extId={extId} list={node.children} depth={depth} />
    </Flex>
  ),
  text: ({ node }) => (
    <Text fontSize={node.size ?? "sm"} color={toneColor(node.tone)}>
      {String(node.text).slice(0, 2000)}
    </Text>
  ),
  heading: ({ node }) => <Heading size="sm">{String(node.text).slice(0, 200)}</Heading>,
  markdown: ({ node }) => (
    <Stack gap="1.5">
      {String(node.text)
        .slice(0, 8000)
        .split(/\n{2,}/)
        .map((para) => (
          <Text key={para} fontSize="sm" whiteSpace="pre-wrap">
            {para.replace(/[*_`#]/g, "")}
          </Text>
        ))}
    </Stack>
  ),
  button: ({ node }) => (
    <Button
      size="xs"
      variant={node.variant ?? "outline"}
      colorPalette={node.variant === "solid" ? "brand" : undefined}
      disabled={node.disabled}
      onClick={() => callSafely(node.onClick)}
    >
      {node.icon && <Icon as={extensionIcon(node.icon)} />}
      {String(node.label).slice(0, 80)}
    </Button>
  ),
  field: ({ extId, node }) => (
    <Box mx="-3">
      <ParamField
        extId={extId}
        spec={node.spec}
        value={node.value}
        onChange={(v) => callSafely(node.onChange, v)}
      />
    </Box>
  ),
  list: ({ node }) => (
    <Stack gap="0.5" role="listbox">
      {(node.items ?? []).slice(0, 500).map((item) => (
        <Button
          key={item.id}
          role="option"
          aria-selected={item.id === node.selected}
          size="xs"
          variant={item.id === node.selected ? "subtle" : "ghost"}
          justifyContent="flex-start"
          onClick={() => callSafely(node.onSelect, item.id)}
        >
          {item.icon && <Icon as={extensionIcon(item.icon)} />}
          <Text truncate>{item.label}</Text>
          {item.detail && (
            <Text ms="auto" color="fg.muted" fontSize="xs">
              {item.detail}
            </Text>
          )}
        </Button>
      ))}
    </Stack>
  ),
  image: ({ node }) => {
    const src = imageSrc(String(node.src))
    return src ? (
      <Image src={src} alt={node.alt} w={node.width ? `${node.width}px` : "full"} />
    ) : null
  },
  progress: ({ node }) => (
    <Progress.Root
      value={node.value === null ? null : Math.max(0, Math.min(100, node.value))}
      size="xs"
      colorPalette="brand"
    >
      <Progress.Track>
        <Progress.Range />
      </Progress.Track>
    </Progress.Root>
  ),
  divider: () => <Separator />,
}

function Children({ extId, list, depth }: { extId: string; list: UiNode[]; depth: number }) {
  const children = (Array.isArray(list) ? list : []).slice(0, 200)
  return (
    <>
      {children.map((c) => (
        <UiNodeView key={nodeKey(c)} extId={extId} node={c} depth={depth + 1} />
      ))}
    </>
  )
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
  if (!node || depth > 20 || !(node.type in VIEWS)) return null
  const view = VIEWS[node.type] as (p: ViewProps<UiNode["type"]>) => ReactNode
  return view({ extId, node: node as never, depth })
}
