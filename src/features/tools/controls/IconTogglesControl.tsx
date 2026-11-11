import { Box, Flex, Icon, IconButton, Text } from "@chakra-ui/react"
import { LuRotateCcw } from "react-icons/lu"
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
  defaultValue,
  onChange,
}: {
  value: string[]
  labelKey: string
  options: readonly { value: string; labelKey: string; icon: IconType }[]
  /** What "reset" restores (the spec's default). */
  defaultValue: readonly string[]
  onChange: (value: string[]) => void
}) {
  const { t } = useTranslation()
  const on = new Set(value)
  const isDefault = value.length === defaultValue.length && defaultValue.every((v) => on.has(v))
  const toggle = (id: string) =>
    onChange(options.map((o) => o.value).filter((v) => (v === id ? !on.has(v) : on.has(v))))
  return (
    <Box px="3" py="1.5">
      <Flex align="center" justify="space-between" mb="1.5">
        <Text fontSize="xs" color="fg.muted">
          {t(labelKey)}
        </Text>
        <Tooltip content={t("tools.resetToggles")} openDelay={200} showArrow>
          <IconButton
            aria-label={t("tools.resetToggles")}
            size="2xs"
            variant="ghost"
            color="menubar.fgMuted"
            disabled={isDefault}
            onClick={() => onChange([...defaultValue])}
          >
            <LuRotateCcw />
          </IconButton>
        </Tooltip>
      </Flex>
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
