import { useState } from "react"
import { Box, Button, Flex, Icon, Switch, Text, VStack } from "@chakra-ui/react"
import { Select } from "../../../../ui/Select"
import { useTranslation } from "react-i18next"
import { LuLayoutGrid, LuPaintBucket } from "react-icons/lu"
import { thumbUrl } from "../../../library/api"
import { Tooltip } from "../../../../ui/chakra/tooltip"
import { BIOME_MAX_SLOTS, type BiomeSelection, type BiomeTexture } from "../../params"
import { BIOMES } from "./biomes"
import { TexturePickerPanel } from "./TexturePickerPanel"

/**
 * Biome selector for the Terrain Brush: a fixed biome dropdown plus terrain
 * texture slots. Clicking a slot's thumbnail/name area selects it (the brush
 * and Fill act on the selected slot); its button opens a floating browser to
 * pick the texture. The "unlock 4 more slots" toggle reveals slots 5–8. Fill
 * (covering the map with the selected slot) is the tool's action, passed in.
 */
export function BiomeControl({
  value,
  labelKey,
  onChange,
  onFill,
}: {
  value: BiomeSelection
  labelKey: string
  onChange: (value: BiomeSelection) => void
  onFill: () => void
}) {
  const { t } = useTranslation()
  const [openSlot, setOpenSlot] = useState<number | null>(null)

  // Slots belong to the selected biome; switching biomes swaps them.
  const stored = value.slotsByBiome[value.biome] ?? []
  const count = value.unlocked ? BIOME_MAX_SLOTS : 4
  const slots = Array.from({ length: count }, (_, i) => stored[i] ?? null)

  // Clamp so the highlight stays valid when locking slots hides the selected one.
  const selectedSlot = Math.min(value.selectedSlot ?? 0, count - 1)

  const setBiome = (biome: string) => onChange({ ...value, biome })
  const setUnlocked = (unlocked: boolean) => onChange({ ...value, unlocked })
  const selectSlot = (index: number) => onChange({ ...value, selectedSlot: index })
  const setSlot = (index: number, texture: BiomeTexture) => {
    const next = stored.slice()
    next[index] = texture
    onChange({ ...value, slotsByBiome: { ...value.slotsByBiome, [value.biome]: next } })
  }

  return (
    <Flex direction="column" flex="1" minH="0" px="3" py="1.5" gap="2">
      <Text fontSize="xs" color="fg.muted">
        {t(labelKey)}
      </Text>

      <Select
        value={value.biome}
        items={BIOMES.map((biome) => ({ value: biome, label: t(`biomes.${biome}`) }))}
        onChange={setBiome}
      />

      {/* Texture slots (scroll when they overflow). */}
      <VStack align="stretch" gap="1.5" flex="1" minH="0" overflowY="auto">
        {slots.map((slot, i) => {
          const isSelected = i === selectedSlot
          return (
            <Flex
              key={i}
              align="center"
              h="64px"
              borderWidth="1px"
              borderColor={isSelected ? "brand.fg" : "panel.border"}
              borderRadius="md"
              overflow="hidden"
              flexShrink={0}
            >
              <Flex
                align="center"
                flex="1"
                minW="0"
                h="full"
                cursor="pointer"
                bg={isSelected ? "panel.rowSelected/50" : undefined}
                _hover={{ bg: isSelected ? "panel.rowSelected/50" : "panel.rowHover/60" }}
                onClick={() => selectSlot(i)}
                aria-pressed={isSelected}
              >
                <Box boxSize="64px" flexShrink={0} bg="panel.header">
                  {slot && (
                    <img
                      src={thumbUrl(slot.thumb)}
                      alt=""
                      draggable={false}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  )}
                </Box>
                <Text px="2.5" fontSize="sm" truncate color={slot ? "fg" : "fg.muted"}>
                  {slot ? slot.name : t("tools.noTexture")}
                </Text>
              </Flex>
              <Tooltip content={t("tools.pickTexture")} openDelay={200} showArrow>
                <Flex
                  as="button"
                  align="center"
                  justify="center"
                  w="48px"
                  h="full"
                  flexShrink={0}
                  cursor="pointer"
                  color="menubar.fg"
                  _hover={{ bg: "panel.rowHover", color: "brand.fg" }}
                  onClick={() => setOpenSlot(i)}
                  aria-label={t("tools.pickTexture")}
                >
                  <Icon as={LuLayoutGrid} boxSize="4" />
                </Flex>
              </Tooltip>
            </Flex>
          )
        })}
      </VStack>

      <Button
        variant="subtle"
        size="sm"
        onClick={onFill}
        disabled={!slots[selectedSlot]}
        flexShrink={0}
      >
        <LuPaintBucket />
        {t("tools.fill")}
      </Button>

      <Flex align="center" justify="space-between" flexShrink={0}>
        <Text fontSize="xs" color="fg.muted">
          {t("tools.unlockSlots")}
        </Text>
        <Switch.Root checked={value.unlocked} onCheckedChange={(e) => setUnlocked(e.checked)}>
          <Switch.HiddenInput />
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Root>
      </Flex>

      {openSlot !== null && (
        <TexturePickerPanel
          onSelect={(texture) => setSlot(openSlot, texture)}
          onClose={() => setOpenSlot(null)}
        />
      )}
    </Flex>
  )
}
