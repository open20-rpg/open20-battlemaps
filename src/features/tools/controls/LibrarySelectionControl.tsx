import { Flex, IconButton, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuX } from "react-icons/lu"
import { useToolsStore } from "../../../stores/toolsStore"
import { Tooltip } from "../../../ui/chakra/tooltip"
import { DEFAULT_CUSTOM_COLOR } from "../../../lib/colors"
import { type AssetCategory } from "../../../lib/categories"
import { AssetSelector } from "../../library/AssetSelector"

/**
 * What's picked in the Library for the tool (Scatter's objects), in its
 * panel: a grid of just those (recolored like the Library shows them); a
 * tap on one takes it out, the clear button takes them all.
 */
export function LibrarySelectionControl({
  toolId,
  value,
  labelKey,
  category,
  onChange,
}: {
  toolId: string
  value: string[]
  labelKey: string
  category: AssetCategory
  onChange: (value: string[]) => void
}) {
  const { t } = useTranslation()
  const color = useToolsStore((s) => {
    const stored = s.paramsByTool[toolId]?.customColor
    return typeof stored === "string" ? stored : DEFAULT_CUSTOM_COLOR
  })
  return (
    <Flex direction="column" flex="1" minH="0">
      <Flex px="3" pt="2" pb="1" align="center" gap="1">
        <Text flex="1" fontSize="xs" color="fg.muted">
          {t(labelKey)} · {value.length}
        </Text>
        {value.length > 0 && (
          <Tooltip content={t("tools.libraryClear")} showArrow>
            <IconButton
              aria-label={t("tools.libraryClear")}
              size="2xs"
              variant="ghost"
              onClick={() => onChange([])}
            >
              <LuX />
            </IconButton>
          </Tooltip>
        )}
      </Flex>
      {value.length === 0 ? (
        <Text px="3" pb="2" fontSize="xs" color="fg.muted">
          {t("tools.libraryNone")}
        </Text>
      ) : (
        <>
          <Text px="3" pb="1.5" fontSize="2xs" color="fg.subtle">
            {t("tools.libraryRemoveHint")}
          </Text>
          <AssetSelector
            browserKey={`picked:${toolId}`}
            category={category}
            color={color}
            onlyIds={value}
            // Nothing shows selected here: a tap (or a range) takes those out.
            select="multi"
            selectedIds={[]}
            onSelectionChange={(ids) => {
              const drop = new Set(ids)
              onChange(value.filter((id) => !drop.has(id)))
            }}
            showSearch={false}
            showPreview
          />
        </>
      )}
    </Flex>
  )
}
