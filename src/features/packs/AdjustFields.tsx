import { Box, Button, HStack, IconButton, Slider, Switch, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuFlipHorizontal2, LuFlipVertical2, LuRotateCcw, LuRotateCw } from "react-icons/lu"
import { Tooltip } from "../../ui/chakra/tooltip"
import { cellsOf, scaleForCells, sharedValue, targetSize, type Adjust } from "./userAssets"

/** An image being adjusted: its real size and content bounds. */
export interface AdjustTarget {
  width: number
  height: number
  bounds?: readonly [number, number, number, number] | null
  adjust: Adjust
}

/** Cell counts offered to fit the longest side to (for one or many images). */
const FIT_CELLS = [0.5, 1, 2, 3, 4]

const SCALE_MIN = 5
const SCALE_MAX = 400

/** Small uppercase caption over a group of fields. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text fontSize="2xs" color="fg.muted" textTransform="uppercase" letterSpacing="wide">
      {children}
    </Text>
  )
}

/**
 * Size and orientation of one image or many at once: a scale slider, "fit
 * to N cells" (each image to its own scale), quarter turns, flips and
 * trimming transparent borders. Controls show the shared value, or a
 * "mixed" state when the images differ; changing one sets it on all.
 */
export function AdjustFields({
  targets,
  onPatch,
  showTrim = true,
}: {
  targets: readonly AdjustTarget[]
  /** Apply a change to every target's adjustments. */
  onPatch: (f: (adjust: Adjust, target: AdjustTarget) => Adjust) => void
  showTrim?: boolean
}) {
  const { t } = useTranslation()
  if (targets.length === 0) return null
  const scale = sharedValue(targets, (x) => Math.round(x.adjust.scale * 100))
  const trim = sharedValue(targets, (x) => x.adjust.trim)
  const single = targets.length === 1 ? targets[0] : null
  const size = single ? targetSize(single.width, single.height, single.adjust, single.bounds) : null
  const canTrim = targets.some((x) => x.bounds && (x.bounds[2] < x.width || x.bounds[3] < x.height))

  const fit = (cells: number) =>
    onPatch((adjust, x) => {
      const base = targetSize(x.width, x.height, { ...adjust, scale: 1 }, x.bounds)
      return { ...adjust, scale: scaleForCells(Math.max(base.w, base.h), cells) }
    })

  return (
    <VStack align="stretch" gap="3">
      <Box>
        <HStack justify="space-between" mb="1">
          <FieldLabel>{t("userPacks.size")}</FieldLabel>
          <Text fontSize="xs" color="fg.muted">
            {scale === undefined ? t("userPacks.mixed") : `${scale}%`}
            {size && ` · ${t("userPacks.cells", { w: cellsOf(size.w), h: cellsOf(size.h) })}`}
          </Text>
        </HStack>
        <Slider.Root
          size="sm"
          colorPalette="brand"
          min={SCALE_MIN}
          max={SCALE_MAX}
          step={1}
          value={[Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale ?? 100))]}
          onValueChange={(e) => {
            const v = e.value[0] / 100
            onPatch((adjust) => ({ ...adjust, scale: v }))
          }}
          aria-label={[t("userPacks.size")]}
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
        <HStack gap="1" mt="2" flexWrap="wrap">
          <Text fontSize="xs" color="fg.muted" mr="1">
            {t("userPacks.fitTo")}
          </Text>
          {FIT_CELLS.map((n) => (
            <Button key={n} size="2xs" variant="subtle" minW="8" onClick={() => fit(n)}>
              {n}
            </Button>
          ))}
          <Button
            size="2xs"
            variant="ghost"
            onClick={() => onPatch((adjust) => ({ ...adjust, scale: 1 }))}
          >
            {t("userPacks.original")}
          </Button>
        </HStack>
      </Box>

      <Box>
        <FieldLabel>{t("userPacks.orientation")}</FieldLabel>
        <HStack gap="1" mt="1">
          <OrientButton
            label={t("userPacks.rotateLeft")}
            onClick={() => onPatch((a) => ({ ...a, rotate: (a.rotate + 3) % 4 }))}
          >
            <LuRotateCcw />
          </OrientButton>
          <OrientButton
            label={t("userPacks.rotateRight")}
            onClick={() => onPatch((a) => ({ ...a, rotate: (a.rotate + 1) % 4 }))}
          >
            <LuRotateCw />
          </OrientButton>
          <OrientButton
            label={t("userPacks.flipH")}
            active={sharedValue(targets, (x) => x.adjust.flipH) === true}
            onClick={() => onPatch((a) => ({ ...a, flipH: !a.flipH }))}
          >
            <LuFlipHorizontal2 />
          </OrientButton>
          <OrientButton
            label={t("userPacks.flipV")}
            active={sharedValue(targets, (x) => x.adjust.flipV) === true}
            onClick={() => onPatch((a) => ({ ...a, flipV: !a.flipV }))}
          >
            <LuFlipVertical2 />
          </OrientButton>
        </HStack>
      </Box>

      {showTrim && canTrim && (
        <Switch.Root
          size="sm"
          colorPalette="brand"
          checked={trim ?? false}
          onCheckedChange={(e) => onPatch((a) => ({ ...a, trim: e.checked }))}
        >
          <Switch.HiddenInput />
          <Switch.Control />
          <Switch.Label fontSize="sm">
            {t("userPacks.trim")}
            {trim === undefined && (
              <Text as="span" color="fg.muted">
                {" "}
                · {t("userPacks.mixed")}
              </Text>
            )}
          </Switch.Label>
        </Switch.Root>
      )}
    </VStack>
  )
}

function OrientButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip content={label} showArrow>
      <IconButton
        aria-label={label}
        aria-pressed={active}
        size="sm"
        variant={active ? "solid" : "subtle"}
        colorPalette={active ? "brand" : undefined}
        onClick={onClick}
      >
        {children}
      </IconButton>
    </Tooltip>
  )
}
