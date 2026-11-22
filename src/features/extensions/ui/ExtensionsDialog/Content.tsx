import { Button, HStack, Separator, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { localize, type LocalizedText } from "@open20/battlemaps-sdk"
import { useExtensionsStore } from "../../../../stores/extensionsStore"
import { useSettingsStore } from "../../../../stores/settingsStore"
import { useToolsStore } from "../../../../stores/toolsStore"
import { toaster } from "../../../../ui/chakra/toaster-instance"
import { setPostProcess } from "../../../map/commands"
import { newId } from "../../../map/model/geometry"
import { type MapEntity } from "../../../map/model/types"
import { normalizePostProcessPatch } from "../../../../lib/postProcess"
import { dataContributions } from "../../manager"
import { applyLanguagePack } from "../../content"
import { extensionHost } from "../../extensionsApp"
import { openMapTemplate } from "../../../map/io"

/**
 * What a data-only part of an extension brings (presets, palettes, prefabs,
 * keymaps, languages…), each with the one action that puts it to use.
 */
export function Content({ extId }: { extId: string }) {
  const { t, i18n } = useTranslation()
  // Re-read when contributions change (data contributions bump `rev`).
  useExtensionsStore((s) => s.rev)
  const data = dataContributions.get(extId)
  if (!data) return null
  const name = (n: LocalizedText) => localize(n, i18n.language)
  const done = (what: string) =>
    toaster.create({ type: "success", title: t("extensions.content.applied", { what }) })
  const settings = useSettingsStore.getState()
  const rows: { key: string; label: string; action: string; run: () => void }[] = [
    ...data.toolPresets.map((p) => ({
      key: `tool:${p.id}`,
      label: name(p.name),
      action: t("extensions.content.use"),
      run: () => {
        useToolsStore.getState().selectToolById(p.tool)
        useToolsStore.getState().setToolParams(p.tool, p.params)
        done(name(p.name))
      },
    })),
    ...data.lightPresets.map((p) => ({
      key: `light:${p.id}`,
      label: name(p.name),
      action: t("extensions.content.use"),
      run: () => {
        useToolsStore.getState().selectToolById("light")
        useToolsStore.getState().setToolParams("light", p.params)
        done(name(p.name))
      },
    })),
    ...data.postProcessPresets.map((p) => ({
      key: `pp:${p.id}`,
      label: name(p.name),
      action: t("extensions.content.apply"),
      run: () => {
        setPostProcess(normalizePostProcessPatch(p.values))
        done(name(p.name))
      },
    })),
    ...data.palettes.map((p) => ({
      key: `palette:${p.id}`,
      label: name(p.name),
      action: t("extensions.content.add"),
      run: () => {
        for (const c of p.colors.slice(0, 64))
          if (/^#[0-9a-f]{6}$/i.test(c)) settings.addColorPreset(c)
        done(name(p.name))
      },
    })),
    ...data.prefabs.map((p) => ({
      key: `prefab:${p.id}`,
      label: name(p.name),
      action: t("extensions.content.add"),
      run: () => {
        const entities = Array.isArray(p.data) ? (p.data as MapEntity[]).slice(0, 5000) : []
        settings.addPrefab({ id: newId("prefab"), name: name(p.name), entities })
        done(name(p.name))
      },
    })),
    ...data.templates.map((p) => ({
      key: `template:${p.id}`,
      label: name(p.name),
      action: t("extensions.content.open"),
      run: () =>
        void extensionHost.services
          .readFile(extId, p.path)
          .then((bytes) => openMapTemplate(new TextDecoder().decode(bytes)))
          .then(() => done(name(p.name)))
          .catch((e: unknown) => toaster.create({ type: "error", description: String(e) })),
    })),
    ...data.keymaps.map((k) => ({
      key: `keymap:${k.id}`,
      label: name(k.name),
      action: t("extensions.content.apply"),
      run: () => {
        const map = (k.data ?? {}) as Record<string, unknown>
        for (const [action, combos] of Object.entries(map))
          if (Array.isArray(combos))
            settings.setShortcutBindings(
              action,
              combos.filter((c): c is string => typeof c === "string"),
            )
        done(name(k.name))
      },
    })),
    ...data.languagePacks.map((l) => ({
      key: `lang:${l.id}`,
      label: name(l.name),
      action: t("extensions.content.useLanguage"),
      run: () => {
        if (l.lang) applyLanguagePack(l.lang, l.data)
        done(name(l.name))
      },
    })),
  ]
  if (!rows.length && !data.fonts.length) return null
  return (
    <>
      <Separator />
      <Stack gap="1.5">
        <Text fontWeight="medium">{t("extensions.content.title")}</Text>
        {rows.map((r) => (
          <HStack key={r.key} justify="space-between">
            <Text fontSize="sm">{r.label}</Text>
            <Button size="2xs" variant="outline" onClick={r.run}>
              {r.action}
            </Button>
          </HStack>
        ))}
        {data.fonts.map((f) => (
          <Text key={f.family} fontSize="sm" color="fg.muted">
            {t("extensions.content.font", { family: f.family, license: f.license })}
          </Text>
        ))}
      </Stack>
    </>
  )
}
