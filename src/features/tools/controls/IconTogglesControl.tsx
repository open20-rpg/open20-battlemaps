import { Box, Flex, Icon, Text } from "@chakra-ui/react"
import { type IconType } from "react-icons"
import { useTranslation } from "react-i18next"
import { Tooltip } from "../../../ui/chakra/tooltip"

/**
 * A titled row (wrapping) of square on/off icon buttons — the same look as
 * the view controls (Grid, Snap…) — over a list of option ids. The value is
 * the list of ids switched on.
 */
export function IconTogglesControl({
  value,
  labelKey,
  options,
  onChange,
}: {
  value: string[]
  labelKey: string
  options: readonly { value: string; labelKey: string; icon: IconType }[]
  onChange: (value: string[]) => void
}) {
  const { t } = useTranslation()
  const on = new Set(value)
  const toggle = (id: string) =>
    onChange(options.map((o) => o.value).filter((v) => (v === id ? !on.has(v) : on.has(v))))
  return (
    <Box px="3" py="1.5">
      <Text fontSize="xs" color="fg.muted" mb="1.5">
        {t(labelKey)}
      </Text>
      <Flex wrap="wrap" gap="1">
        {options.map((o) => {
          const active = on.has(o.value)
          const label = t(o.labelKey)
          return (
            <Tooltip key={o.value} content={label} openDelay={200} showArrow>
              <Flex
                as="button"
                align="center"
                justify="center"
                boxSize="38px"
                borderRadius="md"
                flexShrink={0}
                color={active ? "brand.fg" : "menubar.fg"}
                bg={active ? "panel.rowSelected" : "transparent"}
                _hover={{ bg: active ? "panel.rowSelected" : "panel.rowHover" }}
                onClick={() => toggle(o.value)}
                aria-label={label}
                aria-pressed={active}
              >
                <Icon as={o.icon} boxSize="5" />
              </Flex>
            </Tooltip>
          )
        })}
      </Flex>
    </Box>
  )
}
