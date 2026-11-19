import { useState } from "react"
import { Box, Button, Flex, HStack, Stack, Switch, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuChevronDown, LuChevronRight } from "react-icons/lu"
import { useSettingsStore } from "../../../stores/settingsStore"
import { withLoading } from "../../../stores/loadingStore"
import { SegmentedControl } from "../../../features/tools/controls/SegmentedControl"
import { TOOL_BY_ID } from "../../../features/tools/definitions"
import {
  profileRender,
  type RenderCost,
  type RenderProfile,
} from "../../../features/map/render/perfProfile"
import {
  BLUR_QUALITIES,
  FRACTION_STEPS,
  GRAPHICS_PRESETS,
  PRESET_SETTINGS,
  presetOf,
  type RenderPerformance,
  RESOLUTION_STEPS,
  TEXTURE_SCALES,
} from "../../../lib/renderPerformance"
import { roundTo } from "../../../lib/numbers"
import { useGraphicsBenchmark } from "../../../features/map/benchmark/useGraphicsBenchmark"

const percent = (v: number) => `${Math.round(v * 100)}%`

/**
 * Settings › Performance, kept simple: the graphics quality and the
 * automatic setup that picks it for this device; every setting by hand
 * folded under Advanced; and (with Settings › Debug's graphics detail)
 * what each part of a frame costs.
 */
export function PerformanceTab() {
  const { t } = useTranslation()
  const perf = useSettingsStore((s) => s.performance)
  const setPerformance = useSettingsStore((s) => s.setPerformance)
  const replacePerformance = useSettingsStore((s) => s.replacePerformance)
  const snapshotGestures = useSettingsStore((s) => s.snapshotViewGestures)
  const setSnapshotGestures = useSettingsStore((s) => s.setSnapshotViewGestures)
  const graphicsDetail = useSettingsStore((s) => s.graphicsDetail)
  const preset = presetOf(perf)
  const [advanced, setAdvanced] = useState(false)

  const numeric = <K extends keyof RenderPerformance>(
    key: K,
    labelKey: string,
    steps: readonly number[],
    format: (v: number) => string,
  ) => (
    <SegmentedControl
      label={t(labelKey)}
      value={String(perf[key])}
      options={steps.map((v) => ({ value: String(v), label: format(v) }))}
      onChange={(v) => setPerformance({ [key]: Number(v) })}
    />
  )
  const blurLabel = (v: number) => (v === 0 ? t("perf.none") : String(v))

  return (
    <Stack gap="4" fontSize="sm">
      <Box mx="-3">
        <SegmentedControl
          label={t("perf.preset")}
          value={preset ?? "custom"}
          options={GRAPHICS_PRESETS.map((p) => ({ value: p, label: t(`perf.presets.${p}`) }))}
          onChange={(p) => replacePerformance(PRESET_SETTINGS[p as keyof typeof PRESET_SETTINGS])}
        />
        {!preset && <Hint>{t("perf.customPreset")}</Hint>}
      </Box>
      <AutoSetup />

      {/* Every setting by hand, out of the way until asked for. */}
      <Box>
        <Button
          size="xs"
          variant="ghost"
          colorPalette="gray"
          px="1"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
        >
          {advanced ? <LuChevronDown /> : <LuChevronRight />}
          {t("perf.advanced")}
        </Button>
        {advanced && (
          <Stack gap="0" mx="-3" mt="1">
            {numeric("maxResolution", "perf.maxResolution", RESOLUTION_STEPS, (v) => `${v}×`)}
            <Hint>
              {t("perf.maxResolutionHint", { screen: roundTo(window.devicePixelRatio || 1) })}
            </Hint>
            {numeric("textureScale", "perf.textureScale", TEXTURE_SCALES, percent)}
            {numeric("terrainResolution", "perf.terrainResolution", FRACTION_STEPS, percent)}
            {numeric("maskDetail", "perf.maskDetail", FRACTION_STEPS, percent)}
            {numeric("shadowBlurQuality", "perf.shadowBlurQuality", BLUR_QUALITIES, blurLabel)}
            {numeric("lightBlurQuality", "perf.lightBlurQuality", BLUR_QUALITIES, blurLabel)}
            <Toggle
              label={t("perf.antialias")}
              checked={perf.antialias}
              onChange={(antialias) => setPerformance({ antialias })}
            />
            <Toggle
              label={t("perf.mipmaps")}
              checked={perf.mipmaps}
              onChange={(mipmaps) => setPerformance({ mipmaps })}
            />
            <Toggle
              label={t("perf.waterEffect")}
              checked={perf.waterEffect}
              onChange={(waterEffect) => setPerformance({ waterEffect })}
            />
            <Toggle
              label={t("perf.highPrecision")}
              checked={perf.highPrecision}
              onChange={(highPrecision) => setPerformance({ highPrecision })}
            />
            <Toggle
              label={t("prefs.snapshotGestures")}
              hint={t("prefs.snapshotGesturesHint")}
              checked={snapshotGestures}
              onChange={setSnapshotGestures}
            />
          </Stack>
        )}
      </Box>

      {graphicsDetail && <Measurement />}
    </Stack>
  )
}

/** The automatic setup: each preset's frames per second here, and the suggested one to apply. */
export function AutoSetup() {
  const { t } = useTranslation()
  const replacePerformance = useSettingsStore((s) => s.replacePerformance)
  const current = useSettingsStore((s) => presetOf(s.performance))
  const { running, results, suggested, failed, run } = useGraphicsBenchmark()
  return (
    <Box borderWidth="1px" borderColor="panel.border" borderRadius="md" p="3">
      <HStack justify="space-between" gap="3">
        <Text fontWeight="semibold">{t("perf.auto.title")}</Text>
        <Button size="xs" colorPalette="brand" loading={running} onClick={() => void run()}>
          {t(results.length ? "perf.auto.again" : "perf.auto.run")}
        </Button>
      </HStack>
      <Text mt="1" fontSize="xs" color="fg.muted">
        {t("perf.auto.hint")}
      </Text>
      {failed && (
        <Text mt="2" fontSize="xs" color="fg.error">
          {t("perf.auto.failed")}
        </Text>
      )}
      {results.length > 0 && (
        <Stack mt="2" gap="1">
          {results.map((r) => (
            <HStack key={r.preset} justify="space-between" fontSize="xs">
              <Text fontWeight={r.preset === suggested ? "semibold" : undefined}>
                {t(`perf.presets.${r.preset}`)}
                {r.preset === suggested ? ` · ${t("perf.auto.suggested")}` : ""}
              </Text>
              <Text color="fg.muted">{t("perf.auto.fps", { fps: Math.round(r.fps) })}</Text>
            </HStack>
          ))}
        </Stack>
      )}
      {suggested && suggested !== current && !running && (
        <Button
          mt="2"
          size="xs"
          variant="outline"
          onClick={() => replacePerformance(PRESET_SETTINGS[suggested])}
        >
          {t("perf.auto.apply", { preset: t(`perf.presets.${suggested}`) })}
        </Button>
      )}
    </Box>
  )
}

/** The measurement: its button and, once run, what each part costs. */
function Measurement() {
  const { t } = useTranslation()
  const [profile, setProfile] = useState<RenderProfile | null>(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)

  const measure = async () => {
    setBusy(true)
    try {
      const result = await withLoading(t("perf.measuring"), () => profileRender())
      setProfile(result)
      setMissing(!result)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box borderWidth="1px" borderColor="panel.border" borderRadius="md" p="3">
      <HStack justify="space-between" gap="3">
        <Text fontWeight="semibold">{t("perf.measureTitle")}</Text>
        <Button size="xs" colorPalette="brand" loading={busy} onClick={() => void measure()}>
          {t(profile ? "perf.measureAgain" : "perf.measure")}
        </Button>
      </HStack>
      <Text mt="1" fontSize="xs" color="fg.muted">
        {t("perf.measureHint")}
      </Text>
      {missing && (
        <Text mt="2" fontSize="xs" color="fg.muted">
          {t("perf.noMap")}
        </Text>
      )}
      {profile && <ProfileResult profile={profile} />}
    </Box>
  )
}

function ProfileResult({ profile }: { profile: RenderProfile }) {
  const { t } = useTranslation()
  const fps = (ms: number) => Math.min(999, Math.round(1000 / Math.max(ms, 0.01)))
  const label = (cost: RenderCost) => {
    if (!cost.tool) return t(cost.labelKey)
    const nameKey = TOOL_BY_ID.get(cost.tool)?.nameKey
    return t(cost.labelKey, { tool: nameKey ? t(nameKey) : cost.tool })
  }
  return (
    <Stack mt="3" gap="2">
      <Text fontSize="xs">
        {t("perf.frame", { ms: profile.frameMs.toFixed(1), fps: fps(profile.frameMs) })}
      </Text>
      <Text fontSize="xs">
        {t("perf.moveFrame", { ms: profile.moveMs.toFixed(1), fps: fps(profile.moveMs) })}
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {t("perf.canvas", {
          width: Math.round(profile.width * profile.resolution),
          height: Math.round(profile.height * profile.resolution),
          resolution: roundTo(profile.resolution),
        })}
      </Text>
      <Stack gap="1.5" mt="1">
        {profile.costs.map((cost) => {
          const share = profile.frameMs > 0 ? Math.min(1, cost.ms / profile.frameMs) : 0
          return (
            <Box key={cost.id}>
              <HStack justify="space-between" fontSize="xs">
                <Text>{label(cost)}</Text>
                <Text color="fg.muted">
                  {cost.ms.toFixed(1)} ms · {percent(share)}
                </Text>
              </HStack>
              <Box h="1" bg="panel.border" borderRadius="full" overflow="hidden">
                <Box h="full" w={percent(share)} bg="brand.solid" />
              </Box>
            </Box>
          )
        })}
      </Stack>
    </Stack>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <Text px="3" mt="-1" mb="1" fontSize="xs" color="fg.muted">
      {children}
    </Text>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <Flex px="3" py="1.5" gap="3" justify="space-between" align="center">
      <Box>
        <Text>{label}</Text>
        {hint && (
          <Text fontSize="xs" color="fg.muted">
            {hint}
          </Text>
        )}
      </Box>
      <Switch.Root
        colorPalette="brand"
        checked={checked}
        onCheckedChange={(e) => onChange(e.checked)}
      >
        <Switch.HiddenInput />
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Root>
    </Flex>
  )
}
