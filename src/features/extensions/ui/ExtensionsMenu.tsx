import { useEffect, useState } from "react"
import { Button, HStack, Icon, Input, Menu, Portal, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import {
  LuBlocks,
  LuChartBar,
  LuCommand,
  LuDices,
  LuDownload,
  LuEye,
  LuMap,
  LuPanelRight,
  LuSettings2,
  LuUpload,
  LuWand,
  LuGraduationCap,
  LuMousePointerClick,
} from "react-icons/lu"
import { localize, type Contribution, type ParamSpec } from "@open20/battlemaps-sdk"
import { Modal } from "../../../ui/Modal"
import {
  scopedKey,
  useExtensionsStore,
  type LiveContribution,
} from "../../../stores/extensionsStore"
import { useHasMap } from "../../../stores/mapStore"
import { createMap } from "../../map/commands"
import {
  computeStats,
  runCommand,
  runContextItem,
  runExport,
  runGenerator,
  runImport,
  runSelectionMode,
} from "../actions"
import { extensionIcon } from "../icons"
import { ParamField } from "./ParamField"
import { defaultsOf } from "../forms"

type Of<T extends Contribution["type"]> = LiveContribution<Extract<Contribution, { type: T }>>

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

type Dialog =
  | { kind: "generator"; c: Of<"generator">; newMap?: { width: number; height: number } }
  | { kind: "export"; c: Of<"exportFormat"> }
  | { kind: "stats" }

/**
 * The Extensions menu: managing them, and everything they add that isn't a
 * tool — commands, panels, generators, import/export formats, selection
 * actions, stats, tours and extra views.
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
  const all = useExtensionsStore((s) => s.contributions)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const of = <T extends Contribution["type"]>(type: T) =>
    all.filter((c) => c.contribution.type === type) as Of<T>[]
  const text = (v: Parameters<typeof localize>[0]) => localize(v, i18n.language)
  const open = (extId: string, id: string) =>
    useExtensionsStore.getState().setPanel(scopedKey(extId, id), { open: true })

  const commands = of("command").filter(
    (c) => (c.contribution.menu ?? "extensions") === "extensions",
  )
  const panels = [...of("panel"), ...of("iframePanel")]
  const generators = of("generator")
  const presets = of("newMapPreset")
  const imports = of("importFormat")
  const exports = of("exportFormat")
  const contextItems = of("contextMenu")
  const modes = of("selectionMode")
  const tours = of("tour")
  const views = of("view")
  const hasStats = of("stats").length > 0

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
              <Menu.Item value="manage" onClick={onManage}>
                <LuSettings2 />
                <Text ml="2">{t("extensions.manage")}</Text>
              </Menu.Item>
              <Menu.Item value="palette" onClick={onPalette}>
                <LuCommand />
                <Text ml="2">{t("extensions.palette")}</Text>
                <Menu.ItemCommand>Ctrl+Shift+P</Menu.ItemCommand>
              </Menu.Item>
              {commands.length > 0 && <Menu.Separator />}
              {commands.map((c) => {
                return (
                  <Menu.Item key={c.key} value={c.key} onClick={() => void runCommand(c)}>
                    <Icon as={c.contribution.icon ? extensionIcon(c.contribution.icon) : LuWand} />
                    <Text ml="2">{text(c.contribution.title)}</Text>
                    {c.contribution.shortcut && (
                      <Menu.ItemCommand>{c.contribution.shortcut}</Menu.ItemCommand>
                    )}
                  </Menu.Item>
                )
              })}
              {panels.length > 0 && <Menu.Separator />}
              {panels.map((c) => (
                <Menu.Item
                  key={c.key}
                  value={c.key}
                  onClick={() => open(c.extId, c.contribution.id)}
                >
                  <LuPanelRight />
                  <Text ml="2">{text(c.contribution.title)}</Text>
                </Menu.Item>
              ))}
              {(generators.length > 0 || presets.length > 0) && <Menu.Separator />}
              {generators
                .filter((g) => g.contribution.scope.some((s) => s !== "newMap"))
                .map((g) => (
                  <Menu.Item
                    key={g.key}
                    value={g.key}
                    disabled={!hasMap}
                    onClick={() => setDialog({ kind: "generator", c: g })}
                  >
                    <LuDices />
                    <Text ml="2">
                      {t("extensions.generate", { name: text(g.contribution.name) })}
                    </Text>
                  </Menu.Item>
                ))}
              {presets.map((p) => {
                const gen = generators.find(
                  (g) => g.extId === p.extId && g.contribution.id === p.contribution.generator,
                )
                const size = { width: p.contribution.width, height: p.contribution.height }
                return (
                  <Menu.Item
                    key={p.key}
                    value={p.key}
                    onClick={() =>
                      gen
                        ? setDialog({ kind: "generator", c: gen, newMap: size })
                        : createMap(size.width, size.height)
                    }
                  >
                    <LuMap />
                    <Text ml="2">
                      {t("extensions.newMapWith", { name: text(p.contribution.name) })}
                    </Text>
                  </Menu.Item>
                )
              })}
              {(imports.length > 0 || exports.length > 0) && <Menu.Separator />}
              {imports.map((f) => (
                <Menu.Item key={f.key} value={f.key} onClick={() => void runImport(f)}>
                  <LuDownload />
                  <Text ml="2">
                    {t("extensions.importWith", { name: text(f.contribution.name) })}
                  </Text>
                </Menu.Item>
              ))}
              {exports.map((f) => (
                <Menu.Item
                  key={f.key}
                  value={f.key}
                  disabled={!hasMap}
                  onClick={() => setDialog({ kind: "export", c: f })}
                >
                  <LuUpload />
                  <Text ml="2">
                    {t("extensions.exportAs", { name: text(f.contribution.name) })}
                  </Text>
                </Menu.Item>
              ))}
              {(contextItems.length > 0 || modes.length > 0) && <Menu.Separator />}
              {contextItems.map((c) => (
                <Menu.Item
                  key={c.key}
                  value={c.key}
                  disabled={!hasMap}
                  onClick={() => void runContextItem(c)}
                >
                  <LuMousePointerClick />
                  <Text ml="2">{text(c.contribution.title)}</Text>
                </Menu.Item>
              ))}
              {modes.map((c) => (
                <Menu.Item
                  key={c.key}
                  value={c.key}
                  disabled={!hasMap}
                  onClick={() => void runSelectionMode(c)}
                >
                  <LuMousePointerClick />
                  <Text ml="2">
                    {t("extensions.selectWith", { name: text(c.contribution.name) })}
                  </Text>
                </Menu.Item>
              ))}
              {(hasStats || tours.length > 0 || views.length > 0) && <Menu.Separator />}
              {hasStats && (
                <Menu.Item
                  value="stats"
                  disabled={!hasMap}
                  onClick={() => setDialog({ kind: "stats" })}
                >
                  <LuChartBar />
                  <Text ml="2">{t("extensions.statsTitle")}</Text>
                </Menu.Item>
              )}
              {tours.map((c) => (
                <Menu.Item
                  key={c.key}
                  value={c.key}
                  onClick={() => useExtensionsStore.getState().setTour({ key: c.key, step: 0 })}
                >
                  <LuGraduationCap />
                  <Text ml="2">{text(c.contribution.title)}</Text>
                </Menu.Item>
              ))}
              {views.map((c) => (
                <Menu.Item
                  key={c.key}
                  value={c.key}
                  disabled={!hasMap}
                  onClick={() => open(c.extId, `view:${c.contribution.id}`)}
                >
                  <LuEye />
                  <Text ml="2">{text(c.contribution.title)}</Text>
                </Menu.Item>
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
