import { Box, Flex, IconButton, Input, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuArrowDown, LuArrowUp, LuPlus, LuTrash2 } from "react-icons/lu"
import { useEditorStore } from "../../stores/editorStore"
import { useMapStore } from "../../stores/mapStore"
import { addLevel, moveLevel, removeLevel, renameLevel } from "./commands"
import { newId } from "./model/geometry"
import { type MapLevel } from "./model/types"

/** Stable fallback so the store selector never returns a fresh array. */
const NO_LEVELS: MapLevel[] = []

/**
 * The map's levels (floors): pick the one being edited, rename, reorder,
 * add and delete them. Edits go through map commands, so they're undoable.
 */
export function LevelsPanel() {
  const { t } = useTranslation()
  const levels = useMapStore((s) => s.map?.levels ?? NO_LEVELS)
  const active = useEditorStore((s) => s.activeLevel)
  const setActive = useEditorStore((s) => s.setActiveLevel)

  return (
    <VStack align="stretch" gap="1.5" px="3" py="1.5">
      <Text fontSize="xs" color="fg.muted">
        {t("levels.title")}
      </Text>
      {levels.map((level, i) => {
        const isActive = level.id === active
        return (
          <Flex
            key={level.id}
            align="center"
            gap="1"
            borderWidth="1px"
            borderColor={isActive ? "brand.fg" : "panel.border"}
            borderRadius="md"
            bg={isActive ? "panel.rowSelected/50" : undefined}
            px="1.5"
            py="1"
          >
            <Box
              as="button"
              aria-pressed={isActive}
              aria-label={t("levels.select")}
              boxSize="3"
              flexShrink={0}
              borderRadius="full"
              borderWidth="2px"
              borderColor="brand.fg"
              bg={isActive ? "brand.fg" : "transparent"}
              cursor="pointer"
              onClick={() => setActive(level.id)}
            />
            <Input
              size="xs"
              variant="flushed"
              value={level.name}
              placeholder={t("levels.unnamed", { n: i + 1 })}
              onFocus={() => setActive(level.id)}
              onChange={(e) => renameLevel(level.id, e.currentTarget.value)}
            />
            <IconButton
              aria-label={t("levels.moveUp")}
              size="2xs"
              variant="ghost"
              disabled={i === 0}
              onClick={() => moveLevel(level.id, -1)}
            >
              <LuArrowUp />
            </IconButton>
            <IconButton
              aria-label={t("levels.moveDown")}
              size="2xs"
              variant="ghost"
              disabled={i === levels.length - 1}
              onClick={() => moveLevel(level.id, 1)}
            >
              <LuArrowDown />
            </IconButton>
            <IconButton
              aria-label={t("levels.delete")}
              size="2xs"
              variant="ghost"
              colorPalette="red"
              disabled={levels.length <= 1}
              onClick={() => removeLevel(level.id)}
            >
              <LuTrash2 />
            </IconButton>
          </Flex>
        )
      })}
      <IconButton
        aria-label={t("levels.add")}
        size="sm"
        variant="subtle"
        w="full"
        onClick={() => addLevel({ id: newId("l"), name: "" })}
      >
        <LuPlus />
        {t("levels.add")}
      </IconButton>
    </VStack>
  )
}
