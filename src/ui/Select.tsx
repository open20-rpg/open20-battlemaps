import { useMemo } from "react"
import { Select as ChakraSelect, Portal, createListCollection } from "@chakra-ui/react"

export interface SelectItem {
  value: string
  /** Text shown in the trigger and list; kept a string so a11y/typeahead work. */
  label: string
  disabled?: boolean
  /** Optional per-option font, e.g. font-family previews. */
  fontFamily?: string
}

/**
 * Non-native single-select dropdown. We deliberately avoid `NativeSelect`:
 * Android renders disabled `<option>`s (which several tool params rely on)
 * inconsistently. This Chakra `Select` styles disabled items uniformly across
 * platforms and lets us render per-option styling (e.g. font previews).
 */
export function Select({
  value,
  items,
  onChange,
  size = "sm",
  triggerStyle,
}: {
  value: string
  items: SelectItem[]
  onChange: (value: string) => void
  size?: "xs" | "sm" | "md" | "lg"
  triggerStyle?: React.CSSProperties
}) {
  const collection = useMemo(
    () => createListCollection({ items, isItemDisabled: (item) => Boolean(item.disabled) }),
    [items],
  )

  return (
    <ChakraSelect.Root
      collection={collection}
      size={size}
      value={[value]}
      onValueChange={(e) => {
        const next = e.value[0]
        if (next != null) onChange(next)
      }}
    >
      <ChakraSelect.HiddenSelect />
      <ChakraSelect.Control>
        <ChakraSelect.Trigger bg="panel.solid" borderColor="panel.border" style={triggerStyle}>
          <ChakraSelect.ValueText />
        </ChakraSelect.Trigger>
        <ChakraSelect.IndicatorGroup>
          <ChakraSelect.Indicator />
        </ChakraSelect.IndicatorGroup>
      </ChakraSelect.Control>
      <Portal>
        <ChakraSelect.Positioner>
          <ChakraSelect.Content bg="panel.solid" borderColor="panel.border">
            {items.map((item) => (
              <ChakraSelect.Item
                item={item}
                key={item.value}
                style={item.fontFamily ? { fontFamily: item.fontFamily } : undefined}
              >
                <ChakraSelect.ItemText>{item.label}</ChakraSelect.ItemText>
                <ChakraSelect.ItemIndicator />
              </ChakraSelect.Item>
            ))}
          </ChakraSelect.Content>
        </ChakraSelect.Positioner>
      </Portal>
    </ChakraSelect.Root>
  )
}
