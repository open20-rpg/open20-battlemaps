import { Box, Text, VStack } from "@chakra-ui/react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useEditorStore } from "../../../stores/editorStore"
import { useMapStore } from "../../../stores/mapStore"
import { beginGesture, endGesture, updateEntities } from "../../map/commands"
import { type MapEntity } from "../../map/model/types"
import { TOOL_TREE, findToolPath } from "../definitions"
import { type ToolParamSpec } from "../params"
import { propertyPatches, sharedProperties } from "../properties"
import { SELECT_KINDS, idsOfKind } from "../selectKinds"
import { ButtonControl } from "./ButtonControl"

/** Quiet time after the last change that closes the current undo step. */
const EDIT_SETTLE_MS = 400

let settle: ReturnType<typeof setTimeout> | undefined

/**
 * Apply a property change. Sliders fire on every move, so consecutive changes
 * share one gesture (one undo step) until the edits settle.
 */
function applyLive(patches: Map<string, Partial<MapEntity>>): void {
  beginGesture()
  updateEntities(patches)
  clearTimeout(settle)
  settle = setTimeout(endGesture, EDIT_SETTLE_MS)
}

const NO_ENTITIES: MapEntity[] = []

/**
 * Select tool: the selected entities' properties (the ones they all have),
 * rendered with the same controls as tool params and written back to the
 * document through commands.
 */
export function SelectionPropertiesControl({
  renderControl,
}: {
  renderControl: (spec: ToolParamSpec, value: unknown, onChange: (v: unknown) => void) => ReactNode
}) {
  const { t } = useTranslation()
  const selection = useEditorStore((s) => s.selection)
  const select = useEditorStore((s) => s.select)
  const activeLevel = useEditorStore((s) => s.activeLevel)
  const all = useMapStore((s) => s.map?.entities ?? NO_ENTITIES)
  const ids = new Set(selection)
  const selected = all.filter((e) => ids.has(e.id))

  if (selected.length === 0) {
    // Nothing selected: offer "select all …" for every kind on the level.
    const level = activeLevel ?? undefined
    const onLevel = all.filter((e) => !e.level || !level || e.level === level)
    const kinds = SELECT_KINDS.map((kind) => ({ kind, ids: idsOfKind(kind, onLevel) })).filter(
      (k) => k.ids.length > 0,
    )
    return (
      <VStack align="stretch" gap="0" borderTopWidth="1px" borderColor="panel.border" mt="2">
        <Text px="3" pt="3" pb="1" fontSize="xs" color="fg.muted">
          {t("tools.selectHint")}
        </Text>
        {kinds.map(({ kind, ids }) => (
          <ButtonControl
            key={kind.id}
            labelKey={kind.labelKey}
            icon={kind.icon}
            onClick={() => select(ids)}
          />
        ))}
      </VStack>
    )
  }
  const first = selected[0]
  const sameTool = selected.every((e) => e.toolId === first.toolId)
  const tool = findToolPath(TOOL_TREE, first.toolId)?.at(-1)
  const title =
    selected.length === 1 && tool
      ? t(tool.nameKey)
      : t("tools.selectedCount", { count: selected.length })
  const props = sharedProperties(selected)

  return (
    <VStack align="stretch" gap="0" borderTopWidth="1px" borderColor="panel.border" mt="2">
      <Box px="3" pt="2.5" pb="1">
        <Text fontSize="xs" fontWeight="bold" color="menubar.fg">
          {sameTool && selected.length > 1 && tool ? `${t(tool.nameKey)} · ${title}` : title}
        </Text>
      </Box>
      {props.length === 0 ? (
        <Text px="3" py="1.5" fontSize="xs" color="fg.muted">
          {t("tools.noProperties")}
        </Text>
      ) : (
        props.map((prop) => (
          <Box key={prop.spec.paramKey}>
            {renderControl(prop.spec, prop.read(first), (value) =>
              applyLive(propertyPatches(selected, prop.spec.paramKey, value)),
            )}
          </Box>
        ))
      )}
    </VStack>
  )
}
