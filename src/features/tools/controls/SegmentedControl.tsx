import { Box, Flex, Icon, Text } from "@chakra-ui/react"
import { type IconType } from "react-icons"

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: IconType
}

/**
 * Segmented single-choice control: a labelled row of side-by-side buttons, one
 * highlighted. Shared by Sorting (Over/Under) and any `segmented` param (Brush
 * Mode, …). Icons are optional.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
}) {
  return (
    <Box px="3" py="1.5">
      <Text mb="2" fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Flex
        gap="0"
        borderWidth="1px"
        borderColor="panel.border"
        borderRadius="md"
        overflow="hidden"
      >
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
              {opt.icon && <Icon as={opt.icon} boxSize="4" />}
              <Text fontSize="sm">{opt.label}</Text>
            </Flex>
          )
        })}
      </Flex>
    </Box>
  )
}
