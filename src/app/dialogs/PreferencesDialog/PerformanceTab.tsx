import { useState } from "react"
import { Box, Button, Flex, HStack, Stack, Switch, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
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
  DEFAULT_RENDER_PERFORMANCE,
  FRACTION_STEPS,
  LIGHT_RENDER_PERFORMANCE,
  type RenderPerformance,
  RESOLUTION_STEPS,
  TEXTURE_SCALES,
} from "../../../lib/renderPerformance"

const percent = (v: number) => `${Math.round(v * 100)}%`

/**
 * Settings › Performance: measure what the map costs to draw on this
 * device, part by part, and every setting that trades quality for speed.
 */
export function PerformanceTab() {
  const { t } = useTranslation()
  const perf = useSettingsStore((s) => s.performance)
  const setPerformance = useSettingsStore((s) => s.setPerformance)
  const replacePerformance = useSettingsStore((s) => s.replacePerformance)
  const snapshotGestures = useSettingsStore((s) => s.snapshotViewGestures)
  const setSnapshotGestures = useSettingsStore((s) => s.setSnapshotViewGestures)

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
      <Text color="fg.muted">{t("perf.intro")}</Text>
      <Measurement />

      <HStack gap="2" wrap="wrap">
        <Button
          size="xs"
          variant="outline"
          onClick={() => replacePerformance(DEFAULT_RENDER_PERFORMANCE)}
        >
          {t("perf.presetFull")}
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => replacePerformance(LIGHT_RENDER_PERFORMANCE)}
        >
          {t("perf.presetLight")}
        </Button>
      </HStack>

      <Section title={t("perf.sectionPixels")}>
        {numeric("maxResolution", "perf.maxResolution", RESOLUTION_STEPS, (v) => `${v}×`)}
        <Hint>{t("perf.maxResolutionHint", { screen: window.devicePixelRatio || 1 })}</Hint>
        <Toggle
          label={t("perf.antialias")}
          hint={t("perf.antialiasHint")}
          checked={perf.antialias}
          onChange={(antialias) => setPerformance({ antialias })}
        />
        <Toggle
          label={t("perf.highPrecision")}
          hint={t("perf.highPrecisionHint")}
          checked={perf.highPrecision}
          onChange={(highPrecision) => setPerformance({ highPrecision })}
        />
      </Section>

      <Section title={t("perf.sectionTextures")}>
        {numeric("textureScale", "perf.textureScale", TEXTURE_SCALES, percent)}
        <Hint>{t("perf.textureScaleHint")}</Hint>
        <Toggle
          label={t("perf.mipmaps")}
          hint={t("perf.mipmapsHint")}
          checked={perf.mipmaps}
          onChange={(mipmaps) => setPerformance({ mipmaps })}
        />
      </Section>

      <Section title={t("perf.sectionLayers")}>
        {numeric("terrainResolution", "perf.terrainResolution", FRACTION_STEPS, percent)}
        <Hint>{t("perf.terrainResolutionHint")}</Hint>
        {numeric("maskDetail", "perf.maskDetail", FRACTION_STEPS, percent)}
        <Hint>{t("perf.maskDetailHint")}</Hint>
        <Toggle
          label={t("perf.waterEffect")}
          hint={t("perf.waterEffectHint")}
          checked={perf.waterEffect}
          onChange={(waterEffect) => setPerformance({ waterEffect })}
        />
      </Section>

      <Section title={t("perf.sectionShadows")}>
        {numeric("shadowBlurQuality", "perf.shadowBlurQuality", BLUR_QUALITIES, blurLabel)}
        <Hint>{t("perf.shadowBlurQualityHint")}</Hint>
        {numeric("lightBlurQuality", "perf.lightBlurQuality", BLUR_QUALITIES, blurLabel)}
        <Hint>{t("perf.lightBlurQualityHint")}</Hint>
      </Section>

      <Section title={t("perf.sectionMotion")}>
        <Toggle
          label={t("prefs.snapshotGestures")}
          hint={t("prefs.snapshotGesturesHint")}
          checked={snapshotGestures}
          onChange={setSnapshotGestures}
        />
      </Section>
    </Stack>
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
          resolution: profile.resolution,
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Text mb="1" fontWeight="semibold">
        {title}
      </Text>
      <Stack gap="1" mx="-3">
        {children}
      </Stack>
    </Box>
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
  hint: string
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <Flex px="3" py="1.5" gap="3" justify="space-between" align="center">
      <Box>
        <Text>{label}</Text>
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
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
