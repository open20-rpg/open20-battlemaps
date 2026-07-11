import { Box, Flex, Icon, Text } from "@chakra-ui/react"
import { LuArrowDown, LuArrowUp } from "react-icons/lu"
import { useTranslation } from "react-i18next"
import { type Sorting } from "../params"

/**
 * Sorting selector: within a layer, place new items on top ("Over") or at the
 * bottom ("Under"). Rendered as two toggle buttons side by side.
 */
export function SortingControl({
  value,
  onChange,
}: {
  value: Sorting
  onChange: (value: Sorting) => void
}) {
  const { t } = useTranslation()

  const options: { value: Sorting; label: string; icon: typeof LuArrowUp }[] = [
    { value: "over", label: t("tools.sortingOver"), icon: LuArrowUp },
    { value: "under", label: t("tools.sortingUnder"), icon: LuArrowDown },
  ]

  return (
    <Box px="3" py="1.5">
      <Text mb="2" fontSize="xs" color="fg.muted">
        {t("tools.sorting")}
      </Text>
      <Flex gap="0" borderWidth="1px" borderColor="panel.border" borderRadius="md" overflow="hidden">
        {options.map((opt, i) => {
          const active = value === opt.value
          return (
            <Flex
              as="button"
              key={opt.value}
              flex="1"
              align="center"
              justify="center"
              gap="1.5"
              py="1.5"
              borderLeftWidth={i === 0 ? "0" : "1px"}
              borderColor="panel.border"
              color={active ? "brand.fg" : "menubar.fg"}
              bg={active ? "panel.rowSelected" : "transparent"}
              _hover={{ bg: active ? "panel.rowSelected" : "panel.rowHover" }}
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
            >
              <Icon as={opt.icon} boxSize="4" />
              <Text fontSize="sm">{opt.label}</Text>
            </Flex>
          )
        })}
      </Flex>
    </Box>
  )
}
