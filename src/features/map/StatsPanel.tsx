import { Fragment, useEffect, useState } from "react"
import { Box, Grid, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useMapStore } from "../../stores/mapStore"
import { useEditorStore } from "../../stores/editorStore"
import { useViewStore } from "../../stores/viewStore"
import { assetCache } from "./render/assets"
import { renderStats, type RenderStats } from "./render/renderStats"
import { roundTo } from "../../lib/numbers"

/** How often the panel reads the stats (ms). */
const REFRESH_MS = 500

/**
 * Settings › Debug's stats panel, over the map's top-right corner: frames
 * drawn per second and their cost, GPU draw calls, what the canvas and the
 * texture cache hold. Read twice a second; it never makes the map redraw.
 */
export function StatsPanel() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<RenderStats | null>(null)
  const [textures, setTextures] = useState(() => assetCache.stats())
  const zoom = useViewStore((s) => s.zoom)
  const level = useEditorStore((s) => s.activeLevel)
  const entities = useMapStore(
    (s) => s.map?.entities.filter((e) => !e.level || e.level === level).length ?? 0,
  )

  useEffect(() => {
    const read = () => {
      setStats(renderStats())
      setTextures(assetCache.stats())
    }
    const timer = setInterval(read, REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const rows: [string, string][] = stats
    ? [
        [t("debug.fps"), String(Math.round(stats.fps))],
        [t("debug.frameMs"), `${stats.avgMs.toFixed(1)} / ${stats.maxMs.toFixed(1)}`],
        [t("debug.drawCalls"), String(Math.round(stats.drawCalls))],
        [
          t("debug.canvas"),
          `${Math.round(stats.width)}×${Math.round(stats.height)} @${roundTo(stats.resolution)}×`,
        ],
        [t("debug.nodes"), String(stats.nodes)],
        [t("debug.entities"), String(entities)],
        [t("debug.textures"), `${textures.textures} · ${textures.megabytes.toFixed(0)} MB`],
        [t("debug.zoom"), `${Math.round(zoom)}%`],
        ...(stats.heapMb === null
          ? []
          : ([[t("debug.heap"), `${stats.heapMb.toFixed(0)} MB`]] as [string, string][])),
      ]
    : []

  return (
    <Box
      position="absolute"
      top="2"
      right="2"
      zIndex="1"
      pointerEvents="none"
      bg="panel.solid/85"
      borderWidth="1px"
      borderColor="panel.border"
      borderRadius="md"
      px="2.5"
      py="1.5"
      fontFamily="mono"
      fontSize="xs"
      lineHeight="1.5"
    >
      {stats ? (
        <Grid templateColumns="auto auto" columnGap="3">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <Text color="fg.muted">{label}</Text>
              <Text textAlign="right">{value}</Text>
            </Fragment>
          ))}
        </Grid>
      ) : (
        <Text color="fg.muted">{t("debug.waiting")}</Text>
      )}
    </Box>
  )
}
