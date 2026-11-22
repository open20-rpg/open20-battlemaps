import { useState } from "react"
import { Badge, Box, Button, Flex, HStack, Separator, Stack, Switch, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuBlocks, LuFolderCode, LuPackagePlus, LuRefreshCw, LuTrash2, LuBug } from "react-icons/lu"
import { localize, type ParamSpec, type Permission, type SettingSpec } from "@open20/battlemaps-sdk"
import { FloatingWindow } from "../../../../ui/FloatingWindow"
import { Modal } from "../../../../ui/Modal"
import { toaster } from "../../../../ui/chakra/toaster-instance"
import { useExtensionsStore, type InstalledExtension } from "../../../../stores/extensionsStore"
import { extensionHost, extensionManager } from "../../extensionsApp"
import { type PreparedInstall } from "../../manager"
import { ParamField } from "../ParamField"
import { PermissionLine } from "../ExtensionPrompts"
import { Content } from "./Content"

/** A manifest setting as a form field. */
function settingField(key: string, s: SettingSpec): ParamSpec {
  switch (s.type) {
    case "boolean":
      return { kind: "switch", key, label: s.label, default: s.default }
    case "number":
      return s.min !== undefined && s.max !== undefined
        ? {
            kind: "slider",
            key,
            label: s.label,
            default: s.default,
            min: s.min,
            max: s.max,
            step: s.step ?? 1,
          }
        : { kind: "number", key, label: s.label, default: s.default, min: s.min, max: s.max }
    case "string":
      return { kind: "text", key, label: s.label, default: s.default, maxLength: s.maxLength }
    case "color":
      return { kind: "color", key, label: s.label, default: s.default }
    case "select":
      return { kind: "segmented", key, label: s.label, default: s.default, options: s.options }
  }
}

/**
 * Extensions: what's installed, each one's permissions (revocable), its
 * settings, what it did (activity) and its credits; installing from a
 * `.otbx` file or loading a folder in development mode.
 */
export function ExtensionsDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const installed = useExtensionsStore((s) => s.installed)
  const status = useExtensionsStore((s) => s.status)
  const list = Object.values(installed).sort((a, b) =>
    localize(a.manifest.name, i18n.language).localeCompare(
      localize(b.manifest.name, i18n.language),
    ),
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, setPending] = useState<PreparedInstall | null>(null)
  const current = selected ? installed[selected] : list[0]

  const install = async () => {
    const file = await extensionHost.services.pickPackage()
    if (!file) return
    const check = await extensionManager.prepare(file.bytes)
    if (!check.ok) {
      toaster.create({
        type: "error",
        title: t("extensions.invalidPackage"),
        description: check.errors.slice(0, 5).join("\n"),
      })
      return
    }
    setPending(check.prepared)
  }
  const loadDev = async () => {
    const path = await extensionHost.services.pickDevFolder()
    if (!path) return
    const errors = await extensionManager.loadDev(path)
    if (errors.length)
      toaster.create({
        type: "error",
        title: t("extensions.invalidPackage"),
        description: errors.slice(0, 5).join("\n"),
      })
  }

  return (
    <FloatingWindow
      title={t("extensions.title")}
      icon={LuBlocks}
      initialSize={{ w: 760, h: 560 }}
      resizable
      onClose={onClose}
      toolbar={
        <HStack px="3" py="2" gap="2" borderBottomWidth="1px" borderColor="panel.border">
          <Button size="xs" colorPalette="brand" onClick={() => void install()}>
            <LuPackagePlus />
            {t("extensions.install")}
          </Button>
          <Button size="xs" variant="outline" onClick={() => void loadDev()}>
            <LuFolderCode />
            {t("extensions.loadDev")}
          </Button>
          <Text fontSize="xs" color="fg.muted" ms="auto">
            {t("extensions.safety")}
          </Text>
        </HStack>
      }
    >
      <Flex h="full" minH="0">
        <Stack
          w="56"
          flexShrink={0}
          borderRightWidth="1px"
          borderColor="panel.border"
          p="2"
          gap="1"
          overflowY="auto"
        >
          {list.length === 0 && (
            <Text fontSize="sm" color="fg.muted" p="2">
              {t("extensions.empty")}
            </Text>
          )}
          {list.map((e) => (
            <Button
              key={e.manifest.id}
              size="sm"
              variant={current?.manifest.id === e.manifest.id ? "subtle" : "ghost"}
              justifyContent="flex-start"
              onClick={() => setSelected(e.manifest.id)}
            >
              <Text truncate>{localize(e.manifest.name, i18n.language)}</Text>
              <StatusDot
                status={e.enabled ? (status[e.manifest.id]?.status ?? "inactive") : "inactive"}
              />
            </Button>
          ))}
        </Stack>
        <Box flex="1" minW="0" overflowY="auto" p="4">
          {current && <Details ext={current} />}
        </Box>
      </Flex>
      {pending && <InstallConfirm prepared={pending} onDone={() => setPending(null)} />}
    </FloatingWindow>
  )
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "active"
      ? "green.500"
      : status === "error"
        ? "red.500"
        : status === "starting"
          ? "orange.400"
          : "gray.500"
  return <Box ms="auto" boxSize="2" borderRadius="full" bg={color} flexShrink={0} />
}

function Details({ ext }: { ext: InstalledExtension }) {
  const { t, i18n } = useTranslation()
  const m = ext.manifest
  const id = m.id
  const status = useExtensionsStore((s) => s.status[id])
  const activity = useExtensionsStore((s) => s.activity)
  const mine = activity
    .filter((a) => a.extId === id)
    .slice(-40)
    .reverse()
  const settings = m.contributes?.settings ?? {}
  const optional = (m.optionalPermissions ?? []).filter((p) => !ext.granted.includes(p))
  const setSetting = (key: string, value: unknown) => {
    useExtensionsStore
      .getState()
      .patchInstalled(id, { settings: { ...ext.settings, [key]: value } })
    void extensionHost.persist()
    extensionHost.connection(id)?.emit("settings.changed", { ...ext.settings, [key]: value })
  }
  return (
    <Stack gap="4">
      <Stack gap="1">
        <HStack>
          <Text fontWeight="semibold" fontSize="lg">
            {localize(m.name, i18n.language)}
          </Text>
          <Badge>{m.version}</Badge>
          {ext.dev && <Badge colorPalette="purple">{t("extensions.devBadge")}</Badge>}
          {!m.main && <Badge colorPalette="green">{t("extensions.dataOnly")}</Badge>}
        </HStack>
        <Text fontSize="sm" color="fg.muted">
          {t("extensions.by", { author: m.author.name })}
          {m.license ? ` · ${m.license}` : ""}
        </Text>
        {m.description && <Text fontSize="sm">{localize(m.description, i18n.language)}</Text>}
        {status?.status === "error" && (
          <Text fontSize="sm" color="danger.fg">
            {t("extensions.failed", { error: status.error ?? "" })}
          </Text>
        )}
      </Stack>
      <HStack gap="3" wrap="wrap">
        <Switch.Root
          checked={ext.enabled}
          onCheckedChange={(e) => void extensionManager.setEnabled(id, e.checked)}
        >
          <Switch.HiddenInput />
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Label>{t("extensions.enabled")}</Switch.Label>
        </Switch.Root>
        {ext.dev && (
          <Button size="xs" variant="outline" onClick={() => void extensionManager.start(id)}>
            <LuRefreshCw />
            {t("extensions.reload")}
          </Button>
        )}
        {m.issues && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void extensionHost.services.openUrl(m.issues!)}
          >
            <LuBug />
            {t("extensions.report")}
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          colorPalette="red"
          ms="auto"
          onClick={() => void extensionManager.uninstall(id)}
        >
          <LuTrash2 />
          {t("extensions.uninstall")}
        </Button>
      </HStack>
      <Separator />
      <Stack gap="2">
        <Text fontWeight="medium">{t("extensions.permissionsTitle")}</Text>
        {ext.granted.length === 0 && optional.length === 0 && (
          <Text fontSize="sm" color="fg.muted">
            {t("extensions.noPermissions")}
          </Text>
        )}
        {ext.granted.map((p) => (
          <HStack key={p} justify="space-between">
            <PermissionLine permission={p} />
            <Button size="2xs" variant="ghost" onClick={() => void extensionManager.revoke(id, p)}>
              {t("extensions.revoke")}
            </Button>
          </HStack>
        ))}
        {optional.map((p: Permission) => (
          <HStack key={p} opacity={0.6}>
            <PermissionLine permission={p} />
            <Text fontSize="xs">{t("extensions.askedWhenNeeded")}</Text>
          </HStack>
        ))}
      </Stack>
      {Object.keys(settings).length > 0 && (
        <>
          <Separator />
          <Stack gap="0" mx="-3">
            <Text fontWeight="medium" px="3" pb="1">
              {t("extensions.settingsTitle")}
            </Text>
            {Object.entries(settings).map(([key, spec]) => (
              <ParamField
                key={key}
                extId={id}
                spec={settingField(key, spec)}
                value={ext.settings[key] ?? spec.default}
                onChange={(v) => setSetting(key, v)}
              />
            ))}
          </Stack>
        </>
      )}
      <Content extId={id} />
      <Separator />
      <Stack gap="1">
        <Text fontWeight="medium">{t("extensions.activityTitle")}</Text>
        {mine.length === 0 && (
          <Text fontSize="sm" color="fg.muted">
            {t("extensions.noActivity")}
          </Text>
        )}
        {mine.map((a, i) => (
          <Text
            key={i}
            fontSize="xs"
            fontFamily="mono"
            color={a.kind === "denied" || a.kind === "fault" ? "danger.fg" : "fg.muted"}
          >
            {new Date(a.time).toLocaleTimeString()} · {t(`extensions.activity.${a.kind}`)} ·{" "}
            {a.text}
          </Text>
        ))}
      </Stack>
    </Stack>
  )
}

/** The install question: what the extension is and what it asks for. */
function InstallConfirm({ prepared, onDone }: { prepared: PreparedInstall; onDone: () => void }) {
  const { t, i18n } = useTranslation()
  const m = prepared.pkg.manifest
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      await extensionManager.install(prepared)
      toaster.create({
        type: "success",
        title: t("extensions.installed", { name: localize(m.name, i18n.language) }),
      })
    } finally {
      setBusy(false)
      onDone()
    }
  }
  return (
    <Modal
      open
      onClose={onDone}
      size="sm"
      title={
        prepared.previous
          ? t("extensions.updateTitle", { name: localize(m.name, i18n.language) })
          : t("extensions.installTitle", { name: localize(m.name, i18n.language) })
      }
      footer={
        <HStack justify="flex-end">
          <Button variant="ghost" onClick={onDone}>
            {t("extensions.cancel")}
          </Button>
          <Button colorPalette="brand" loading={busy} onClick={() => void go()}>
            {prepared.previous ? t("extensions.update") : t("extensions.install")}
          </Button>
        </HStack>
      }
    >
      <Stack gap="3">
        <Text fontSize="sm" color="fg.muted">
          {t("extensions.by", { author: m.author.name })} · {m.version}
        </Text>
        {prepared.newPermissions.length > 0 ? (
          <Stack gap="2">
            <Text fontSize="sm">
              {prepared.previous ? t("extensions.newPermissions") : t("extensions.willAsk")}
            </Text>
            {prepared.newPermissions.map((p) => (
              <PermissionLine key={p} permission={p} />
            ))}
          </Stack>
        ) : (
          <Text fontSize="sm">{t("extensions.noPermissions")}</Text>
        )}
        {prepared.warnings.map((w) => (
          <Text key={w} fontSize="xs" color="orange.fg">
            {w}
          </Text>
        ))}
      </Stack>
    </Modal>
  )
}
