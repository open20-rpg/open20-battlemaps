import { HStack, IconButton, Input, Slider, Text, VStack } from "@chakra-ui/react"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { LuEraser, LuX } from "react-icons/lu"

// Search box + fuzzy/exact slider + result count, shown above the grid, or
// floating over it (a param picker's search button: `onClose` given).
export function SearchBar({
  queryInput,
  setQueryInput,
  exactness,
  setExactness,
  runSearch,
  total,
  onClose,
}: {
  queryInput: string
  setQueryInput: (q: string) => void
  exactness: number
  setExactness: (v: number) => void
  runSearch: (q: string) => Promise<void>
  total: number
  /** Floating: focused as it opens; Escape (or this button) closes it. */
  onClose?: () => void
}) {
  const { t } = useTranslation()
  const floating = !!onClose
  // Floating, it opens to type in.
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (floating) inputRef.current?.focus()
  }, [floating])
  return (
    <VStack
      align="stretch"
      gap="2.5"
      p="3"
      {...(floating
        ? {
            position: "absolute",
            top: "1",
            left: "2",
            right: "2",
            zIndex: "1",
            bg: "panel.solid",
            borderWidth: "1px",
            borderColor: "panel.border",
            borderRadius: "md",
            boxShadow: "lg",
          }
        : { borderBottomWidth: "1px", borderColor: "panel.border" })}
      onKeyDown={(e) => {
        if (floating && e.key === "Escape") {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <HStack gap="1.5">
        <Input
          size="sm"
          value={queryInput}
          ref={inputRef}
          placeholder={t("library.searchPlaceholder")}
          onChange={(e) => setQueryInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            // Enter while an IME is composing confirms the candidate, not the search.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void runSearch(queryInput)
          }}
        />
        <IconButton
          aria-label={t("library.clear")}
          size="sm"
          variant="subtle"
          onClick={() => {
            setQueryInput("")
            void runSearch("")
          }}
        >
          <LuEraser />
        </IconButton>
        {floating && (
          <IconButton
            aria-label={t("library.closeSearch")}
            size="sm"
            variant="ghost"
            onClick={onClose}
          >
            <LuX />
          </IconButton>
        )}
      </HStack>
      <HStack gap="2.5" fontSize="2xs" color="fg.muted">
        <Text flexShrink={0}>{t("library.fuzzy")}</Text>
        <Slider.Root
          flex="1"
          size="sm"
          colorPalette="brand"
          min={0}
          max={100}
          step={1}
          value={[Math.round(exactness * 100)]}
          onValueChange={(e) => setExactness(e.value[0] / 100)}
        >
          <Slider.Control>
            <Slider.Track>
              <Slider.Range />
            </Slider.Track>
            <Slider.Thumb index={0}>
              <Slider.HiddenInput />
            </Slider.Thumb>
          </Slider.Control>
        </Slider.Root>
        <Text flexShrink={0}>{t("library.exact")}</Text>
      </HStack>
      <Text fontSize="2xs" color="fg.muted">
        {t("library.results", { count: total })}
      </Text>
    </VStack>
  )
}
