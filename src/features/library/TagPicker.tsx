import { useMemo, useRef, useState } from "react"
import { Box, Flex, Input, Popover, Portal, Text } from "@chakra-ui/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useTranslation } from "react-i18next"
import { LuCheck, LuChevronDown } from "react-icons/lu"

const ROW_H = 30

/**
 * The Library's tag chooser: a button showing the current tag that opens a
 * filterable list. Packs bring hundreds of tags (FA has ~900), so the list is
 * virtualized: opening it draws only the rows in view, and typing narrows it
 * at once (every typed word, in any order, inside the tag name).
 */
export function TagPicker({
  value,
  tags,
  onChange,
}: {
  value: string
  tags: string[]
  onChange: (tag: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  const lower = useMemo(() => tags.map((tag) => tag.toLowerCase()), [tags])
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return tags
    return tags.filter((_, i) => words.every((w) => lower[i].includes(w)))
  }, [tags, lower, query])

  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer is read only here, in render
  const rows = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  })

  const pick = (tag: string) => {
    onChange(tag)
    setOpen(false)
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open)
        if (e.open) {
          setQuery("")
          // Open at the current tag.
          const i = tags.indexOf(value)
          if (i >= 0) requestAnimationFrame(() => rows.scrollToIndex(i, { align: "center" }))
        }
      }}
      positioning={{ placement: "bottom-start", sameWidth: true }}
      initialFocusEl={() => scrollRef.current?.parentElement?.querySelector("input") ?? null}
      lazyMount
      unmountOnExit
    >
      <Popover.Trigger asChild>
        <Flex
          as="button"
          flex="1"
          h="8"
          px="3"
          align="center"
          justify="space-between"
          gap="2"
          bg="panel.solid"
          borderWidth="1px"
          borderColor="panel.border"
          borderRadius="md"
          fontSize="sm"
          cursor="pointer"
          _hover={{ borderColor: "brand.fg" }}
        >
          <Text truncate>{value}</Text>
          <LuChevronDown size={15} />
        </Flex>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content bg="panel.solid" borderColor="panel.border" w="auto">
            <Box p="2" borderBottomWidth="1px" borderColor="panel.border">
              <Input
                size="sm"
                value={query}
                placeholder={t("library.searchTags")}
                onChange={(e) => {
                  setQuery(e.currentTarget.value)
                  scrollRef.current?.scrollTo({ top: 0 })
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && shown[0] && !e.nativeEvent.isComposing) pick(shown[0])
                }}
              />
            </Box>
            <Box ref={scrollRef} maxH="320px" overflowY="auto" py="1">
              {shown.length === 0 ? (
                <Text px="3" py="2" fontSize="sm" color="fg.muted">
                  {t("library.noTagsMatch")}
                </Text>
              ) : (
                <Box position="relative" h={`${rows.getTotalSize()}px`}>
                  {rows.getVirtualItems().map((row) => {
                    const tag = shown[row.index]
                    return (
                      <Flex
                        key={tag}
                        as="button"
                        position="absolute"
                        top="0"
                        left="0"
                        w="100%"
                        h={`${ROW_H}px`}
                        px="3"
                        align="center"
                        justify="space-between"
                        gap="2"
                        fontSize="sm"
                        textAlign="left"
                        style={{ transform: `translateY(${row.start}px)` }}
                        bg={tag === value ? "brand.subtle" : undefined}
                        _hover={{ bg: "bg.emphasized" }}
                        onClick={() => pick(tag)}
                      >
                        <Text truncate>{tag}</Text>
                        {tag === value && <LuCheck size={14} />}
                      </Flex>
                    )
                  })}
                </Box>
              )}
            </Box>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  )
}
