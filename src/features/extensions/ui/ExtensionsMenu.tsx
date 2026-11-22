import { useEffect, useState } from "react"
import { Button, HStack, Icon, Input, Menu, Portal, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuBlocks, LuDices } from "react-icons/lu"
import { localize, type ParamSpec } from "@open20/battlemaps-sdk"
import { Modal } from "../../../ui/Modal"
import { useExtensionsStore } from "../../../stores/extensionsStore"
import { useHasMap } from "../../../stores/mapStore"
import { computeStats, runExport, runGenerator } from "../actions"
import { ParamField } from "./ParamField"
import { defaultsOf } from "../forms"
import { menuSections, type MenuDialog, type MenuEntry } from "../menuEntries"

/** A form for an extension's params (generators, export options), run with them. */
function FormDialog({
  title,
  extId,
  specs,
  seed,
  onRun,
  onClose,
}: {
  title: string
  extId: string
  specs: ParamSpec[]
  seed?: boolean
  onRun: (values: Record<string, unknown>, seed: number) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [values, setValues] = useState(() => defaultsOf(specs))
  const [seedValue, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <HStack justify="flex-end">
          <Button variant="ghost" onClick={onClose}>
            {t("extensions.cancel")}
          </Button>
          <Button
            colorPalette="brand"
            onClick={() => {
              onRun(values, seedValue)
              onClose()
            }}
          >
            {t("extensions.run")}
          </Button>
        </HStack>
      }
    >
      <Stack gap="0" mx="-3">
        {specs.map((s) => (
          <ParamField
            key={s.key}
            extId={extId}
            spec={s}
            value={values[s.key]}
            onChange={(v) => setValues((o) => ({ ...o, [s.key]: v }))}
          />
        ))}
        {seed && (
          <HStack px="3" py="2" gap="2">
            <Text fontSize="xs" color="fg.muted">
              {t("extensions.seed")}
            </Text>
            <Input
              size="xs"
              type="number"
              value={seedValue}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
            />
            <Button
              size="xs"
              variant="ghost"
              aria-label={t("extensions.newSeed")}
              onClick={() => setSeed(Math.floor(Math.random() * 1e9))}
            >
              <LuDices />
            </Button>
          </HStack>
        )}
      </Stack>
    </Modal>
  )
}

function StatsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [stats, setStats] = useState<Awaited<ReturnType<typeof computeStats>> | null>(null)
  useEffect(() => {
    let alive = true
    void computeStats().then((s) => alive && setStats(s))
    return () => {
      alive = false
    }
  }, [])
  return (
    <Modal open onClose={onClose} size="sm" title={t("extensions.statsTitle")}>
      <Stack gap="3">
        {(stats ?? []).map((s) => (
          <Stack key={s.title} gap="1">
            <Text fontWeight="medium">{s.title}</Text>
            {s.rows.map((r) => (
              <HStack key={r.label} justify="space-between" fontSize="sm">
                <Text color="fg.muted">{r.label}</Text>
                <Text>{r.value}</Text>
              </HStack>
            ))}
          </Stack>
        ))}
      </Stack>
    </Modal>
  )
}

/**
 * The Extensions menu: managing them, and everything they add that isn't a
 * tool — commands, panels, generators, import/export formats, selection
 * actions, stats, tours and extra views (see menuEntries.ts).
 */
export function ExtensionsMenu({
  onManage,
  onPalette,
}: {
  onManage: () => void
  onPalette: () => void
}) {
  const { t, i18n } = useTranslation()
  const hasMap = useHasMap()
  const contributions = useExtensionsStore((s) => s.contributions)
  const [dialog, setDialog] = useState<MenuDialog | null>(null)
  const text = (v: Parameters<typeof localize>[0]) => localize(v, i18n.language)
  const sections = menuSections({
    contributions,
    lang: i18n.language,
    hasMap,
    t: (key, vars) => t(key, vars ?? {}),
    onManage,
    onPalette,
    openDialog: setDialog,
  })
  return (
    <>
      <Menu.Root positioning={{ placement: "bottom-start" }}>
        <Menu.Trigger asChild>
          <Button
            variant="plain"
            h="46px"
            px="3.5"
            gap="2"
            flexShrink={0}
            borderRadius="0"
            fontWeight="medium"
            fontSize="sm"
            color="menubar.fg"
            _hover={{ bg: "menubar.hover" }}
            _open={{ bg: "menubar.hover" }}
          >
            <Icon as={LuBlocks} boxSize="5" />
            <Text>{t("menu.extensions")}</Text>
          </Button>
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content
              bg="panel.solid"
              borderColor="panel.border"
              minW="60"
              maxH="70vh"
              overflowY="auto"
            >
              {sections.map((section, i) => (
                <MenuSection key={section[0].key} entries={section} separated={i > 0} />
              ))}
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>
      {dialog?.kind === "generator" && (
        <FormDialog
          title={text(dialog.c.contribution.name)}
          extId={dialog.c.extId}
          specs={dialog.c.contribution.params ?? []}
          seed
          onRun={(values, seed) => void runGenerator(dialog.c, values, seed, dialog.newMap)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "export" && (
        <FormDialog
          title={t("extensions.exportAs", { name: text(dialog.c.contribution.name) })}
          extId={dialog.c.extId}
          specs={dialog.c.contribution.options ?? []}
          onRun={(values) => void runExport(dialog.c, values)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "stats" && <StatsDialog onClose={() => setDialog(null)} />}
    </>
  )
}

function MenuSection({ entries, separated }: { entries: MenuEntry[]; separated: boolean }) {
  return (
    <>
      {separated && <Menu.Separator />}
      {entries.map((e) => (
        <Menu.Item key={e.key} value={e.key} disabled={e.disabled} onClick={e.run}>
          <Icon as={e.icon} />
          <Text ml="2">{e.label}</Text>
          {e.shortcut && <Menu.ItemCommand>{e.shortcut}</Menu.ItemCommand>}
        </Menu.Item>
      ))}
    </>
  )
}
