import { Flex, IconButton, Input, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuTrash2 } from "react-icons/lu"
import { useSettingsStore } from "../../../stores/settingsStore"

/**
 * The saved prefabs list (Prefabs tool): click one to stamp it, rename or
 * delete it. Prefabs are user data kept in the settings store, so they're
 * available in every map.
 */
export function PrefabsControl({
  value,
  labelKey,
  onChange,
}: {
  value: string | null
  labelKey: string
  onChange: (value: string | null) => void
}) {
  const { t } = useTranslation()
  const prefabs = useSettingsStore((s) => s.prefabs)
  const rename = useSettingsStore((s) => s.renamePrefab)
  const remove = useSettingsStore((s) => s.removePrefab)

  return (
    <VStack align="stretch" gap="1.5" px="3" py="1.5" flex="1" minH="0" overflowY="auto">
      <Text fontSize="xs" color="fg.muted">
        {t(labelKey)}
      </Text>
      {prefabs.length === 0 && (
        <Text fontSize="xs" color="fg.muted" textAlign="center" py="4">
          {t("tools.noPrefabs")}
        </Text>
      )}
      {prefabs.map((prefab, i) => {
        const selected = prefab.id === value
        return (
          <Flex
            key={prefab.id}
            align="center"
            gap="1"
            borderWidth="1px"
            borderColor={selected ? "brand.fg" : "panel.border"}
            bg={selected ? "panel.rowSelected/50" : undefined}
            borderRadius="md"
            px="2"
            py="1"
            cursor="pointer"
            onClick={() => onChange(selected ? null : prefab.id)}
            aria-pressed={selected}
          >
            <Input
              size="xs"
              variant="flushed"
              value={prefab.name}
              placeholder={t("tools.prefabUnnamed", { n: i + 1 })}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => rename(prefab.id, e.currentTarget.value)}
            />
            <Text fontSize="2xs" color="fg.muted" flexShrink={0}>
              {t("tools.prefabCount", { count: prefab.entities.length })}
            </Text>
            <IconButton
              aria-label={t("tools.delete")}
              size="2xs"
              variant="ghost"
              colorPalette="red"
              onClick={(e) => {
                e.stopPropagation()
                if (selected) onChange(null)
                remove(prefab.id)
              }}
            >
              <LuTrash2 />
            </IconButton>
          </Flex>
        )
      })}
    </VStack>
  )
}
