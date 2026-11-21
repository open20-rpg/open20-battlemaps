import { HStack, IconButton, Input, Text, VStack } from "@chakra-ui/react"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { LuEraser, LuX } from "react-icons/lu"

// Search box + result count, shown above the grid, or floating over it (a
// param picker's search button: `onClose` given). It searches as you type
// (a moment after the last key; Enter right away): the words in any order.
export function SearchBar({
  queryInput,
  setQueryInput,
  runSearch,
  total,
  onClose,
}: {
  queryInput: string
  setQueryInput: (q: string) => void
  runSearch: (q: string) => Promise<void>
  total: number
  /** Floating: focused as it opens; Escape (or this button) closes it. */
  onClose?: () => void
}) {
  const { t } = useTranslation()
  const floating = !!onClose
  // Typing searches a moment after the last key; Enter (or clearing) at once.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchNow = (q: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    void runSearch(q)
  }
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
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
          onChange={(e) => {
            const q = e.currentTarget.value
            setQueryInput(q)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => searchNow(q), 300)
          }}
          onKeyDown={(e) => {
            // Enter while an IME is composing confirms the candidate, not the search.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) searchNow(queryInput)
          }}
        />
        <IconButton
          aria-label={t("library.clear")}
          size="sm"
          variant="subtle"
          onClick={() => {
            setQueryInput("")
            searchNow("")
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
      <Text fontSize="2xs" color="fg.muted">
        {t("library.results", { count: total })}
      </Text>
    </VStack>
  )
}
