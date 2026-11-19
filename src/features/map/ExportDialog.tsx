import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Button, Flex, SegmentGroup, Slider, Stack, Switch, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useMapStore } from "../../stores/mapStore"
import { useViewStore } from "../../stores/viewStore"
import { toaster } from "../../ui/chakra/toaster-instance"
import { Modal } from "../../ui/Modal"
import { Select } from "../../ui/Select"
import {
  DEFAULT_JPEG_QUALITY,
  EXPORT_FORMATS,
  EXPORT_RESOLUTIONS,
  formatBytes,
  supportsTransparency,
  type ExportFormat,
  type ExportFormatKind,
} from "./exportFormat"
import { estimateExportSize, exportImageFlow } from "./io"
import { exportPxPerTile, releaseExportTextures, type ExportOptions } from "./render/exportMap"
import { GRAPHICS_PRESETS, type GraphicsPreset } from "../../lib/renderPerformance"

/** Wait after the last option change before estimating the file size (it renders a sample). */
const ESTIMATE_DELAY_MS = 400

/**
 * Export the map as an image: format (and JPEG quality), resolution,
 * graphics quality (Ultra by default, whatever the screen's), what
 * to include (grid, lighting, shadows, color adjustments, transparent
 * ground), with the resulting size in pixels and an estimate of the file's.
 */
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const map = useMapStore((s) => s.map)
  // Lighting and shadows start as the view shows them.
  const view = useViewStore.getState()
  const [kind, setKind] = useState<ExportFormatKind>("png")
  const [quality, setQuality] = useState(DEFAULT_JPEG_QUALITY)
  const [pxPerTile, setPxPerTile] = useState(128)
  const [grid, setGrid] = useState(true)
  const [lighting, setLighting] = useState(view.lighting)
  const [shadows, setShadows] = useState(view.shadows)
  const [postProcess, setPostProcess] = useState(true)
  const [transparent, setTransparent] = useState(false)
  // The image's graphics quality: the richest by default, whatever the screen's.
  const [graphics, setGraphics] = useState<GraphicsPreset>("ultra")
  const close = () => {
    // The export's own textures (a quality the screen doesn't use) go.
    releaseExportTextures()
    onClose()
  }
  const [busy, setBusy] = useState(false)

  const canBeTransparent = supportsTransparency(kind)
  const opts = useMemo<ExportOptions>(() => {
    const format: ExportFormat = kind === "jpeg" ? { kind, quality } : { kind }
    return {
      format,
      pxPerTile,
      grid,
      lighting,
      shadows,
      postProcess,
      transparent: transparent && canBeTransparent,
      quality: graphics,
    }
  }, [
    graphics,
    kind,
    quality,
    pxPerTile,
    grid,
    lighting,
    shadows,
    postProcess,
    transparent,
    canBeTransparent,
  ])
  const estimate = useSizeEstimate(map ? opts : null)

  const ppt = map ? exportPxPerTile(pxPerTile, map.width, map.height) : pxPerTile
  const width = (map?.width ?? 0) * ppt
  const height = (map?.height ?? 0) * ppt

  const run = async () => {
    setBusy(true)
    try {
      if (await exportImageFlow(opts)) {
        toaster.create({ title: t("toast.exported"), type: "success" })
        close()
      }
    } catch (err) {
      toaster.create({ title: t("toast.exportError", { error: String(err) }), type: "error" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("export.title")}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t("export.cancel")}
          </Button>
          <Button colorPalette="brand" onClick={() => void run()} disabled={!map} loading={busy}>
            {t("export.export")}
          </Button>
        </>
      }
    >
      <Stack gap="4" fontSize="sm">
        <Row label={t("export.format")}>
          <SegmentGroup.Root
            size="sm"
            value={kind}
            onValueChange={(e) => e.value && setKind(e.value as ExportFormatKind)}
          >
            <SegmentGroup.Indicator />
            <SegmentGroup.Items
              items={EXPORT_FORMATS.map((f) => ({ value: f, label: t(`export.format_${f}`) }))}
            />
          </SegmentGroup.Root>
        </Row>
        {kind === "jpeg" && (
          <Stack gap="2">
            <Flex justify="space-between">
              <Text>{t("export.quality")}</Text>
              <Text color="fg.muted" fontVariantNumeric="tabular-nums">
                {quality}
              </Text>
            </Flex>
            <Slider.Root
              size="sm"
              min={10}
              max={100}
              step={5}
              value={[quality]}
              onValueChange={(e) => setQuality(e.value[0])}
            >
              <Slider.Control>
                <Slider.Track>
                  <Slider.Range />
                </Slider.Track>
                <Slider.Thumb index={0}>
                  <Slider.HiddenInput />
                </Slider.Thumb>
              </Slider.Control>
            </Slider.Root>
          </Stack>
        )}
        <Row label={t("export.resolution")}>
          <Select
            value={String(pxPerTile)}
            items={EXPORT_RESOLUTIONS.map((r) => ({
              value: String(r),
              label: t("export.pxPerTile", { px: r }),
            }))}
            onChange={(v) => setPxPerTile(Number(v))}
          />
        </Row>

        <Row label={t("export.graphics")}>
          <Select
            value={graphics}
            items={GRAPHICS_PRESETS.map((p) => ({ value: p, label: t(`perf.presets.${p}`) }))}
            onChange={(v) => setGraphics(v as GraphicsPreset)}
          />
        </Row>

        <Text fontSize="xs" fontWeight="semibold" color="fg.muted" textTransform="uppercase">
          {t("export.include")}
        </Text>
        <Toggle label={t("export.includeGrid")} checked={grid} onChange={setGrid} />
        <Toggle label={t("export.includeLighting")} checked={lighting} onChange={setLighting} />
        <Toggle label={t("export.includeShadows")} checked={shadows} onChange={setShadows} />
        <Toggle
          label={t("export.includePostProcess")}
          checked={postProcess}
          onChange={setPostProcess}
        />
        <Toggle
          label={t("export.transparent")}
          hint={canBeTransparent ? undefined : t("export.transparentNoJpeg")}
          checked={transparent && canBeTransparent}
          disabled={!canBeTransparent}
          onChange={setTransparent}
        />

        {map && (
          <Stack gap="1" fontSize="xs" color="fg.muted">
            <Text>
              {t("export.size", { w: width, h: height })}
              {ppt < pxPerTile ? ` — ${t("export.capped")}` : ""}
            </Text>
            <Text>
              {estimate === undefined
                ? t("export.estimating")
                : estimate === null
                  ? t("export.estimateFailed")
                  : t("export.fileSize", { size: formatBytes(estimate) })}
            </Text>
          </Stack>
        )}
      </Stack>
    </Modal>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Flex align="center" justify="space-between" gap="4">
      <Text>{label}</Text>
      {children}
    </Flex>
  )
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Flex align="center" justify="space-between" gap="4">
      <Stack gap="0">
        <Text color={disabled ? "fg.subtle" : undefined}>{label}</Text>
        {hint && (
          <Text fontSize="xs" color="fg.subtle">
            {hint}
          </Text>
        )}
      </Stack>
      <Switch.Root
        checked={checked}
        disabled={disabled}
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

/**
 * The estimated file size for `opts` (bytes): undefined while it's being
 * worked out, null if that failed. Re-estimated a moment after the options
 * settle.
 */
function useSizeEstimate(opts: ExportOptions | null): number | null | undefined {
  const [result, setResult] = useState<{ for: ExportOptions; bytes: number | null } | null>(null)
  useEffect(() => {
    if (!opts) return
    let cancelled = false
    const timer = setTimeout(() => {
      estimateExportSize(opts).then(
        (bytes) => {
          if (!cancelled) setResult({ for: opts, bytes })
        },
        () => {
          if (!cancelled) setResult({ for: opts, bytes: null })
        },
      )
    }, ESTIMATE_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [opts])
  return result?.for === opts ? result.bytes : undefined
}
