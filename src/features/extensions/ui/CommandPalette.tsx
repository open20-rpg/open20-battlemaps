import { useState } from "react"
import { Box, Button, Input, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { localize } from "@open20/battlemaps-sdk"
import { Modal } from "../../../ui/Modal"
import { useExtensionsStore } from "../../../stores/extensionsStore"
import { useSettingsStore } from "../../../stores/settingsStore"
import { runCommand } from "../actions"
import { commandBindings, type Command } from "../commands"

/** The palette: search every extension command by name and run it. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState("")
  const commands = useExtensionsStore((s) => s.contributions).filter(
    (c): c is Command => c.contribution.type === "command" && c.contribution.palette !== false,
  )
  const overrides = useSettingsStore((s) => s.shortcutOverrides)
  const q = query.trim().toLowerCase()
  const matches = commands.filter((c) =>
    localize(c.contribution.title, i18n.language).toLowerCase().includes(q),
  )
  const run = (c: Command) => {
    onClose()
    void runCommand(c)
  }
  return (
    <Modal open={open} onClose={onClose} size="md" title={t("extensions.palette")}>
      <Stack gap="2">
        <Input
          autoFocus
          placeholder={t("extensions.paletteSearch")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && matches[0]) run(matches[0])
          }}
        />
        {matches.length === 0 && (
          <Text fontSize="sm" color="fg.muted">
            {t("extensions.paletteEmpty")}
          </Text>
        )}
        <Stack gap="0.5" maxH="60vh" overflowY="auto">
          {matches.map((c) => (
            <Button
              key={c.key}
              variant="ghost"
              size="sm"
              justifyContent="space-between"
              onClick={() => run(c)}
            >
              <Text truncate>{localize(c.contribution.title, i18n.language)}</Text>
              <Box as="span" color="fg.muted" fontSize="xs">
                {commandBindings(c, overrides)[0] ?? ""}
              </Box>
            </Button>
          ))}
        </Stack>
      </Stack>
    </Modal>
  )
}
