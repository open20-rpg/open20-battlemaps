import { Box, Flex, Text, VStack } from "@chakra-ui/react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useEditorStore } from "../../../stores/editorStore"
import { useMapStore } from "../../../stores/mapStore"
import { beginGesture, endGesture, updateEntities } from "../../map/commands"
import { type MapEntity } from "../../map/model/types"
import { linkedGroups } from "../../map/model/links"
import { TOOL_TREE, findToolPath } from "../definitions"
import { type ToolParamSpec } from "../params"
import { propertyPatches, sharedProperties } from "../properties"
import { SELECT_KINDS, idsOfKind, isLockedSelection } from "../selectKinds"
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

/** Height of an asset browser among the properties (it scrolls inside). */
const ASSET_BROWSER_HEIGHT = "360px"

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
  // A room's wall and floor are one shape: selecting one also shows the
  // other's properties, editable from here.
  const linked = linkedGroups(selected, all)
  // Locked: shown, but nothing in it can be changed until they're unlocked.
  const locked = isLockedSelection(selected)

  return (
    <VStack align="stretch" gap="0" borderTopWidth="1px" borderColor="panel.border" mt="2">
      {locked && (
        <Text px="3" pt="3" fontSize="xs" color="fg.muted">
          {t("tools.lockedHint")}
        </Text>
      )}
      <VStack
        align="stretch"
        gap="0"
        inert={locked}
        aria-disabled={locked}
        opacity={locked ? 0.45 : undefined}
      >
        <PropertyList
          title={sameTool && selected.length > 1 && tool ? `${t(tool.nameKey)} · ${title}` : title}
          entities={selected}
          all={all}
          renderControl={renderControl}
        />
        {linked.map((group) => {
          const name = findToolPath(TOOL_TREE, group[0].toolId)?.at(-1)?.nameKey
          return (
            <Box key={group[0].id} borderTopWidth="1px" borderColor="panel.border" mt="1">
              <PropertyList
                title={t("tools.linkedProperties", { name: name ? t(name) : group[0].toolId })}
                entities={group}
                all={all}
                renderControl={renderControl}
              />
            </Box>
          )
        })}
      </VStack>
    </VStack>
  )
}

/** One set of entities' shared properties under a title. */
function PropertyList({
  title,
  entities,
  all,
  renderControl,
}: {
  title: string
  entities: MapEntity[]
  all: readonly MapEntity[]
  renderControl: (spec: ToolParamSpec, value: unknown, onChange: (v: unknown) => void) => ReactNode
}) {
  const { t } = useTranslation()
  const props = sharedProperties(entities)
  const first = entities[0]
  return (
    <>
      <Box px="3" pt="2.5" pb="1">
        <Text fontSize="xs" fontWeight="bold" color="menubar.fg">
          {title}
        </Text>
      </Box>
      {props.length === 0 ? (
        <Text px="3" py="1.5" fontSize="xs" color="fg.muted">
          {t("tools.noProperties")}
        </Text>
      ) : (
        props.map((prop) => (
          // Asset browsers fill their box and scroll inside it: in a tool's
          // panel they take the rest of the height, but here the properties
          // column scrolls, so they'd grow as tall as every asset.
          <Flex
            key={prop.spec.paramKey}
            direction="column"
            h={prop.spec.kind === "assetPicker" ? ASSET_BROWSER_HEIGHT : undefined}
            flexShrink={0}
          >
            {renderControl(prop.spec, prop.read(first), (value) =>
              applyLive(propertyPatches(entities, prop.spec.paramKey, value, all)),
            )}
          </Flex>
        ))
      )}
    </>
  )
}
