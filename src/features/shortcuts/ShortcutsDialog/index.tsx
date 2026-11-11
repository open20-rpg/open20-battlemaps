import { useEffect, useEffectEvent, useState } from "react"
import { Badge, Box, Button, Flex, HStack, IconButton, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuPlus, LuRotateCcw, LuTriangleAlert, LuX } from "react-icons/lu"
import { chordOf, findConflicts, keyName } from "../../../lib/keybindings"
import { useSettingsStore } from "../../../stores/settingsStore"
import { Modal } from "../../../ui/Modal"
import { Select } from "../../../ui/Select"
import { Tooltip } from "../../../ui/chakra/tooltip"
import {
  FIXED_CHORDS,
  PRESETS,
  SHORTCUT_ACTIONS,
  effectiveBindings,
  type PresetId,
  type ShortcutAction,
  type ShortcutGroup,
} from "../actions"

const GROUPS: ShortcutGroup[] = ["file", "edit", "view", "tools"]
const MODIFIER_KEYS = new Set(["Ctrl", "Alt", "Shift"])

/**
 * Settings › Shortcuts: every remappable action with its bindings, grouped.
 * Bindings can be added (press the keys, or the middle mouse button) and
 * removed; conflicts (two actions, or an action and a fixed shortcut, on the
 * same keys) are flagged on both sides. Reset is always in reach.
 */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const preset = useSettingsStore((s) => s.shortcutPreset)
  const overrides = useSettingsStore((s) => s.shortcutOverrides)
  const setPreset = useSettingsStore((s) => s.setShortcutPreset)
  const reset = useSettingsStore((s) => s.resetShortcuts)
  const bindings = effectiveBindings(preset, overrides)
  const conflicts = findConflicts(bindings, FIXED_CHORDS)
  const conflictCount = conflicts.size
  const changed = Object.keys(overrides).length > 0

  return (
    <Modal open={open} onClose={onClose} title={t("shortcuts.title")} size="lg">
      <Stack gap="3" fontSize="sm">
        <Flex gap="2" align="center" wrap="wrap">
          <Text color="fg.muted">{t("shortcuts.preset")}</Text>
          <Box w="44">
            <Select
              value={preset}
              items={PRESETS.map((p) => ({ value: p, label: t(`shortcuts.preset_${p}`) }))}
              onChange={(v) => setPreset(v as PresetId)}
            />
          </Box>
          <Button size="xs" variant="subtle" ml="auto" onClick={reset} disabled={!changed}>
            <LuRotateCcw />
            {t("shortcuts.reset")}
          </Button>
        </Flex>
        {conflictCount > 0 && (
          <HStack color="danger.fg" fontSize="xs">
            <LuTriangleAlert />
            <Text>{t("shortcuts.conflicts", { count: conflictCount })}</Text>
          </HStack>
        )}
        {GROUPS.map((group) => (
          <Box key={group}>
            <Text
              fontSize="xs"
              fontWeight="bold"
              textTransform="uppercase"
              letterSpacing="wide"
              color="menubar.fgMuted"
              mb="1"
            >
              {t(`shortcuts.group_${group}`)}
            </Text>
            <Stack gap="0">
              {SHORTCUT_ACTIONS.filter((a) => a.group === group).map((a) => (
                <ActionRow
                  key={a.id}
                  action={a}
                  bindings={bindings[a.id] ?? []}
                  conflicts={conflicts}
                />
              ))}
            </Stack>
          </Box>
        ))}
        <Text fontSize="xs" color="fg.muted">
          {t("shortcuts.fixedNote")}
        </Text>
      </Stack>
    </Modal>
  )
}

function ActionRow({
  action,
  bindings,
  conflicts,
}: {
  action: ShortcutAction
  bindings: string[]
  conflicts: Map<string, string[]>
}) {
  const { t } = useTranslation()
  const setBindings = useSettingsStore((s) => s.setShortcutBindings)
  const [recording, setRecording] = useState(false)
  const label = (id: string) =>
    id === "fixed"
      ? t("shortcuts.fixed")
      : t(SHORTCUT_ACTIONS.find((a) => a.id === id)?.labelKey ?? id)

  return (
    <Flex
      align="center"
      gap="2"
      py="1"
      px="2"
      mx="-2"
      borderRadius="md"
      _hover={{ bg: "panel.rowHover" }}
    >
      <Text flex="1" truncate>
        {t(action.labelKey)}
        {action.hold && (
          <Text as="span" color="fg.muted" fontSize="xs">
            {" "}
            · {t("shortcuts.hold")}
          </Text>
        )}
      </Text>
      <Flex gap="1" wrap="wrap" justify="flex-end">
        {bindings.map((b) => {
          const others = (conflicts.get(b) ?? []).filter((id) => id !== action.id)
          const chip = (
            <Badge
              key={b}
              size="sm"
              variant="subtle"
              colorPalette={others.length > 0 ? "danger" : "gray"}
              gap="1"
              fontFamily="mono"
            >
              {others.length > 0 && <LuTriangleAlert />}
              {b}
              <Box
                as="button"
                aria-label={t("shortcuts.remove")}
                opacity={0.6}
                _hover={{ opacity: 1 }}
                onClick={() =>
                  setBindings(
                    action.id,
                    bindings.filter((x) => x !== b),
                  )
                }
              >
                <LuX />
              </Box>
            </Badge>
          )
          return others.length > 0 ? (
            <Tooltip
              key={b}
              content={t("shortcuts.conflictWith", { actions: others.map(label).join(", ") })}
              showArrow
            >
              {chip}
            </Tooltip>
          ) : (
            chip
          )
        })}
        {recording ? (
          <Recorder
            hold={action.hold === true}
            onDone={(chord) => {
              setRecording(false)
              if (chord && !bindings.includes(chord)) setBindings(action.id, [...bindings, chord])
            }}
          />
        ) : (
          <Tooltip content={t("shortcuts.add")} showArrow>
            <IconButton
              aria-label={t("shortcuts.add")}
              size="2xs"
              variant="ghost"
              onClick={() => setRecording(true)}
            >
              <LuPlus />
            </IconButton>
          </Tooltip>
        )}
      </Flex>
    </Flex>
  )
}

/**
 * Captures the next shortcut: a key chord, a lone modifier released on its
 * own (hold actions), or the middle mouse button. Escape cancels. Keys are
 * swallowed while recording so they don't trigger anything else.
 */
function Recorder({ hold, onDone }: { hold: boolean; onDone: (chord: string | null) => void }) {
  const { t } = useTranslation()
  const done = useEffectEvent(onDone)
  useEffect(() => {
    let lone: string | null = null
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === "Escape") return done(null)
      const key = keyName(e.key)
      if (MODIFIER_KEYS.has(key)) {
        lone = key
        return
      }
      lone = null
      done(chordOf(e))
    }
    const onUp = (e: KeyboardEvent) => {
      e.stopImmediatePropagation()
      // A modifier pressed and released alone: only meaningful as a hold.
      if (lone && keyName(e.key) === lone) done(hold ? lone : null)
    }
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      done(hold ? "MouseMiddle" : null)
    }
    window.addEventListener("keydown", onDown, true)
    window.addEventListener("keyup", onUp, true)
    window.addEventListener("mousedown", onMouse, true)
    return () => {
      window.removeEventListener("keydown", onDown, true)
      window.removeEventListener("keyup", onUp, true)
      window.removeEventListener("mousedown", onMouse, true)
    }
  }, [hold])
  return (
    <Badge size="sm" variant="solid" colorPalette="brand">
      {t(hold ? "shortcuts.pressHold" : "shortcuts.press")}
    </Badge>
  )
}
