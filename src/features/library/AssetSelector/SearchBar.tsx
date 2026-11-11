import { HStack, IconButton, Input, Slider, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuX } from "react-icons/lu"

// Search box + fuzzy/exact slider + result count, shown above the grid unless
// the selector is embedded as a param picker (showSearch=false).
export function SearchBar({
  queryInput,
  setQueryInput,
  exactness,
  setExactness,
  runSearch,
  total,
}: {
  queryInput: string
  setQueryInput: (q: string) => void
  exactness: number
  setExactness: (v: number) => void
  runSearch: (q: string) => Promise<void>
  total: number
}) {
  const { t } = useTranslation()
  return (
    <VStack align="stretch" gap="2.5" p="3" borderBottomWidth="1px" borderColor="panel.border">
      <HStack gap="1.5">
        <Input
          size="sm"
          value={queryInput}
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
          <LuX />
        </IconButton>
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
